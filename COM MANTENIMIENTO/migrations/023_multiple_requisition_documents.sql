-- Ejecutar despues de 009 para permitir varios documentos por requisicion.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.PurchaseRequisitionInvoices', 'U') IS NULL
    THROW 50201, 'Ejecuta primero 009_requisition_invoices.sql.', 1;

IF COL_LENGTH('dbo.PurchaseRequisitionInvoices', 'InvoiceId') IS NULL
BEGIN
    ALTER TABLE dbo.PurchaseRequisitionInvoices ADD InvoiceId INT IDENTITY(1,1) NOT NULL;

    DECLARE @primary_key sysname;
    SELECT @primary_key = kc.name
    FROM sys.key_constraints kc
    INNER JOIN sys.tables t ON t.object_id = kc.parent_object_id
    WHERE kc.type = 'PK' AND t.object_id = OBJECT_ID('dbo.PurchaseRequisitionInvoices');

    IF @primary_key IS NOT NULL
    BEGIN
        DECLARE @drop_primary_key nvarchar(4000);
        SET @drop_primary_key = N'ALTER TABLE dbo.PurchaseRequisitionInvoices DROP CONSTRAINT ' + QUOTENAME(@primary_key);
        EXEC(@drop_primary_key);
    END;
    EXEC(N'ALTER TABLE dbo.PurchaseRequisitionInvoices ADD CONSTRAINT PK_PurchaseRequisitionInvoices PRIMARY KEY (InvoiceId)');
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PurchaseRequisitionInvoices_RequisitionId'
               AND object_id = OBJECT_ID('dbo.PurchaseRequisitionInvoices'))
    EXEC(N'CREATE INDEX IX_PurchaseRequisitionInvoices_RequisitionId
        ON dbo.PurchaseRequisitionInvoices(RequisitionId, InvoiceId)');
COMMIT TRANSACTION;
