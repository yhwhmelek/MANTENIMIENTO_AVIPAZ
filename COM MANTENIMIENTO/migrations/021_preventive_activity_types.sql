-- Catalogo administrable de tipos de actividad preventiva.
SET XACT_ABORT ON;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID('dbo.PreventiveActivityTypes','U') IS NULL
 BEGIN
  CREATE TABLE dbo.PreventiveActivityTypes (
   TypeCode NVARCHAR(50) NOT NULL PRIMARY KEY,
   Name NVARCHAR(150) NOT NULL,
   RequiresPoints BIT NOT NULL DEFAULT 0,
   Active BIT NOT NULL DEFAULT 1,
   CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
   UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
 END;
 MERGE dbo.PreventiveActivityTypes AS target
 USING (VALUES
  (N'GENERAL',N'Inspección / general',0,1),
  (N'ENGRASE',N'Engrase de chumaceras',1,1),
  (N'ACEITE',N'Cambio de aceite',0,1),
  (N'RODAMIENTOS',N'Rodamientos',1,1),
  (N'BOBINADO',N'Inspección / limpieza del bobinado',1,1)
 ) AS source(TypeCode,Name,RequiresPoints,Active)
 ON target.TypeCode=source.TypeCode
 WHEN NOT MATCHED THEN INSERT(TypeCode,Name,RequiresPoints,Active) VALUES(source.TypeCode,source.Name,source.RequiresPoints,source.Active);
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
