-- Ejecutar despues de 003 en la base de mantenimiento.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.Suppliers', 'PaymentMethod') IS NULL
    EXEC(N'ALTER TABLE dbo.Suppliers ADD PaymentMethod NVARCHAR(500) NULL');
IF COL_LENGTH('dbo.Suppliers', 'CreditDays') IS NULL
    EXEC(N'ALTER TABLE dbo.Suppliers ADD CreditDays INT NULL');
IF COL_LENGTH('dbo.Suppliers', 'PaymentMethodImagePath') IS NULL
    EXEC(N'ALTER TABLE dbo.Suppliers ADD PaymentMethodImagePath NVARCHAR(500) NULL');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Suppliers_CreditDays')
    EXEC(N'ALTER TABLE dbo.Suppliers ADD CONSTRAINT CK_Suppliers_CreditDays CHECK (CreditDays IS NULL OR CreditDays BETWEEN 0 AND 3650)');
COMMIT TRANSACTION;
