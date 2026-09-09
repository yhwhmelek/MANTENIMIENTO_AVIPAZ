-- Ejecutar despues de 002 en la base de mantenimiento. No modifica existencias.
-- Compras y consumos son hechos historicos: se anulan con motivo, no se borran.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.MachineSpareParts', 'U') IS NULL OR OBJECT_ID('dbo.Suppliers', 'U') IS NULL
        THROW 50200, 'Ejecuta 002 y verifica que exista dbo.Suppliers.', 1;

    IF OBJECT_ID('dbo.MaintenanceEvents', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MaintenanceEvents (
            MaintenanceEventId INT IDENTITY PRIMARY KEY,
            MachineId INT NOT NULL REFERENCES dbo.Machines(MachineId),
            ElementId INT NULL,
            PerformedOn DATE NOT NULL,
            MaintenanceType VARCHAR(20) NOT NULL CHECK (MaintenanceType IN ('PREVENTIVO','CORRECTIVO')),
            Description NVARCHAR(500) NOT NULL CHECK (LEN(LTRIM(RTRIM(Description)))>0),
            CreatedBy INT NOT NULL,
            CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
            CONSTRAINT FK_MaintenanceEvents_Element FOREIGN KEY (MachineId, ElementId)
                REFERENCES dbo.MachineElements(MachineId, ElementId)
        );
    END;
    IF OBJECT_ID('dbo.SparePartPurchases', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.SparePartPurchases (
            SparePartPurchaseId INT IDENTITY PRIMARY KEY,
            SparePartId INT NOT NULL REFERENCES dbo.SpareParts(SparePartId),
            SupplierId INT NOT NULL REFERENCES dbo.Suppliers(SupplierId),
            PurchasedOn DATE NOT NULL,
            Quantity DECIMAL(10,2) NOT NULL CHECK (Quantity>0),
            UnitCost DECIMAL(18,4) NOT NULL CHECK (UnitCost>=0),
            Currency CHAR(3) NOT NULL DEFAULT 'USD',
            UnitOfMeasure NVARCHAR(20) NOT NULL,
            DocumentNumber NVARCHAR(100) NOT NULL CHECK (LEN(LTRIM(RTRIM(DocumentNumber)))>0),
            Notes NVARCHAR(500) NULL,
            CreatedBy INT NOT NULL,
            CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
            VoidedAt DATETIME2 NULL,
            VoidedBy INT NULL,
            VoidReason NVARCHAR(500) NULL,
            CONSTRAINT CK_SparePartPurchases_Void CHECK (
                (VoidedAt IS NULL AND VoidedBy IS NULL AND VoidReason IS NULL) OR
                (VoidedAt IS NOT NULL AND VoidedBy IS NOT NULL AND VoidReason IS NOT NULL AND LEN(LTRIM(RTRIM(VoidReason)))>0))
        );
    END;
    IF OBJECT_ID('dbo.MaintenancePartsUsed', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MaintenancePartsUsed (
            MaintenancePartUsedId INT IDENTITY PRIMARY KEY,
            MaintenanceEventId INT NOT NULL REFERENCES dbo.MaintenanceEvents(MaintenanceEventId),
            SparePartId INT NOT NULL REFERENCES dbo.SpareParts(SparePartId),
            Quantity DECIMAL(10,2) NOT NULL CHECK (Quantity>0),
            UnitOfMeasure NVARCHAR(20) NOT NULL,
            Position NVARCHAR(150) NULL,
            RemovedInstalledHourMeter DECIMAL(12,2) NULL,
            RemovedHourMeter DECIMAL(12,2) NULL,
            Notes NVARCHAR(500) NULL,
            CreatedBy INT NOT NULL,
            CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
            VoidedAt DATETIME2 NULL,
            VoidedBy INT NULL,
            VoidReason NVARCHAR(500) NULL,
            CONSTRAINT CK_MaintenancePartsUsed_Hours CHECK (
                (RemovedInstalledHourMeter IS NULL AND RemovedHourMeter IS NULL) OR
                (RemovedInstalledHourMeter IS NOT NULL AND RemovedHourMeter IS NOT NULL
                 AND RemovedInstalledHourMeter>=0 AND RemovedHourMeter>=RemovedInstalledHourMeter AND Quantity=1)),
            CONSTRAINT CK_MaintenancePartsUsed_Void CHECK (
                (VoidedAt IS NULL AND VoidedBy IS NULL AND VoidReason IS NULL) OR
                (VoidedAt IS NOT NULL AND VoidedBy IS NOT NULL AND VoidReason IS NOT NULL AND LEN(LTRIM(RTRIM(VoidReason)))>0))
        );
    END;
    EXEC sp_executesql N'
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.SparePartPurchases'') AND name=''IX_SparePartPurchases_History'')
            CREATE INDEX IX_SparePartPurchases_History ON dbo.SparePartPurchases(SparePartId, PurchasedOn, SparePartPurchaseId);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.MaintenancePartsUsed'') AND name=''IX_MaintenancePartsUsed_History'')
            CREATE INDEX IX_MaintenancePartsUsed_History ON dbo.MaintenancePartsUsed(SparePartId, MaintenanceEventId);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.MaintenanceEvents'') AND name=''IX_MaintenanceEvents_Machine_Date'')
            CREATE INDEX IX_MaintenanceEvents_Machine_Date ON dbo.MaintenanceEvents(MachineId, PerformedOn);
    ';
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
