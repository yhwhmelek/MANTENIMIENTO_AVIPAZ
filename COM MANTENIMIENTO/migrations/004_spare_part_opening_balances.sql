-- Saldo al cierre de la fecha de corte: solo se suman movimientos de dias posteriores.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.SparePartPurchases', 'U') IS NULL OR OBJECT_ID('dbo.MaintenancePartsUsed', 'U') IS NULL
        THROW 50300, 'Ejecuta primero la migracion 003.', 1;

    IF OBJECT_ID('dbo.SparePartOpeningBalances', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.SparePartOpeningBalances (
            SparePartId INT NOT NULL PRIMARY KEY REFERENCES dbo.SpareParts(SparePartId),
            CutoffDate DATE NOT NULL,
            Quantity DECIMAL(10,2) NOT NULL CHECK (Quantity >= 0),
            UnitOfMeasure NVARCHAR(20) NOT NULL,
            Notes NVARCHAR(500) NULL,
            CreatedBy INT NOT NULL,
            CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
        );
    END;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
