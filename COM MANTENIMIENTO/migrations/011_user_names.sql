IF COL_LENGTH('dbo.Usuarios', 'Nombres') IS NULL
    ALTER TABLE dbo.Usuarios ADD Nombres NVARCHAR(100) NULL;
GO
IF COL_LENGTH('dbo.Usuarios', 'Apellidos') IS NULL
    ALTER TABLE dbo.Usuarios ADD Apellidos NVARCHAR(100) NULL;
GO
