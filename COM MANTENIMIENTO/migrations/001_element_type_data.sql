-- Ejecutar en la base de mantenimiento antes de iniciar la nueva API.
-- No elimina data. Los tipos sin registros quedan en NONE para asignarlos en la UI.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.GearReducerSpecifications', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.GearReducerSpecifications (
            ElementId INT NOT NULL PRIMARY KEY,
            ReductionRatio DECIMAL(12,4) NULL,
            InputRPM INT NULL,
            OutputRPM INT NULL,
            RatedTorqueNm DECIMAL(18,2) NULL,
            ServiceFactor DECIMAL(8,2) NULL,
            OilType NVARCHAR(150) NULL,
            OilViscosityISO NVARCHAR(50) NULL,
            OilQuantityL DECIMAL(10,2) NULL,
            MountingPosition NVARCHAR(50) NULL,
            InputBearing NVARCHAR(100) NULL,
            OutputBearing NVARCHAR(100) NULL,
            Notes NVARCHAR(500) NULL,
            CONSTRAINT FK_GearReducerSpecifications_Element FOREIGN KEY (ElementId)
                REFERENCES dbo.MachineElements(ElementId)
        );
    END;

    -- Un tipo no puede tener elementos con distintas clases de data.
    SELECT DISTINCT e.ElementTypeId, 'MOTOR' AS DataType
    INTO #ExistingDataTypes
    FROM dbo.MachineElements e WITH (TABLOCKX, HOLDLOCK)
    JOIN dbo.MotorSpecifications m WITH (TABLOCKX, HOLDLOCK) ON m.ElementId = e.ElementId
    UNION
    SELECT DISTINCT e.ElementTypeId, 'REDUCTOR'
    FROM dbo.MachineElements e
    JOIN dbo.GearReducerSpecifications r WITH (TABLOCKX, HOLDLOCK) ON r.ElementId = e.ElementId;

    IF EXISTS (SELECT ElementTypeId FROM #ExistingDataTypes GROUP BY ElementTypeId HAVING COUNT(*) > 1)
    BEGIN
        SELECT t.ElementTypeId, t.Name, d.DataType
        FROM dbo.MachineElementTypes t
        JOIN #ExistingDataTypes d ON d.ElementTypeId = t.ElementTypeId
        WHERE t.ElementTypeId IN (
            SELECT ElementTypeId FROM #ExistingDataTypes GROUP BY ElementTypeId HAVING COUNT(*) > 1
        );
        THROW 50001, 'Hay tipos con data de motor y reductor. Separa esos tipos o corrige la data antes de migrar. No se ha eliminado ningun registro.', 1;
    END;

    IF COL_LENGTH('dbo.MachineElementTypes', 'SpecificationType') IS NULL
    BEGIN
        ALTER TABLE dbo.MachineElementTypes ADD SpecificationType VARCHAR(20) NOT NULL
            CONSTRAINT DF_MachineElementTypes_SpecificationType DEFAULT ('NONE') WITH VALUES;
        -- SQL dinamico para compilar despues de agregar la columna.
        EXEC sp_executesql N'UPDATE t SET SpecificationType = d.DataType
            FROM dbo.MachineElementTypes t
            JOIN #ExistingDataTypes d ON d.ElementTypeId = t.ElementTypeId;';
    END;

    EXEC sp_executesql N'IF EXISTS (
        SELECT 1 FROM dbo.MachineElementTypes t
        JOIN #ExistingDataTypes d ON d.ElementTypeId = t.ElementTypeId
        WHERE t.SpecificationType <> d.DataType
    ) THROW 50002, ''La asignacion existente no coincide con la data guardada.'', 1;';

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.MachineElementTypes') AND name = 'CK_MachineElementTypes_SpecificationType')
        EXEC sp_executesql N'ALTER TABLE dbo.MachineElementTypes WITH CHECK
            ADD CONSTRAINT CK_MachineElementTypes_SpecificationType
            CHECK (SpecificationType IN (''NONE'', ''MOTOR'', ''REDUCTOR''));';

    DROP TABLE #ExistingDataTypes;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
