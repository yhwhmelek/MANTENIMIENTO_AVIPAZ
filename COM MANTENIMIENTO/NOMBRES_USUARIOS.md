# Nombre y apellido de usuarios

Antes de iniciar esta versión, ejecutar `migrations/011_user_names.sql` en la base de mantenimiento y reiniciar la API. La API no aplica migraciones automáticamente.

La migración agrega `Nombres` y `Apellidos` a `dbo.Usuarios` sin modificar `Nombre`, que sigue siendo el usuario de acceso. Las cuentas existentes conservan sus datos; un administrador puede completar nombre y apellido en **Usuarios**. Hasta hacerlo, la interfaz muestra el usuario como valor provisional.

Las solicitudes consultan el nombre completo actual de cada participante. La trazabilidad de prioridad antigua se resuelve por el ID de usuario cuando se consulta; las requisiciones de compra ya guardadas conservan el texto del solicitante que se introdujo originalmente.
