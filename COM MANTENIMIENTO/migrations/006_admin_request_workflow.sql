SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.MaintenanceRequests','U') IS NULL
        THROW 50500, 'Ejecuta primero la migracion 005.', 1;
    IF COL_LENGTH('dbo.MaintenanceRequests','ReceivedBy') IS NULL
        ALTER TABLE dbo.MaintenanceRequests ADD ReceivedBy INT NULL
            CONSTRAINT FK_MaintenanceRequests_ReceivedBy REFERENCES dbo.Usuarios(Id);
    EXEC sp_executesql N'
        UPDATE dbo.MaintenanceRequests SET ReceivedBy=RequestedBy
        WHERE Status=''CERRADA'' AND ReceivedBy IS NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(''dbo.MaintenanceRequests'') AND name=''CK_MaintenanceRequests_Receiver'')
            ALTER TABLE dbo.MaintenanceRequests ADD CONSTRAINT CK_MaintenanceRequests_Receiver
            CHECK ((Status=''CERRADA'' AND ReceivedBy IS NOT NULL) OR (Status<>''CERRADA'' AND ReceivedBy IS NULL));
    ';
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.MaintenanceRequests') AND name='CK_MaintenanceRequests_SeparatePeople')
        ALTER TABLE dbo.MaintenanceRequests DROP CONSTRAINT CK_MaintenanceRequests_SeparatePeople;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

-- Verificacion: no depende del numero de solicitudes cerradas actualizadas.
SELECT SERVERPROPERTY('ProductVersion') AS VersionMotor,
       COL_LENGTH('dbo.MaintenanceRequests','ReceivedBy') AS TamanoColumnaReceivedBy,
       CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE parent_object_id=OBJECT_ID('dbo.MaintenanceRequests')
             AND name='CK_MaintenanceRequests_SeparatePeople') THEN 1 ELSE 0 END AS RestriccionPersonasDistintas;
