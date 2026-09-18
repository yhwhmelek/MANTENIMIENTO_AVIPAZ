# Solicitudes de mejora técnica MT/02-08

## Solicitudes HACCP de Santa Fe (15/09/2026)

Las 29 hojas del libro entregado se extrajeron a `src/santafe-haccp-2026.json`.
Con la aplicación y la API actualizadas, un administrador abre **Solicitudes** y
pulsa **Cargar 29 mejoras HACCP · Santa Fe**. La carga crea solicitudes pendientes
en la planta Santa Fe sin asignarles torre ni máquina; puede repetirse sin duplicar
registros. El filtro **Planta** permite verlas por separado. Cada solicitud muestra
**Completar / corregir datos** mientras esté pendiente para llenar beneficios,
observaciones y otros datos que faltaban en el libro.

La carga requiere la migración 010 y que exista la planta `Santa Fe` (migración
007). Conserva el nombre original `Equipo HACCP` y la fecha y hora de cada hoja;
la cuenta administradora que ejecuta la carga queda registrada como usuario del
sistema. No se inventan torre, máquina, prioridad, ejecución ni firmas.

Mientras la mejora siga pendiente, un administrador puede abrir
**Completar / corregir datos** para editar la
ubicación, máquina opcional, fecha de detección, preevaluación, textos y respuestas
del formulario. Desde ese formulario, o al crear una solicitud, se puede adjuntar
una foto JPG, PNG o WEBP de hasta 10 MB. La API guarda el archivo en
`REQUEST_IMAGE_DIR`; si no se configura, usa `uploads/solicitudes` junto al
backend. La foto se consulta con autenticación desde el detalle. Conviene incluir
esa carpeta en los respaldos del servidor.

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
