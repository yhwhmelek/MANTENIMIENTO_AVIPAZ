IF OBJECT_ID('dbo.Consumables', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Consumables (
        ConsumableId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Consumables PRIMARY KEY,
        InternalCode NVARCHAR(50) NOT NULL,
        Name NVARCHAR(160) NOT NULL,
        UnitOfMeasure NVARCHAR(20) NOT NULL,
        Description NVARCHAR(500) NULL,
        Active BIT NOT NULL CONSTRAINT DF_Consumables_Active DEFAULT (1),
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Consumables_CreatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT UQ_Consumables_InternalCode UNIQUE (InternalCode),
        CONSTRAINT CK_Consumables_Name CHECK (LEN(LTRIM(RTRIM(Name))) > 0),
        CONSTRAINT CK_Consumables_Unit CHECK (LEN(LTRIM(RTRIM(UnitOfMeasure))) > 0)
    );
END;
