-- Actividades de calibración, responsables y órdenes publicadas (flujo similar a preventivos).
-- Requiere 024_calibration_module.sql y 014 (dbo.Contractors). Repetible: solo agrega lo que falta.
-- No modifica ni elimina registros existentes.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    -- Catálogo de actividades: procedimiento, método, frecuencia y responsable sugeridos.
    IF OBJECT_ID('dbo.CalibrationActivities','U') IS NULL
    BEGIN
        CREATE TABLE dbo.CalibrationActivities (
            ActivityId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            Name NVARCHAR(150) NOT NULL,
            ControlMethod VARCHAR(30) NOT NULL
                CONSTRAINT CK_CalibrationActivities_Method CHECK (ControlMethod IN ('VERIFICACION_INTERNA','CALIBRACION_INTERNA','CALIBRACION_EXTERNA')),
            InstrumentType VARCHAR(30) NULL
                CONSTRAINT CK_CalibrationActivities_Type CHECK (InstrumentType IS NULL OR InstrumentType IN
                    ('BALANZA','SISTEMA_PESAJE','BASCULA_CAMIONERA','TEMPERATURA_HUMEDAD','MANOMETRO','CAUDALIMETRO','OTRO')),
            ProcedureText NVARCHAR(4000) NOT NULL,
            FrequencyEvery INT NOT NULL CONSTRAINT CK_CalibrationActivities_Every CHECK (FrequencyEvery BETWEEN 1 AND 3650),
            FrequencyUnit VARCHAR(10) NOT NULL CONSTRAINT CK_CalibrationActivities_Unit CHECK (FrequencyUnit IN ('DIAS','SEMANAS','MESES')),
            ResponsibleGroup VARCHAR(20) NOT NULL
                CONSTRAINT CK_CalibrationActivities_Group CHECK (ResponsibleGroup IN ('MANTENIMIENTO','MECANICO','ELECTRICO','TECNICO','EXTERNO')),
            DurationMinutes INT NOT NULL CONSTRAINT CK_CalibrationActivities_Duration CHECK (DurationMinutes BETWEEN 1 AND 10080),
            CrewSize INT NOT NULL CONSTRAINT DF_CalibrationActivities_Crew DEFAULT 1 CONSTRAINT CK_CalibrationActivities_Crew CHECK (CrewSize BETWEEN 1 AND 50),
            StartTime TIME(0) NOT NULL CONSTRAINT DF_CalibrationActivities_Start DEFAULT '08:00',
            Active BIT NOT NULL CONSTRAINT DF_CalibrationActivities_Active DEFAULT 1,
            CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_CalibrationActivities_CreatedAt DEFAULT SYSDATETIME(),
            CONSTRAINT UQ_CalibrationActivities_Name UNIQUE (Name)
        );
    END;

    -- Planes: actividad de origen, responsable designado y hora programada.
    IF COL_LENGTH('dbo.CalibrationPlans','ActivityId') IS NULL
        ALTER TABLE dbo.CalibrationPlans ADD ActivityId INT NULL
            CONSTRAINT FK_CalibrationPlans_Activities REFERENCES dbo.CalibrationActivities(ActivityId);
    IF COL_LENGTH('dbo.CalibrationPlans','AssigneeType') IS NULL
        ALTER TABLE dbo.CalibrationPlans ADD AssigneeType VARCHAR(12) NOT NULL
            CONSTRAINT DF_CalibrationPlans_AssigneeType DEFAULT 'GRUPO'
            CONSTRAINT CK_CalibrationPlans_AssigneeType CHECK (AssigneeType IN ('GRUPO','USUARIO','CONTRATISTA'));
    IF COL_LENGTH('dbo.CalibrationPlans','AssignedUserId') IS NULL
        ALTER TABLE dbo.CalibrationPlans ADD AssignedUserId INT NULL
            CONSTRAINT FK_CalibrationPlans_AssignedUser REFERENCES dbo.Usuarios(Id);
    IF COL_LENGTH('dbo.CalibrationPlans','AssignedContractorId') IS NULL
        ALTER TABLE dbo.CalibrationPlans ADD AssignedContractorId INT NULL
            CONSTRAINT FK_CalibrationPlans_AssignedContractor REFERENCES dbo.Contractors(ContractorId);
    IF COL_LENGTH('dbo.CalibrationPlans','StartTime') IS NULL
        ALTER TABLE dbo.CalibrationPlans ADD StartTime TIME(0) NOT NULL CONSTRAINT DF_CalibrationPlans_Start DEFAULT '08:00';

    -- Órdenes publicadas en el calendario: una por ciclo del plan.
    IF OBJECT_ID('dbo.CalibrationOrders','U') IS NULL
    BEGIN
        CREATE TABLE dbo.CalibrationOrders (
            OrderId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            PlanId INT NOT NULL CONSTRAINT FK_CalibrationOrders_Plans REFERENCES dbo.CalibrationPlans(PlanId),
            InstrumentId INT NOT NULL CONSTRAINT FK_CalibrationOrders_Instruments REFERENCES dbo.CalibrationInstruments(InstrumentId),
            ActivityId INT NULL CONSTRAINT FK_CalibrationOrders_Activities REFERENCES dbo.CalibrationActivities(ActivityId),
            ControlMethod VARCHAR(30) NOT NULL,
            DueDate DATE NOT NULL,
            SkippedCycles INT NOT NULL CONSTRAINT DF_CalibrationOrders_Skipped DEFAULT 0,
            ScheduledDate DATE NOT NULL,
            StartTime TIME(0) NOT NULL,
            ResponsibleGroup VARCHAR(20) NOT NULL,
            AssigneeType VARCHAR(12) NOT NULL CONSTRAINT CK_CalibrationOrders_AssigneeType CHECK (AssigneeType IN ('GRUPO','USUARIO','CONTRATISTA')),
            AssignedUserId INT NULL CONSTRAINT FK_CalibrationOrders_AssignedUser REFERENCES dbo.Usuarios(Id),
            AssignedContractorId INT NULL CONSTRAINT FK_CalibrationOrders_AssignedContractor REFERENCES dbo.Contractors(ContractorId),
            Status VARCHAR(20) NOT NULL CONSTRAINT DF_CalibrationOrders_Status DEFAULT 'PROGRAMADA'
                CONSTRAINT CK_CalibrationOrders_Status CHECK (Status IN ('PROGRAMADA','NO_CONFORME','REALIZADA','FUERA_DE_USO','CANCELADA')),
            Rescheduled BIT NOT NULL CONSTRAINT DF_CalibrationOrders_Rescheduled DEFAULT 0,
            ChangeReason NVARCHAR(300) NULL,
            PublishedBy INT NOT NULL CONSTRAINT FK_CalibrationOrders_PublishedBy REFERENCES dbo.Usuarios(Id),
            PublishedAt DATETIME2(0) NOT NULL CONSTRAINT DF_CalibrationOrders_PublishedAt DEFAULT SYSDATETIME(),
            ClosedAt DATETIME2(0) NULL,
            CONSTRAINT UQ_CalibrationOrders_Cycle UNIQUE (PlanId, DueDate)
        );
        CREATE INDEX IX_CalibrationOrders_Scheduled ON dbo.CalibrationOrders(ScheduledDate);
    END;

    -- Registros vinculados a la orden que ejecutan.
    IF COL_LENGTH('dbo.CalibrationRecords','OrderId') IS NULL
        ALTER TABLE dbo.CalibrationRecords ADD OrderId INT NULL
            CONSTRAINT FK_CalibrationRecords_Orders REFERENCES dbo.CalibrationOrders(OrderId);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
