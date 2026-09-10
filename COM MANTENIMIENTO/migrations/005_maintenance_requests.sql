SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.SparePartOpeningBalances','U') IS NULL
        THROW 50400, 'Ejecuta primero la migracion 004.', 1;

    -- Conserva las validaciones existentes y permite el nuevo rol OPERADOR.
    DECLARE @name SYSNAME, @definition NVARCHAR(MAX), @sql NVARCHAR(MAX);
    DECLARE role_checks CURSOR LOCAL FAST_FORWARD FOR
        SELECT name, definition FROM sys.check_constraints
        WHERE parent_object_id=OBJECT_ID('dbo.Usuarios')
          AND definition LIKE '%Rol%' AND definition LIKE '%''USUARIO''%'
          AND definition NOT LIKE '%''OPERADOR''%';
    OPEN role_checks;
    FETCH NEXT FROM role_checks INTO @name, @definition;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @sql=N'ALTER TABLE dbo.Usuarios DROP CONSTRAINT '+QUOTENAME(@name)+N';'
            +N'ALTER TABLE dbo.Usuarios WITH CHECK ADD CONSTRAINT '+QUOTENAME(@name)
            +N' CHECK (('+@definition+N') OR ('+REPLACE(@definition,'''USUARIO''','''OPERADOR''')+N'));';
        EXEC sp_executesql @sql;
        FETCH NEXT FROM role_checks INTO @name, @definition;
    END;
    CLOSE role_checks;
    DEALLOCATE role_checks;

    IF OBJECT_ID('dbo.MaintenanceRequests','U') IS NULL
    BEGIN
        CREATE TABLE dbo.MaintenanceRequests (
            RequestId INT IDENTITY PRIMARY KEY,
            MachineId INT NOT NULL REFERENCES dbo.Machines(MachineId),
            RequestedBy INT NOT NULL REFERENCES dbo.Usuarios(Id),
            RequestedAt DATETIME2 NOT NULL,
            Status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                CHECK (Status IN ('PENDIENTE','EN_PROCESO','POR_RECIBIR','CERRADA')),
            -- SQL Server 2014 (12.x): JSON validado y serializado por la API.
            RequestData NVARCHAR(MAX) NOT NULL,
            AssignedTo INT NULL REFERENCES dbo.Usuarios(Id),
            AcceptedAt DATETIME2 NULL,
            CompletedAt DATETIME2 NULL,
            ExecutionData NVARCHAR(MAX) NULL,
            MaintenanceEventId INT NULL REFERENCES dbo.MaintenanceEvents(MaintenanceEventId),
            ReceivedAt DATETIME2 NULL,
            ReceiptNotes NVARCHAR(1000) NULL,
            CONSTRAINT CK_MaintenanceRequests_SeparatePeople CHECK (AssignedTo IS NULL OR AssignedTo<>RequestedBy),
            CONSTRAINT CK_MaintenanceRequests_State CHECK (
                (Status='PENDIENTE' AND AssignedTo IS NULL AND AcceptedAt IS NULL AND CompletedAt IS NULL AND ExecutionData IS NULL AND MaintenanceEventId IS NULL AND ReceivedAt IS NULL) OR
                (Status='EN_PROCESO' AND AssignedTo IS NOT NULL AND AcceptedAt IS NOT NULL AND CompletedAt IS NULL AND ExecutionData IS NULL AND MaintenanceEventId IS NULL AND ReceivedAt IS NULL) OR
                (Status='POR_RECIBIR' AND AssignedTo IS NOT NULL AND AcceptedAt IS NOT NULL AND CompletedAt IS NOT NULL AND ExecutionData IS NOT NULL AND MaintenanceEventId IS NOT NULL AND ReceivedAt IS NULL) OR
                (Status='CERRADA' AND AssignedTo IS NOT NULL AND AcceptedAt IS NOT NULL AND CompletedAt IS NOT NULL AND ExecutionData IS NOT NULL AND MaintenanceEventId IS NOT NULL AND ReceivedAt IS NOT NULL))
        );
        CREATE INDEX IX_MaintenanceRequests_Status ON dbo.MaintenanceRequests(Status, RequestedAt);
        CREATE UNIQUE INDEX UX_MaintenanceRequests_Event ON dbo.MaintenanceRequests(MaintenanceEventId) WHERE MaintenanceEventId IS NOT NULL;
    END;
    IF OBJECT_ID('dbo.MachineOperatingPeriods','U') IS NULL
    BEGIN
        CREATE TABLE dbo.MachineOperatingPeriods (
            OperatingPeriodId INT IDENTITY PRIMARY KEY,
            MachineId INT NOT NULL REFERENCES dbo.Machines(MachineId),
            StartsAt DATETIME2 NOT NULL,
            EndsAt DATETIME2 NOT NULL,
            ScheduledHours DECIMAL(12,2) NOT NULL CHECK (ScheduledHours>0),
            OperatingHours DECIMAL(12,2) NOT NULL CHECK (OperatingHours>=0),
            Notes NVARCHAR(500) NOT NULL,
            CreatedBy INT NOT NULL REFERENCES dbo.Usuarios(Id),
            CreatedAt DATETIME2 NOT NULL,
            CHECK (EndsAt>StartsAt AND OperatingHours<=ScheduledHours)
        );
        CREATE INDEX IX_MachineOperatingPeriods_Machine ON dbo.MachineOperatingPeriods(MachineId,StartsAt,EndsAt);
    END;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
