# Solicitudes de mejora técnica MT/02-08

## Solicitudes HACCP de Santa Fe (15/09/2026)

Las 29 solicitudes y sus fotos ya fueron incorporadas a la planta Santa Fe. La aplicación ya no expone funciones de importación para evitar que esta carga inicial se repita. Los registros existentes conservan su solicitante, fecha, datos técnicos y fotos.
Mientras la mejora siga pendiente, un administrador u operador puede pulsar
**Modificar** en la lista de actividades, en el listado general o en la parte
superior del detalle para editar la
ubicación, máquina opcional, fecha de detección, preevaluación, textos y respuestas
del formulario. Desde ese formulario, o al crear una solicitud, se puede adjuntar
una foto JPG, PNG o WEBP de hasta 10 MB. La API guarda esta foto y las nuevas
fotos de máquinas, elementos, placas de motor y repuestos en `IMAGE_DIR`; si no
se configura, usa `uploads/solicitudes` junto al backend. Las imágenes ya
registradas en las rutas antiguas siguen disponibles para consulta. Conviene
incluir la carpeta nueva y las anteriores en los respaldos del servidor.

Actualización 16/09/2026: ver `PRIORIZACION_NIC.md`. El solicitante registra
beneficios y preevaluación NIC; la verificación técnica pertenece a Mantenimiento.
La ejecución requiere validación oficial y programación. La impresión utiliza
los formatos actualizados entregados en esa fecha. Las secciones siguientes
describen la integración inicial y deben leerse con esta actualización.

En Solicitudes → Generar solicitud, seleccionar «Mejora técnica (MT/02-08)».
Comparte la bandeja, alertas, permisos y estados con mantenimiento correctivo:
PENDIENTE → EN_PROCESO → POR_RECIBIR → CERRADA.

El formulario recoge situación actual, área solicitante, equipo/sistema/área,
propuesta y evaluación técnica (inocuidad, parada de producción, capacitación,
seguridad operacional), con respuesta sí/no y observaciones por pregunta.
Se puede asociar una máquina o indicar un área sin máquina, como en los ejemplos
del documento proporcionado. No se registra como falla correctiva.

La entrega exige trabajo realizado y resultado de mejora. Los materiales del
inventario se consumen con las mismas validaciones de stock y transacción del
flujo existente. Otros materiales, como material recuperado, se describen aparte
y no modifican existencias. La recepción se confirma con las mismas reglas.

La impresión/PDF tiene los campos y secciones del MT/02-08 versión 00, con
espacios de firma y fechas de las acciones registradas; no copia datos de los
ejemplos del Excel. El diseño HTML se adapta al contenido y no es una reproducción
exacta de las dimensiones de las celdas del archivo Excel.

## Instalación en el servidor

1. Respaldar la base y ejecutar `migrations/010_technical_improvement_requests.sql`
   después de las migraciones existentes. Permite MachineId nulo en solicitudes
   e intervenciones y amplía el tipo de intervención a MEJORA_TECNICA.
2. Actualizar backend y frontend; reiniciar la API y publicar `npm run build`
   (o reiniciar Vite si se usa en desarrollo).

Las consultas de intervenciones y consumos incluyen también los registros sin
máquina. Las solicitudes correctivas y preventivas siguen exigiendo máquina.

Verificación: `python -m unittest test_maintenance_requests test_parts_history test_stock_alerts`.
