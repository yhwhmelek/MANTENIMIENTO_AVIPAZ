-- Nuevo tipo MT/02-08 y solicitudes para areas sin maquina asociada.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    ALTER TABLE dbo.MaintenanceRequests ALTER COLUMN MachineId INT NULL;
    ALTER TABLE dbo.MaintenanceEvents ALTER COLUMN MachineId INT NULL;
    DECLARE @name SYSNAME, @definition NVARCHAR(MAX), @sql NVARCHAR(MAX);
    DECLARE checks CURSOR LOCAL FAST_FORWARD FOR
        SELECT name, definition FROM sys.check_constraints
        WHERE parent_object_id=OBJECT_ID('dbo.MaintenanceEvents')
        AND definition LIKE '%MaintenanceType%' AND definition LIKE '%''CORRECTIVO''%'
        AND definition NOT LIKE '%''MEJORA_TECNICA''%';
    OPEN checks;
    FETCH NEXT FROM checks INTO @name,@definition;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @sql=N'ALTER TABLE dbo.MaintenanceEvents DROP CONSTRAINT '+QUOTENAME(@name)+N';'
          +N'ALTER TABLE dbo.MaintenanceEvents WITH CHECK ADD CONSTRAINT '+QUOTENAME(@name)
          +N' CHECK (('+@definition+N') OR ('+REPLACE(@definition,'''CORRECTIVO''','''MEJORA_TECNICA''')+N'));';
        EXEC sp_executesql @sql;
        FETCH NEXT FROM checks INTO @name,@definition;
    END;
    CLOSE checks;
    DEALLOCATE checks;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
