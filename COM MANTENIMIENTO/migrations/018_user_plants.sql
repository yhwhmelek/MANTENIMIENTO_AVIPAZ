-- SQL Server 2014. Existing staff must be assigned a plant by an administrator.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.Usuarios', 'PlantId') IS NULL
    ALTER TABLE dbo.Usuarios ADD PlantId INT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_Usuarios_Plants')
    EXEC('ALTER TABLE dbo.Usuarios ADD CONSTRAINT FK_Usuarios_Plants
        FOREIGN KEY (PlantId) REFERENCES dbo.Plants(PlantId)');
-- Extend role checks while preserving the existing accepted roles and other conditions.
DECLARE @name SYSNAME, @definition NVARCHAR(MAX), @sql NVARCHAR(MAX);
DECLARE technician_checks CURSOR LOCAL FAST_FORWARD FOR
    SELECT name, definition FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID('dbo.Usuarios')
      AND definition LIKE '%Rol%' AND definition LIKE '%''USUARIO''%'
      AND definition NOT LIKE '%''TECNICO''%';
OPEN technician_checks;
FETCH NEXT FROM technician_checks INTO @name,@definition;
WHILE @@FETCH_STATUS=0
BEGIN
    SET @sql=N'ALTER TABLE dbo.Usuarios DROP CONSTRAINT '+QUOTENAME(@name)+N';'
        +N'ALTER TABLE dbo.Usuarios WITH CHECK ADD CONSTRAINT '+QUOTENAME(@name)
        +N' CHECK (('+@definition+N') OR ('+REPLACE(@definition,'''USUARIO''','''TECNICO''')+N'));';
    EXEC sp_executesql @sql;
    FETCH NEXT FROM technician_checks INTO @name,@definition;
END;
CLOSE technician_checks;
DEALLOCATE technician_checks;
COMMIT TRANSACTION;
