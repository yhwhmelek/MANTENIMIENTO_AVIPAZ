-- Módulo de calibración y verificación metrológica (procedimiento MT/03, versión 06).
-- Borrador: solo crea tablas nuevas. No modifica tablas ni registros existentes.
-- Es repetible: cada tabla se crea únicamente si todavía no existe.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    -- MT 03/Anexo 3 · Inventario de pesas patrón y equipos patrón.
    IF OBJECT_ID('dbo.CalibrationStandards','U') IS NULL
    BEGIN
        CREATE TABLE dbo.CalibrationStandards (
            StandardId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            Code NVARCHAR(40) NOT NULL,
            Description NVARCHAR(150) NOT NULL,
            Magnitude VARCHAR(20) NOT NULL
                CONSTRAINT CK_CalibrationStandards_Magnitude CHECK (Magnitude IN ('MASA','TEMPERATURA','HUMEDAD','PRESION','VOLUMEN','OTRA')),
            NominalValue DECIMAL(18,4) NULL,
            Unit NVARCHAR(20) NULL,
            AccuracyClass NVARCHAR(30) NULL,
            Quantity INT NOT NULL CONSTRAINT DF_CalibrationStandards_Quantity DEFAULT 1
                CONSTRAINT CK_CalibrationStandards_Quantity CHECK (Quantity > 0),
            CertificateNumber NVARCHAR(80) NULL,
            Laboratory NVARCHAR(150) NULL,
            CalibratedOn DATE NULL,
            ValidUntil DATE NULL,
            Notes NVARCHAR(500) NULL,
            Active BIT NOT NULL CONSTRAINT DF_CalibrationStandards_Active DEFAULT 1,
            CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_CalibrationStandards_CreatedAt DEFAULT SYSDATETIME(),
            CONSTRAINT UQ_CalibrationStandards_Code UNIQUE (Code)
        );
    END;

    -- MT 03/Anexo 1 · Inventario de equipos e instrumentos de medición.
    IF OBJECT_ID('dbo.CalibrationInstruments','U') IS NULL
    BEGIN
        CREATE TABLE dbo.CalibrationInstruments (
            InstrumentId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            Code NVARCHAR(40) NOT NULL,
            Name NVARCHAR(150) NOT NULL,
            InstrumentType VARCHAR(30) NOT NULL
                CONSTRAINT CK_CalibrationInstruments_Type CHECK (InstrumentType IN
                    ('BALANZA','SISTEMA_PESAJE','BASCULA_CAMIONERA','TEMPERATURA_HUMEDAD','MANOMETRO','CAUDALIMETRO','OTRO')),
            BrandModel NVARCHAR(120) NULL,
            PlantId INT NULL CONSTRAINT FK_CalibrationInstruments_Plants REFERENCES dbo.Plants(PlantId),
            Area NVARCHAR(100) NOT NULL,
            RangeMin DECIMAL(18,4) NULL,
            RangeMax DECIMAL(18,4) NULL,
            Unit NVARCHAR(20) NOT NULL,
            Resolution DECIMAL(18,4) NULL,
            Emp DECIMAL(18,4) NOT NULL CONSTRAINT CK_CalibrationInstruments_Emp CHECK (Emp >= 0),
            Criticality VARCHAR(10) NOT NULL CONSTRAINT DF_CalibrationInstruments_Criticality DEFAULT 'MEDIA'
                CONSTRAINT CK_CalibrationInstruments_Criticality CHECK (Criticality IN ('ALTA','MEDIA','BAJA')),
            Status VARCHAR(20) NOT NULL CONSTRAINT DF_CalibrationInstruments_Status DEFAULT 'PENDIENTE'
                CONSTRAINT CK_CalibrationInstruments_Status CHECK (Status IN ('PENDIENTE','CONFORME','NO_CONFORME','FUERA_DE_USO')),
            Notes NVARCHAR(500) NULL,
            Active BIT NOT NULL CONSTRAINT DF_CalibrationInstruments_Active DEFAULT 1,
            CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_CalibrationInstruments_CreatedAt DEFAULT SYSDATETIME(),
            CONSTRAINT UQ_CalibrationInstruments_Code UNIQUE (Code),
            CONSTRAINT CK_CalibrationInstruments_Range CHECK (RangeMin IS NULL OR RangeMax IS NULL OR RangeMin <= RangeMax)
        );
    END;

    -- MT 03/Anexo 2 · Matriz AMEM: método de control y frecuencia por instrumento.
    IF OBJECT_ID('dbo.CalibrationPlans','U') IS NULL
    BEGIN
        CREATE TABLE dbo.CalibrationPlans (
            PlanId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            InstrumentId INT NOT NULL CONSTRAINT FK_CalibrationPlans_Instruments REFERENCES dbo.CalibrationInstruments(InstrumentId),
            ControlMethod VARCHAR(30) NOT NULL
                CONSTRAINT CK_CalibrationPlans_Method CHECK (ControlMethod IN ('VERIFICACION_INTERNA','CALIBRACION_INTERNA','CALIBRACION_EXTERNA')),
            FrequencyEvery INT NOT NULL CONSTRAINT CK_CalibrationPlans_Every CHECK (FrequencyEvery BETWEEN 1 AND 3650),
            FrequencyUnit VARCHAR(10) NOT NULL CONSTRAINT CK_CalibrationPlans_Unit CHECK (FrequencyUnit IN ('DIAS','SEMANAS','MESES')),
            ResponsibleGroup VARCHAR(20) NOT NULL
                CONSTRAINT CK_CalibrationPlans_Group CHECK (ResponsibleGroup IN ('MANTENIMIENTO','MECANICO','ELECTRICO','TECNICO','EXTERNO')),
            NextDue DATE NOT NULL,
            Active BIT NOT NULL CONSTRAINT DF_CalibrationPlans_Active DEFAULT 1,
            CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_CalibrationPlans_CreatedAt DEFAULT SYSDATETIME()
        );
        CREATE UNIQUE INDEX UX_CalibrationPlans_ActiveMethod ON dbo.CalibrationPlans(InstrumentId, ControlMethod) WHERE Active = 1;
        CREATE INDEX IX_CalibrationPlans_NextDue ON dbo.CalibrationPlans(NextDue) WHERE Active = 1;
    END;

    -- Registros MT/03-02 a MT/03-07: cabecera de cada verificación o calibración.
    IF OBJECT_ID('dbo.CalibrationRecords','U') IS NULL
    BEGIN
        CREATE TABLE dbo.CalibrationRecords (
            RecordId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            InstrumentId INT NOT NULL CONSTRAINT FK_CalibrationRecords_Instruments REFERENCES dbo.CalibrationInstruments(InstrumentId),
            PlanId INT NULL CONSTRAINT FK_CalibrationRecords_Plans REFERENCES dbo.CalibrationPlans(PlanId),
            ControlMethod VARCHAR(30) NOT NULL
                CONSTRAINT CK_CalibrationRecords_Method CHECK (ControlMethod IN ('VERIFICACION_INTERNA','CALIBRACION_INTERNA','CALIBRACION_EXTERNA')),
            FormatCode VARCHAR(12) NOT NULL,
            ScheduledFor DATE NULL,
            PerformedOn DATE NOT NULL,
            Result VARCHAR(15) NOT NULL CONSTRAINT CK_CalibrationRecords_Result CHECK (Result IN ('CONFORME','NO_CONFORME')),
            ActionTaken VARCHAR(25) NOT NULL CONSTRAINT DF_CalibrationRecords_Action DEFAULT 'NINGUNA'
                CONSTRAINT CK_CalibrationRecords_Action CHECK (ActionTaken IN
                    ('NINGUNA','AJUSTE','MANTENIMIENTO','CALIBRACION_EXTERNA','RETIRO','REEMPLAZO')),
            AreaResponsible NVARCHAR(150) NULL,
            ExternalProvider NVARCHAR(150) NULL,
            CertificateNumber NVARCHAR(80) NULL,
            Observations NVARCHAR(1000) NULL,
            RegisteredBy INT NOT NULL CONSTRAINT FK_CalibrationRecords_RegisteredBy REFERENCES dbo.Usuarios(Id),
            RegisteredAt DATETIME2(0) NOT NULL CONSTRAINT DF_CalibrationRecords_RegisteredAt DEFAULT SYSDATETIME(),
            ReviewedBy INT NULL CONSTRAINT FK_CalibrationRecords_ReviewedBy REFERENCES dbo.Usuarios(Id),
            ReviewedAt DATETIME2(0) NULL,
            Voided BIT NOT NULL CONSTRAINT DF_CalibrationRecords_Voided DEFAULT 0,
            VoidReason NVARCHAR(300) NULL
        );
        CREATE INDEX IX_CalibrationRecords_Instrument ON dbo.CalibrationRecords(InstrumentId, PerformedOn DESC);
        CREATE INDEX IX_CalibrationRecords_PerformedOn ON dbo.CalibrationRecords(PerformedOn);
    END;

    -- Puntos de medición: valor patrón, valor medido, error y EMP aplicado.
    IF OBJECT_ID('dbo.CalibrationRecordPoints','U') IS NULL
    BEGIN
        CREATE TABLE dbo.CalibrationRecordPoints (
            PointId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            RecordId INT NOT NULL CONSTRAINT FK_CalibrationRecordPoints_Records REFERENCES dbo.CalibrationRecords(RecordId),
            Position INT NOT NULL,
            Label NVARCHAR(60) NOT NULL,
            ReferenceValue DECIMAL(18,4) NOT NULL,
            MeasuredValue DECIMAL(18,4) NOT NULL,
            Error DECIMAL(18,4) NOT NULL,
            Emp DECIMAL(18,4) NOT NULL,
            Conforms BIT NOT NULL,
            CONSTRAINT UQ_CalibrationRecordPoints_Position UNIQUE (RecordId, Position)
        );
    END;

    -- Patrones utilizados en cada registro (trazabilidad metrológica, política 5.3).
    IF OBJECT_ID('dbo.CalibrationRecordStandards','U') IS NULL
    BEGIN
        CREATE TABLE dbo.CalibrationRecordStandards (
            RecordId INT NOT NULL CONSTRAINT FK_CalibrationRecordStandards_Records REFERENCES dbo.CalibrationRecords(RecordId),
            StandardId INT NOT NULL CONSTRAINT FK_CalibrationRecordStandards_Standards REFERENCES dbo.CalibrationStandards(StandardId),
            CONSTRAINT PK_CalibrationRecordStandards PRIMARY KEY (RecordId, StandardId)
        );
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
