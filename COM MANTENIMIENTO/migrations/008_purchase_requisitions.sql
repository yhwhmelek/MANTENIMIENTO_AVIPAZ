-- Ejecutar despues de 003 y 004 en la base de mantenimiento.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.PurchaseRequisitions', 'U') IS NULL
CREATE TABLE dbo.PurchaseRequisitions (
    RequisitionId INT IDENTITY PRIMARY KEY,
    Payload NVARCHAR(MAX) NOT NULL,
    CreatedBy INT NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    ReceivedAt DATETIME2 NULL,
    ReceivedBy INT NULL,
    Receipt NVARCHAR(MAX) NULL,
    CONSTRAINT CK_PurchaseRequisitions_Receipt CHECK (
        (ReceivedAt IS NULL AND ReceivedBy IS NULL AND Receipt IS NULL) OR
        (ReceivedAt IS NOT NULL AND ReceivedBy IS NOT NULL AND Receipt IS NOT NULL))
);
COMMIT TRANSACTION;
