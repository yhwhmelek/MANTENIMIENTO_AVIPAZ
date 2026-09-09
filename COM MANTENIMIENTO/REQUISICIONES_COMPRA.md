# Requisiciones de compra CO/01-01

En **Repuestos → Requisiciones de compra**, cualquier usuario activo puede completar departamento, proveedor opcional, fecha del pedido, fecha de entrega o urgencia, códigos de máquina, solicitante, observaciones y hasta 11 ítems. Cada ítem incluye descripción, cantidad, unidad y especificaciones; opcionalmente se completa desde Inventario.

**Generar archivo Excel** descarga un `.xlsx` compatible con Excel y LibreOffice, listo para revisar y adjuntar al envío a Adquisiciones. La aplicación no envía correos ni registra compras, saldos o movimientos. No requiere migración SQL. Reiniciar la API y publicar la compilación del frontend para activarlo.

La plantilla `templates/CO-01-01_requisicion_compra.xlsx` debe desplegarse junto al backend. Se basa en la primera hoja del archivo entregado, **CO/01-01, versión 03**. Conserva el logo, celdas combinadas, encabezados, tabla y espacio del responsable. Las alturas de las filas se ajustan al texto; la impresión usa A4 vertical, una página de ancho y tantas páginas de alto como sean necesarias.

El `.xls` original se convirtió una sola vez con LibreOffice. `prepare_requisition_template.py ruta/al/convertido.xlsx` reproduce la preparación: elimina datos de ejemplo, la segunda hoja, sus imágenes y metadatos de autor. La generación en el servidor utiliza únicamente la biblioteca estándar de Python; no requiere Excel ni LibreOffice instalados.

El endpoint autenticado es `POST /requisiciones-compra/archivo`. Valida campos obligatorios, cantidades positivas, máximo 11 ítems y fechas coherentes. Las entradas se escriben como texto literal, no como fórmulas; las cantidades se conservan como valores numéricos.

Verificación: `python -m unittest test_purchase_requisitions`. Se comprobó también la apertura y exportación de un documento de ejemplo en LibreOffice.
