IF OBJECT_ID('dbo.ConsumableSuppliers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ConsumableSuppliers (
        ConsumableSupplierId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ConsumableSuppliers PRIMARY KEY,
        ConsumableId INT NOT NULL,
        SupplierId INT NOT NULL,
        SupplierItemNumber NVARCHAR(100) NULL,
        CurrentPrice DECIMAL(18,4) NULL,
        LeadTimeDays INT NULL,
        PreferredSupplier BIT NOT NULL CONSTRAINT DF_ConsumableSuppliers_Preferred DEFAULT (0),
        Notes NVARCHAR(500) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ConsumableSuppliers_CreatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_ConsumableSuppliers_Consumable FOREIGN KEY (ConsumableId) REFERENCES dbo.Consumables(ConsumableId),
        CONSTRAINT FK_ConsumableSuppliers_Supplier FOREIGN KEY (SupplierId) REFERENCES dbo.Suppliers(SupplierId),
        CONSTRAINT UQ_ConsumableSuppliers UNIQUE (ConsumableId, SupplierId),
        CONSTRAINT CK_ConsumableSuppliers_Price CHECK (CurrentPrice IS NULL OR CurrentPrice >= 0),
        CONSTRAINT CK_ConsumableSuppliers_LeadTime CHECK (LeadTimeDays IS NULL OR LeadTimeDays BETWEEN 0 AND 3650)
    );
    CREATE INDEX IX_ConsumableSuppliers_Consumable ON dbo.ConsumableSuppliers(ConsumableId);
END;
