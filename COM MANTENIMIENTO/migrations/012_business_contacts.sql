-- Ejecutar despues de 011. Puede volver a ejecutarse.
IF OBJECT_ID('dbo.BusinessContacts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BusinessContacts (
        ContactId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Name NVARCHAR(150) NOT NULL,
        Email NVARCHAR(254) NOT NULL,
        Mobile NVARCHAR(30) NULL,
        CONSTRAINT UQ_BusinessContacts_Email UNIQUE (Email)
    );
END;
GO
