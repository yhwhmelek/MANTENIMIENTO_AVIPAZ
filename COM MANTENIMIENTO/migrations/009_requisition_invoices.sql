-- Adjuntos de factura; compatible con la version instalada de SQL Server.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.PurchaseRequisitionInvoices', 'U') IS NULL
CREATE TABLE dbo.PurchaseRequisitionInvoices (
    RequisitionId INT PRIMARY KEY REFERENCES dbo.PurchaseRequisitions(RequisitionId),
    Filename NVARCHAR(180) NOT NULL,
    MediaType VARCHAR(40) NOT NULL,
    Content VARBINARY(MAX) NOT NULL CHECK (DATALENGTH(Content) BETWEEN 1 AND 10485760),
    CreatedBy INT NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
COMMIT TRANSACTION;
