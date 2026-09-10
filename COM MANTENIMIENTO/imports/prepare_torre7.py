"""Extract technical headers only; never executes SQL or imports images/history."""
import argparse
from collections import Counter
from decimal import Decimal
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

NS = {'t': 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
      'x': 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'}
LABELS = set('CÓDIGO|MARCA|PROCEDENCIA|POSEE MANUAL|NOMBRE DEL EQUIPO|MODELO|AÑO DE FABRICACIÓN|DIMENSIÓN|ÁREA|SERIE|COLOR|CAPACIDAD|OPERADOR|VOLTAJE|FRECUENCIA|CORRIENTE|VELOCIDAD|POTENCIA|OTROS|FASES|ACEITE CAJA'.split('|'))


def extract(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('content.xml'))
    result = []
    for sheet in root.findall('.//t:table', NS):
        name = sheet.get('{%s}name' % NS['t'])
        machine, motor, target, heading = {}, {}, None, ''
        for row in sheet.findall('t:table-row', NS):
            # Direct paragraphs exclude drawing text and annotations.
            cells = [' '.join(''.join(p.itertext()) for p in c.findall('x:p', NS)).strip()
                     for c in row.findall('t:table-cell', NS)]
            if 'EQUIPO DE PROTECCIÓN PERSONAL' in cells:
                break
            if 'DATOS DEL EQUIPO' in cells:
                target = machine
            headers = [c for c in cells if re.fullmatch(r'(\d+ )?MOTORES?', c) or c.startswith('QUEMADOR')]
            if headers:
                heading = headers[-1]
                target = motor
                continue
            if target is None:
                continue
            # BIN 8 contains a copied BIN 6 on the left: the last block is BIN 8.
            for index, cell in enumerate(cells[:-1]):
                if cell in LABELS:
                    value = cells[index + 1]
                    target[cell] = value if value not in LABELS else ''
        if not machine.get('CÓDIGO') or not machine.get('NOMBRE DEL EQUIPO'):
            raise ValueError('Ficha sin identificación: ' + name)
        result.append({'sheet': name, 'machine': machine, 'motor': motor, 'heading': heading,
                       'motors': int(heading.split()[0]) if heading[:1].isdigit() else 1})
    return result


def numeric(text, unit):
    match = re.fullmatch(r'\s*(\d+(?:[.,]\d+)?)\s*(?:' + unit + r')?\s*', text, re.I)
    return str(Decimal(match[1].replace(',', '.'))) if match else None


def specs(motor):
    power = motor.get('POTENCIA', '')
    def power_value(unit):
        match = re.search(r'(\d+(?:[.,]\d+)?)\s*' + unit + r'\b', power, re.I)
        return str(Decimal(match[1].replace(',', '.'))) if match else None
    kw = power_value('kw')
    if kw is None and power_value('w') is not None:
        kw = str(Decimal(power_value('w')) / 1000)
    rpm = numeric(motor.get('VELOCIDAD', ''), r'RPM|r/min')
    return [kw, power_value('hp'), numeric(motor.get('VOLTAJE', ''), 'V'),
            numeric(motor.get('CORRIENTE', ''), 'A'), numeric(motor.get('FRECUENCIA', ''), 'Hz'),
            rpm if rpm is None or Decimal(rpm) == int(Decimal(rpm)) else None,
            motor.get('OTROS', '') if re.fullmatch(r'IP\s*\d+', motor.get('OTROS', ''), re.I) else None]


def sql_text(value):
    return 'NULL' if value is None or value == '' else "N'" + str(value).replace("'", "''") + "'"


def generate(records, overrides=None):
    overrides = overrides or {}
    for record in records:
        record['code'] = overrides.get(record['sheet'], record['machine']['CÓDIGO'])
    counts = Counter(r['code'].upper() for r in records)
    pending = [r for r in records if counts[r['code'].upper()] > 1]
    ready = [r for r in records if counts[r['code'].upper()] == 1]
    statements = []
    for record in ready:
        m, motor, code = record['machine'], record['motor'], record['code']
        notes = 'Fuente: FICHAS TECNICAS TORRE 7 EXTRUSION.ods; hoja: ' + record['sheet'] + '. '
        notes += '; '.join(k + ': ' + v for k, v in m.items() if v and k not in {'CÓDIGO', 'NOMBRE DEL EQUIPO', 'MARCA', 'MODELO', 'SERIE', 'ÁREA'})
        burner = record['heading'].startswith('QUEMADOR')
        if burner:
            notes += '. QUEMADOR (no son datos confirmados del motor): ' + '; '.join(k + ': ' + v for k, v in motor.items() if v)
            motor = {}
        machine_values = [code, m['NOMBRE DEL EQUIPO'], m.get('MARCA'), m.get('MODELO'), m.get('SERIE'), m.get('ÁREA'),
                          'FUERA_SERVICIO' if 'FUERA DE SERVICIO' in record['sheet'] else 'ACTIVA', notes]
        assert len(code) <= 40
        statements.append('INSERT INTO @Machines VALUES (' + ','.join(map(sql_text, machine_values)) + ');')
        for number in range(1, record['motors'] + 1):
            raw = '; '.join(k + ': ' + v for k, v in motor.items() if v)
            note = ('Datos transcritos de la ficha; verificar placa. ' + raw) if raw else 'Motor pendiente de verificar e identificar; la ficha no proporciona datos de motor.'
            assert len(note) <= 500
            values = [code, code + '-M' + str(number), 'Motor ' + str(number) + ' - ' + m['NOMBRE DEL EQUIPO'],
                      motor.get('MARCA'), motor.get('MODELO'), note]
            statements.append('INSERT INTO @Motors VALUES (' + ','.join(map(sql_text, values)) + ',' +
                              ','.join(v or 'NULL' for v in specs(motor)[:-1]) + ',' + sql_text(specs(motor)[-1]) + ');')
    return ready, pending, '\n'.join(statements)


SQL_START = """-- SQL Server 2014 (12.x). Revisar resultado con @Aplicar=0; cambiar a 1 para guardar.
-- No importa imagenes, intervenciones, repuestos ni saldos.
SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @Aplicar BIT = 0;
DECLARE @Machines TABLE (Code NVARCHAR(50), Name NVARCHAR(200), Brand NVARCHAR(100), Model NVARCHAR(100), Serial NVARCHAR(100), Area NVARCHAR(100), Status VARCHAR(20), Notes NVARCHAR(MAX));
DECLARE @Motors TABLE (MachineCode NVARCHAR(50), Code NVARCHAR(50), Name NVARCHAR(200), Brand NVARCHAR(100), Model NVARCHAR(100), Notes NVARCHAR(500), KW DECIMAL(10,2), HP DECIMAL(10,2), Voltage DECIMAL(10,2), CurrentA DECIMAL(10,2), Hz DECIMAL(10,2), RPM INT, IP NVARCHAR(30));
"""

SQL_END = """
SELECT * FROM @Machines ORDER BY Code;
SELECT * FROM @Motors ORDER BY MachineCode, Code;
IF @Aplicar=0 RETURN;
BEGIN TRY
    BEGIN TRANSACTION;
    IF COL_LENGTH('dbo.Machines','TowerId') IS NULL OR COL_LENGTH('dbo.MachineElementTypes','SpecificationType') IS NULL OR OBJECT_ID('dbo.MotorSpecifications','U') IS NULL
        THROW 50700, 'Ejecuta las migraciones 001 a 007 y verifica MotorSpecifications.', 1;
    DECLARE @Tower INT, @Type INT;
    SELECT @Tower=t.TowerId FROM dbo.Towers t JOIN dbo.Plants p ON p.PlantId=t.PlantId WHERE p.Name=N'Samanga' AND t.Name=N'Torre 7';
    IF @Tower IS NULL THROW 50701, 'Falta Samanga / Torre 7. Ejecuta 007.', 1;
    -- Ante un codigo existente que identifica otra maquina se revierte toda la carga.
    IF EXISTS (SELECT 1 FROM @Machines s JOIN dbo.Machines m WITH (UPDLOCK,HOLDLOCK) ON m.AssetCode=s.Code WHERE m.Name<>s.Name OR (m.TowerId IS NOT NULL AND m.TowerId<>@Tower))
        THROW 50702, 'Codigo existente con otro nombre o torre. Revisa las coincidencias antes de importar.', 1;
    SELECT @Type=ElementTypeId FROM dbo.MachineElementTypes WITH (UPDLOCK,HOLDLOCK) WHERE Name=N'Motor' AND SpecificationType='MOTOR' AND Active=1;
    IF @Type IS NULL
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.MachineElementTypes WHERE Name=N'Motor')
            THROW 50703, 'El tipo Motor existente debe estar activo y tener especificacion MOTOR.', 1;
        INSERT INTO dbo.MachineElementTypes(Name,Description,Active,SpecificationType) VALUES(N'Motor',N'Motor electrico',1,'MOTOR');
        SET @Type=CAST(SCOPE_IDENTITY() AS INT);
    END;
    INSERT INTO dbo.Machines(AssetCode,Name,Manufacturer,Model,SerialNumber,Area,Status,Notes,TowerId)
        SELECT s.Code,s.Name,s.Brand,s.Model,s.Serial,s.Area,s.Status,s.Notes,@Tower FROM @Machines s
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Machines m WITH (UPDLOCK,HOLDLOCK) WHERE m.AssetCode=s.Code);
    DECLARE @NewMachines INT=@@ROWCOUNT;
    UPDATE m SET TowerId=@Tower FROM dbo.Machines m JOIN @Machines s ON s.Code=m.AssetCode WHERE m.TowerId IS NULL;
    IF EXISTS (SELECT 1 FROM @Motors s JOIN dbo.Machines m ON m.AssetCode=s.MachineCode JOIN dbo.MachineElements e WITH (UPDLOCK,HOLDLOCK) ON e.ElementCode=s.Code
               WHERE e.MachineId<>m.MachineId OR e.ElementTypeId<>@Type OR e.Name<>s.Name)
        THROW 50704, 'Un codigo de motor ya identifica otro elemento. No se guardo la carga.', 1;
    -- No duplica motores previamente ingresados con otros codigos: exige revisar esa maquina.
    IF EXISTS (SELECT 1 FROM @Machines s JOIN dbo.Machines m ON m.AssetCode=s.Code JOIN dbo.MachineElements e ON e.MachineId=m.MachineId
               JOIN dbo.MachineElementTypes t ON t.ElementTypeId=e.ElementTypeId
               WHERE t.SpecificationType='MOTOR' AND NOT EXISTS (SELECT 1 FROM @Motors x WHERE x.MachineCode=s.Code AND x.Code=e.ElementCode))
        THROW 50705, 'Hay motores existentes con otros codigos. Revisa su correspondencia antes de importar.', 1;
    INSERT INTO dbo.MachineElements(MachineId,ElementTypeId,ElementCode,Name,Manufacturer,Model,Quantity,Status,Active,Notes)
        SELECT m.MachineId,@Type,s.Code,s.Name,s.Brand,s.Model,1,CASE WHEN m.Status='FUERA_SERVICIO' THEN 'FUERA_SERVICIO' ELSE 'OPERATIVO' END,1,s.Notes
        FROM @Motors s JOIN dbo.Machines m ON m.AssetCode=s.MachineCode
        WHERE NOT EXISTS (SELECT 1 FROM dbo.MachineElements e WITH (UPDLOCK,HOLDLOCK) WHERE e.MachineId=m.MachineId AND e.ElementCode=s.Code);
    DECLARE @NewMotors INT=@@ROWCOUNT;
    INSERT INTO dbo.MotorSpecifications(ElementId,PowerKW,PowerHP,RatedVoltage,RatedCurrent,FrequencyHz,RPM,ProtectionClass,Notes)
        SELECT e.ElementId,s.KW,s.HP,s.Voltage,s.CurrentA,s.Hz,s.RPM,s.IP,s.Notes
        FROM @Motors s JOIN dbo.Machines m ON m.AssetCode=s.MachineCode JOIN dbo.MachineElements e ON e.MachineId=m.MachineId AND e.ElementCode=s.Code
        WHERE NOT EXISTS (SELECT 1 FROM dbo.MotorSpecifications p WITH (UPDLOCK,HOLDLOCK) WHERE p.ElementId=e.ElementId);
    COMMIT TRANSACTION;
    SELECT @NewMachines AS MaquinasCreadas,@NewMotors AS MotoresCreados;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ods', type=Path)
    parser.add_argument('--codes', type=Path, help='JSON: nombre de hoja -> codigo corregido')
    args = parser.parse_args()
    records = extract(args.ods)
    overrides = json.loads(args.codes.read_text(encoding='utf-8')) if args.codes else {}
    ready, pending, data = generate(records, overrides)
    folder = Path(__file__).parent
    (folder / 'torre7_source.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    (folder / 'cargar_torre7.sql').write_text(SQL_START + data + SQL_END, encoding='utf-8-sig')
    lines = ['# Carga de fichas de Samanga / Torre 7', '',
             f'Hojas leidas: {len(records)}. Maquinas listas: {len(ready)}. Elementos motor: {sum(r["motors"] for r in ready)}.', '',
             '## Uso', '',
             'Abrir `cargar_torre7.sql` en la base de mantenimiento. Ejecutar primero con `@Aplicar=0` para revisar las dos tablas. Para guardar, cambiar a `@Aplicar=1` y ejecutar todo el archivo. Requiere migraciones 001 a 007. No se ha ejecutado contra SQL Server desde esta preparacion.', '',
             'Las coincidencias por codigo y nombre conservan los datos existentes. Solo se asigna Torre 7 si la ubicacion esta vacia. Conflictos de nombre, torre o motores existentes abortan la transaccion. La repeticion no duplica los codigos importados. Los codigos de motor son CODIGO-M1, CODIGO-M2.', '',
             'No se importan imagenes ni movimientos historicos. Estado inicial ACTIVA/OPERATIVO salvo fichas fuera de servicio; verificar el estado actual en la aplicacion. Los motores sin datos quedan pendientes de verificar en Notas. No se infiere cantidad adicional si la ficha no la indica.', '',
             'Voltajes, corrientes y velocidades multiples se conservan completos en Notas; su campo numerico queda nulo. Fases no se confunde con polos. Potencias W se convierten a kW; HP y kW se conservan cuando figuran expresamente. Los datos de QUEMADOR de los calderos quedan en notas de maquina, sin atribuirlos a su motor. BIN PRODUCTO TERMINADO 8 usa la ficha derecha T7BPT8, no la copia de BIN 6 a la izquierda.', '',
             '## Maquinas omitidas por indicacion del usuario (codigos repetidos)', '']
    lines += [f'- {r["sheet"]}: {r["code"]}' for r in pending]
    lines += ['', 'Para corregirlos, crear un JSON con nombre de hoja y codigo definitivo y regenerar con `python prepare_torre7.py "ruta.ods" --codes codigos.json`.', '', '## Maquinas preparadas', '', '| Codigo | Maquina | Motores |', '|---|---|---|']
    lines += [f'| {r["code"]} | {r["machine"]["NOMBRE DEL EQUIPO"]} | {r["motors"]} |' for r in ready]
    (folder / 'LEEME_TORRE7.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{len(records)} hojas; {len(ready)} maquinas listas; {len(pending)} pendientes; {sum(r["motors"] for r in ready)} motores.')


if __name__ == '__main__':
    main()
