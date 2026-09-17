# Contactos para correos de requisiciones

Ejecutar `migrations/012_business_contacts.sql` en la base de mantenimiento después de la migración 011 y reiniciar la API. La API no aplica migraciones automáticamente.

Los administradores gestionan contactos empresariales en **Usuarios** con nombre, correo y celular opcional. Al preparar un correo de requisición, las listas **Para** y **Copia** ofrecen contactos empresariales, proveedores activos con correo y usuarios activos. También se pueden escribir direcciones manualmente. Los contactos seleccionados se agregan al campo correspondiente; el correo se envía solo al pulsar **Enviar correo con Excel**.
