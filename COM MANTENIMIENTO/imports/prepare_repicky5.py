"""Prepara REPICKY 5 desde la ficha adjunta; no conecta con la base de datos."""
from pathlib import Path

from prepare_torre7 import SQL_START, SQL_END, generate


def main():
    record = {
        'sheet': 'REPICKY 5', 'heading': 'MOTORES', 'motors': 1,
        'machine': {
            'CÓDIGO': 'T7RPK5', 'NOMBRE DEL EQUIPO': 'REPICKY 5',
            'MARCA': 'REPICKY', 'MODELO': 'ECSIR-1000', 'ÁREA': 'PRODUCCION',
            'PROCEDENCIA': 'ITALIA', 'AÑO DE FABRICACIÓN': '2025', 'COLOR': 'CELESTE',
            'EPP marcado en ficha': 'Overol, guantes, respirador, gafas, orejeras y botas',
            'Antecedente de la ficha': '16/01/2026 - MC - Rebobinado de Motor. Sin responsable, repuestos ni motivo especificados. Conservado como nota, no como intervencion del sistema.',
        },
        'motor': {
            'MARCA': 'SIEMENS', 'MODELO': '1LE0102-1DA3', 'VOLTAJE': '440 V',
            'FRECUENCIA': '60 Hz', 'CORRIENTE': '30 A', 'VELOCIDAD': '3520 RPM',
            'POTENCIA': '17.3 Kw', 'OTROS': 'IP55', 'FASES': '3',
        },
    }
    ready, omitted, data = generate([record])
    assert len(ready) == 1 and not omitted
    data = data.replace('Fuente: FICHAS TECNICAS TORRE 7 EXTRUSION.ods; hoja: REPICKY 5.',
                        'Fuente: ficha REPICKY 5 adjunta por el usuario (solo datos).')
    assert data.count('INSERT INTO @Machines') == 1
    assert data.count('INSERT INTO @Motors') == 1
    assert '17.3,NULL,440,30,60,3520' in data
    (Path(__file__).parent / 'cargar_repicky5.sql').write_text(
        SQL_START + data + '\n' + SQL_END, encoding='utf-8-sig')
    print('Preparada 1 maquina T7RPK5 y 1 motor T7RPK5-M1, sin imagen.')


if __name__ == '__main__':
    main()
