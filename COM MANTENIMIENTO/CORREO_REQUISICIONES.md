# Correo de requisiciones

En Repuestos → Requisiciones de compra, completar la requisición y pulsar **Preparar envío por correo**. Revisar Para, CC, asunto y descripción; pulsar **Enviar correo con Excel** y confirmar. Se genera el adjunto con los datos capturados al preparar el envío. No registra compras ni afecta stock.

Configurar estas variables en `COM MANTENIMIENTO/.env`, junto a `main.py`, y reiniciar el backend. Ya se añadieron al archivo existente; solo falta completar la contraseña. No borrar las variables de base de datos y autenticación. `.env.example` sirve como referencia:

```text
REQUISITION_SMTP_HOST=mail.avipaz.ec
REQUISITION_SMTP_PORT=465
REQUISITION_SMTP_USER=mantenimientosamanga@avipaz.ec
REQUISITION_SMTP_PASSWORD=<contraseña del correo>
```

La contraseña se configura solo en el servidor, nunca en React ni en archivos versionados. Escribirla entre comillas en `REQUISITION_SMTP_PASSWORD`. `main.py` ya carga este `.env` con python-dotenv al iniciar, independientemente de la carpeta de la terminal; los valores del archivo tienen prioridad sobre las variables del sistema. Se usa SMTP con SSL/TLS y validación de certificado. IMAP 993 no se utiliza para enviar.

El permiso de envío corresponde a los usuarios activos que pueden generar requisiciones. Los destinatarios se escriben explícitamente, separados por coma o punto y coma; no hay destinatarios predefinidos ni agenda persistente. Se conserva el borrador de direcciones mientras la ventana está montada. No se envían correos automáticamente ni se reintentan fallos. Una respuesta exitosa significa aceptación por SMTP, no confirmación de lectura o entrega final. Un envío parcial indica las direcciones rechazadas. Ante un resultado incierto, verificar recepción antes de repetir.

La configuración y entrega reales no se han probado: las pruebas usan SMTP simulado. No requiere migración SQL.
