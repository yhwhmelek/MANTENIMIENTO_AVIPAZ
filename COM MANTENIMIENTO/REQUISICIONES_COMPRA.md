# Requisiciones de compra CO/01-01

En **Repuestos → Requisiciones de compra**, cualquier usuario activo puede completar departamento, proveedor opcional, fecha del pedido, fecha de entrega o urgencia, códigos de máquina, solicitante, observaciones y hasta 11 ítems. Cada ítem incluye descripción, cantidad, unidad y especificaciones; opcionalmente se completa desde Inventario.

**Guardar y generar Excel** descarga un `.xlsx` compatible con Excel y LibreOffice. El correo se prepara y revisa antes de enviarlo. La compra se registra al confirmar la recepción desde el historial.

La plantilla `templates/CO-01-01_requisicion_compra.xlsx` debe desplegarse junto al backend. Se basa en la primera hoja del archivo entregado, **CO/01-01, versión 03**. Conserva el logo, celdas combinadas, encabezados, tabla y espacio del responsable. Las alturas de las filas se ajustan al texto; la impresión usa A4 vertical, una página de ancho y tantas páginas de alto como sean necesarias.

El `.xls` original se convirtió una sola vez con LibreOffice. `prepare_requisition_template.py ruta/al/convertido.xlsx` reproduce la preparación: elimina datos de ejemplo, la segunda hoja, sus imágenes y metadatos de autor. La generación en el servidor utiliza únicamente la biblioteca estándar de Python; no requiere Excel ni LibreOffice instalados.

El endpoint autenticado es `POST /requisiciones-compra/archivo`. Valida campos obligatorios, cantidades positivas, máximo 11 ítems y fechas coherentes. Las entradas se escriben como texto literal, no como fórmulas; las cantidades se conservan como valores numéricos.

Verificación: `python -m unittest test_purchase_requisitions`. Se comprobó también la apertura y exportación de un documento de ejemplo en LibreOffice.
# Guardado y recepción

Los administradores ven una alerta de requisiciones pendientes de llegada, actualizada cada 30 segundos, al recuperar el foco y después de guardar o recibir una requisición. Al abrir Requisiciones, el historial de administradores muestra inicialmente solo pendientes; el filtro permite consultar también las recibidas.

Ejecutar también `migrations/009_requisition_invoices.sql` para habilitar los adjuntos. Al confirmar la recepción se puede adjuntar una factura opcional en PDF, JPG/JPEG, PNG o WEBP (máximo 10 MB). Se valida su extensión y firma binaria. El archivo se almacena en SQL Server en la misma transacción que las compras y la recepción, y puede descargarse desde el detalle de la requisición recibida. El acceso exige un usuario activo; solo los administradores pueden registrar la recepción y su adjunto. Incluir la tabla de facturas en los respaldos de la base.

Ejecutar `migrations/008_purchase_requisitions.sql` después de las migraciones 003 y 004 y reiniciar la API.

El formulario guarda primero la requisición, incluso al preparar el correo o descargar Excel. El historial permite consultar los datos originales y volver a descargar el documento. Guardar no modifica las existencias.

Un administrador confirma la llegada desde «Ver detalle», indicando proveedor activo, documento, fecha, moneda, repuesto de inventario, cantidad real y precio unitario de cada ítem. La operación registra las compras en el historial existente y cierra la requisición en una sola transacción. Las existencias incorporan esas compras automáticamente. Un bloqueo en la base impide confirmar dos veces la misma requisición.

La recepción es única y completa: no admite entregas parciales sucesivas. Las cantidades reales pueden diferir de las solicitadas. Los productos nuevos deben crearse primero en Inventario y las unidades deben coincidir. Los servicios pueden solicitarse en el documento, pero este flujo de recepción está destinado a bienes de inventario. La fecha de recepción debe ser posterior al corte de saldo inicial de los repuestos.

Las compras conservan en sus notas el número de requisición y de ítem. La requisición conserva los identificadores de compra, el administrador y los datos de recepción. Las anulaciones posteriores se gestionan en el historial de compras existente y no reabren automáticamente la requisición.

## Referencia del generador de documentos
