-- SQL Server 2014 (12.x). Revisar resultado con @Aplicar=0; cambiar a 1 para guardar.
-- No importa imagenes, intervenciones, repuestos ni saldos.
SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @Aplicar BIT = 0;
DECLARE @Machines TABLE (Code NVARCHAR(50), Name NVARCHAR(200), Brand NVARCHAR(100), Model NVARCHAR(100), Serial NVARCHAR(100), Area NVARCHAR(100), Status VARCHAR(20), Notes NVARCHAR(MAX));
DECLARE @Motors TABLE (MachineCode NVARCHAR(50), Code NVARCHAR(50), Name NVARCHAR(200), Brand NVARCHAR(100), Model NVARCHAR(100), Notes NVARCHAR(500), KW DECIMAL(10,2), HP DECIMAL(10,2), Voltage DECIMAL(10,2), CurrentA DECIMAL(10,2), Hz DECIMAL(10,2), RPM INT, IP NVARCHAR(30));
INSERT INTO @Machines VALUES (N'T7RPK5',N'REPICKY 5',N'REPICKY',N'ECSIR-1000',NULL,N'PRODUCCION',N'ACTIVA',N'Fuente: ficha REPICKY 5 adjunta por el usuario (solo datos). PROCEDENCIA: ITALIA; AÑO DE FABRICACIÓN: 2025; COLOR: CELESTE; EPP marcado en ficha: Overol, guantes, respirador, gafas, orejeras y botas; Antecedente de la ficha: 16/01/2026 - MC - Rebobinado de Motor. Sin responsable, repuestos ni motivo especificados. Conservado como nota, no como intervencion del sistema.');
INSERT INTO @Motors VALUES (N'T7RPK5',N'T7RPK5-M1',N'Motor 1 - REPICKY 5',N'SIEMENS',N'1LE0102-1DA3',N'Datos transcritos de la ficha; verificar placa. MARCA: SIEMENS; MODELO: 1LE0102-1DA3; VOLTAJE: 440 V; FRECUENCIA: 60 Hz; CORRIENTE: 30 A; VELOCIDAD: 3520 RPM; POTENCIA: 17.3 Kw; OTROS: IP55; FASES: 3',17.3,NULL,440,30,60,3520,N'IP55');

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
