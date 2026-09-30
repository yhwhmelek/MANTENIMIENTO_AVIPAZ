# Permisos de operadores y personal técnico

Actualización: 30/09/2026. Sustituye las reglas anteriores que daban a operadores acceso a inventario, repuestos y módulos de gestión.

- **OPERADOR:** entra directamente a Solicitudes. Puede generar solicitudes sin repuestos, consultar únicamente las propias y confirmar la conformidad después de la revisión administrativa. Conserva su perfil personal. No tiene acceso a Activos, Inventario, alertas de stock, compras, proveedores, requisiciones, programación ni períodos de operación. La selección de planta, torre y máquina sigue disponible dentro del formulario.
- **MECANICO / ELECTRICO:** pueden consultar inventario y repuestos, generar solicitudes con repuestos previstos y seleccionar los materiales realmente usados al entregar un trabajo asignado. Se conservan las validaciones de existencias y consumos. La administración del catálogo y los saldos sigue correspondiendo al administrador.
- **ADMIN:** conserva sus permisos de gestión.

La API consulta el rol vigente en la base de datos y bloquea los accesos directos del operador fuera de su flujo. Rechaza repuestos tanto en la lista actual como en el campo antiguo de la solicitud. Las solicitudes devueltas al operador no incluyen materiales ni saldos, tampoco en la programación o sus historiales. Las fotos y la recepción exigen que la solicitud pertenezca al operador.

Actualizar juntos frontend y backend y reiniciar la API. No requiere migraciones SQL. La vista se reinicia si cambia el usuario o su rol para evitar conservar pantallas de otro perfil.

Verificación: `python -m unittest discover` desde el backend y `npm run build` desde la raíz del proyecto. Las pruebas usan conexiones simuladas y no modifican la base de producción.
