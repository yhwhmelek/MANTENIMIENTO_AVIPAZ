-- Ejecutar en la base de mantenimiento. Puede repetirse.
-- Aplicaciones tecnicas de repuestos: NO registra compras, consumos ni stock.
-- Si hay datos invalidos, revierte todos los cambios sin eliminar registros.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.Machines', 'U') IS NULL
        OR OBJECT_ID('dbo.MachineElements', 'U') IS NULL
        OR OBJECT_ID('dbo.SpareParts', 'U') IS NULL
        THROW 50100, 'Faltan las tablas Machines, MachineElements o SpareParts en esta base.', 1;

    -- SQL Server requiere una clave unica para la FK compuesta.
    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes i
        WHERE i.object_id = OBJECT_ID('dbo.MachineElements')
          AND i.is_unique = 1 AND i.has_filter = 0 AND i.is_disabled = 0
          AND (SELECT COUNT(*) FROM sys.index_columns ic
               WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal>0) = 2
          AND EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c
                      ON c.object_id=ic.object_id AND c.column_id=ic.column_id
                      WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id
                        AND ic.key_ordinal=1 AND c.name='MachineId')
          AND EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c
                      ON c.object_id=ic.object_id AND c.column_id=ic.column_id
                      WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id
                        AND ic.key_ordinal=2 AND c.name='ElementId')
    )
        ALTER TABLE dbo.MachineElements ADD CONSTRAINT UQ_MachineElements_MachineId_ElementId
            UNIQUE (MachineId, ElementId);

    IF OBJECT_ID('dbo.MachineSpareParts', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MachineSpareParts (
            MachineSparePartId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            MachineId INT NOT NULL,
            ElementId INT NULL,
            SparePartId INT NOT NULL,
            Position NVARCHAR(150) NULL,
            QuantityRequired DECIMAL(10,2) NOT NULL
                CONSTRAINT DF_MachineSpareParts_QuantityRequired DEFAULT (1),
            IsCritical BIT NOT NULL CONSTRAINT DF_MachineSpareParts_IsCritical DEFAULT (0),
            Notes NVARCHAR(500) NULL,
            Active BIT NOT NULL CONSTRAINT DF_MachineSpareParts_Active DEFAULT (1),
            CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_MachineSpareParts_CreatedAt DEFAULT (SYSDATETIME())
        );
    END;

    -- Compilar despues de crear la tabla. WITH CHECK valida tambien la data existente.
    EXEC sp_executesql N'
        IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(''dbo.MachineSpareParts'') AND name=''FK_MachineSpareParts_Machine'')
            ALTER TABLE dbo.MachineSpareParts WITH CHECK ADD CONSTRAINT FK_MachineSpareParts_Machine
                FOREIGN KEY (MachineId) REFERENCES dbo.Machines(MachineId);
        IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(''dbo.MachineSpareParts'') AND name=''FK_MachineSpareParts_Element'')
            ALTER TABLE dbo.MachineSpareParts WITH CHECK ADD CONSTRAINT FK_MachineSpareParts_Element
                FOREIGN KEY (MachineId, ElementId) REFERENCES dbo.MachineElements(MachineId, ElementId);
        IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(''dbo.MachineSpareParts'') AND name=''FK_MachineSpareParts_SparePart'')
            ALTER TABLE dbo.MachineSpareParts WITH CHECK ADD CONSTRAINT FK_MachineSpareParts_SparePart
                FOREIGN KEY (SparePartId) REFERENCES dbo.SpareParts(SparePartId);

        IF EXISTS (SELECT 1 FROM dbo.MachineSpareParts WHERE QuantityRequired<=0 OR QuantityRequired IS NULL)
            THROW 50101, ''Hay cantidades requeridas invalidas. Corrigelas antes de repetir la migracion.'', 1;
        IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(''dbo.MachineSpareParts'') AND name=''CK_MachineSpareParts_QuantityRequired'')
            ALTER TABLE dbo.MachineSpareParts WITH CHECK ADD CONSTRAINT CK_MachineSpareParts_QuantityRequired
                CHECK (QuantityRequired IS NOT NULL AND QuantityRequired>0);

        ALTER TABLE dbo.MachineSpareParts WITH CHECK CHECK CONSTRAINT FK_MachineSpareParts_Machine;
        ALTER TABLE dbo.MachineSpareParts WITH CHECK CHECK CONSTRAINT FK_MachineSpareParts_Element;
        ALTER TABLE dbo.MachineSpareParts WITH CHECK CHECK CONSTRAINT FK_MachineSpareParts_SparePart;
        ALTER TABLE dbo.MachineSpareParts WITH CHECK CHECK CONSTRAINT CK_MachineSpareParts_QuantityRequired;

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.MachineSpareParts'') AND name=''IX_MachineSpareParts_Machine_Element_Active'')
            CREATE INDEX IX_MachineSpareParts_Machine_Element_Active
                ON dbo.MachineSpareParts(MachineId, ElementId, Active) INCLUDE (SparePartId);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.MachineSpareParts'') AND name=''IX_MachineSpareParts_SparePart_Active'')
            CREATE INDEX IX_MachineSpareParts_SparePart_Active
                ON dbo.MachineSpareParts(SparePartId, Active) INCLUDE (MachineId, ElementId);
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.MachineSpareParts'') AND name=''IX_MachineSpareParts_Element_Active'')
            CREATE INDEX IX_MachineSpareParts_Element_Active
                ON dbo.MachineSpareParts(ElementId, Active) INCLUDE (MachineId, SparePartId);
    ';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
