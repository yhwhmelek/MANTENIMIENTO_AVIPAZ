-- Permite asignar las especialidades Mecánico y Eléctrico a los usuarios.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @name SYSNAME, @definition NVARCHAR(MAX), @sql NVARCHAR(MAX);
    DECLARE role_checks CURSOR LOCAL FAST_FORWARD FOR
        SELECT name, definition
        FROM sys.check_constraints
        WHERE parent_object_id=OBJECT_ID('dbo.Usuarios')
          AND definition LIKE '%Rol%'
          AND definition LIKE '%''USUARIO''%'
          AND (definition NOT LIKE '%''MECANICO''%' OR definition NOT LIKE '%''ELECTRICO''%');
    OPEN role_checks;
    FETCH NEXT FROM role_checks INTO @name, @definition;
    WHILE @@FETCH_STATUS=0
    BEGIN
        SET @sql=N'ALTER TABLE dbo.Usuarios DROP CONSTRAINT '+QUOTENAME(@name)+N';'
            +N'ALTER TABLE dbo.Usuarios WITH CHECK ADD CONSTRAINT '+QUOTENAME(@name)
            +N' CHECK (('+@definition+N') OR ('+REPLACE(@definition,'''USUARIO''','''MECANICO''')
            +N') OR ('+REPLACE(@definition,'''USUARIO''','''ELECTRICO''')+N'));';
        EXEC sp_executesql @sql;
        FETCH NEXT FROM role_checks INTO @name, @definition;
    END;
    CLOSE role_checks;
    DEALLOCATE role_checks;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF CURSOR_STATUS('local','role_checks')>=0 CLOSE role_checks;
    IF CURSOR_STATUS('local','role_checks')>-3 DEALLOCATE role_checks;
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
