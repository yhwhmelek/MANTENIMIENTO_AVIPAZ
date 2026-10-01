-- General plans keep their machine selection in Data; specific plans keep MachineId.
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.PreventivePlans','U') IS NULL
  THROW 50501, 'Ejecuta primero la migracion 015.', 1;
 ALTER TABLE dbo.PreventivePlans ALTER COLUMN MachineId INT NULL;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
