-- Registro de contratistas para la asignación de solicitudes.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF OBJECT_ID('dbo.Contractors','U') IS NULL
    BEGIN
        CREATE TABLE dbo.Contractors (
            ContractorId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            Name NVARCHAR(150) NOT NULL,
            Specialty VARCHAR(20) NOT NULL CHECK (Specialty IN ('MECANICO','ELECTRICO','OTRO')),
            Email NVARCHAR(254) NULL,
            Phone NVARCHAR(30) NULL,
            Active BIT NOT NULL CONSTRAINT DF_Contractors_Active DEFAULT 1,
            CONSTRAINT UQ_Contractors_Name UNIQUE(Name)
        );
    END;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
