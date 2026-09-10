-- SQL Server 2014 (12.x). Las maquinas existentes conservan sus identificadores e historial.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.Machines','U') IS NULL
        THROW 50600, 'No existe dbo.Machines.', 1;
    IF OBJECT_ID('dbo.Plants','U') IS NULL
        CREATE TABLE dbo.Plants (
            PlantId INT IDENTITY PRIMARY KEY,
            Name NVARCHAR(100) NOT NULL UNIQUE CHECK (LEN(LTRIM(RTRIM(Name)))>0)
        );
    IF OBJECT_ID('dbo.Towers','U') IS NULL
        CREATE TABLE dbo.Towers (
            TowerId INT IDENTITY PRIMARY KEY,
            PlantId INT NOT NULL REFERENCES dbo.Plants(PlantId),
            Name NVARCHAR(100) NOT NULL CHECK (LEN(LTRIM(RTRIM(Name)))>0),
            CONSTRAINT UQ_Towers_Plant_Name UNIQUE (PlantId,Name)
        );
    IF COL_LENGTH('dbo.Machines','TowerId') IS NULL
        ALTER TABLE dbo.Machines ADD TowerId INT NULL
            CONSTRAINT FK_Machines_Tower REFERENCES dbo.Towers(TowerId);
    EXEC sp_executesql N'
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(''dbo.Machines'') AND name=''IX_Machines_Tower'')
            CREATE INDEX IX_Machines_Tower ON dbo.Machines(TowerId);
        IF NOT EXISTS (SELECT 1 FROM dbo.Plants WHERE Name=N''Samanga'')
            INSERT INTO dbo.Plants(Name) VALUES(N''Samanga'');
        IF NOT EXISTS (SELECT 1 FROM dbo.Plants WHERE Name=N''Santa Fe'')
            INSERT INTO dbo.Plants(Name) VALUES(N''Santa Fe'');
        INSERT INTO dbo.Towers(PlantId,Name)
        SELECT p.PlantId,v.TowerName FROM (VALUES
            (N''Santa Fe'',N''Torre 1''),(N''Santa Fe'',N''Torre 2''),
            (N''Samanga'',N''Torre 5''),(N''Samanga'',N''Torre 6''),(N''Samanga'',N''Torre 7'')
        ) v(PlantName,TowerName) JOIN dbo.Plants p ON p.Name=v.PlantName
        WHERE NOT EXISTS (SELECT 1 FROM dbo.Towers t WHERE t.PlantId=p.PlantId AND t.Name=v.TowerName);
    ';
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
