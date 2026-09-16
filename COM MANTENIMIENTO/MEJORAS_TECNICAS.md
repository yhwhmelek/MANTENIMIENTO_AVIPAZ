# Solicitudes de mejora técnica MT/02-08

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
