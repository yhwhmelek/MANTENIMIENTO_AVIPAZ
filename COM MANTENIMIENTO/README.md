# API de Mantenimiento

API de autenticacion creada con FastAPI, pyodbc y SQL Server.

## Preparacion

Se necesita Python 3.10 o superior y Microsoft ODBC Driver 18 for SQL Server.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edita `.env` con los datos reales de SQL Server y una clave JWT secreta.

## Crear el primer usuario

La contrasena se solicita sin mostrarla en la terminal y solo se guarda su hash bcrypt.

```powershell
python crear_usuario.py
```

## Ejecutar la API

```powershell
uvicorn main:app --reload
```

Documentacion interactiva: http://127.0.0.1:8000/docs

## Data por tipo de elemento

Antes de iniciar esta version, ejecuta `migrations/001_element_type_data.sql`
en la base de mantenimiento desde SQL Server Management Studio. La migracion
agrega `MachineElementTypes.SpecificationType` y crea la tabla de reductores si
todavia no existe. Requiere las tablas MachineElements, MachineElementTypes y
MotorSpecifications existentes. No elimina registros.

La asignacion se deduce de la data existente. Si un tipo contiene data de motor
y de reductor, la migracion muestra los tipos afectados y revierte los cambios:
hay que corregir su clasificacion antes de repetirla. Los tipos sin data quedan
en `NONE`; configura su asignacion desde **Activos > Tipos de elementos**.

Opciones actuales: `NONE` (sin data), `MOTOR` (data de motor), `REDUCTOR` (data de
reductor). Por ejemplo, asigna Motor a MOTOR y Motorreductor a REDUCTOR.
Cada elemento muestra solo la data asignada a su tipo. La API valida esta regla
y bloquea cambios de tipo o asignacion que dejen data incompatible. La clave
primaria ElementId mantiene una sola fila por elemento en cada tabla. Las
escrituras directas a SQL deben respetar tambien la asignacion: la validacion
entre tablas se realiza en la API.

Para incorporar otra clase de data se necesita su tabla, formulario y soporte
en la API y en la restriccion de valores; crear un tipo de elemento no genera
automaticamente campos nuevos.

Pruebas de asignacion: `python -m unittest test_element_data.py`.

### Repuestos por maquina

Requiere la tabla `dbo.MachineSpareParts` creada en SQL Server con las columnas
MachineSparePartId, MachineId, ElementId (nullable), SparePartId, Position,
QuantityRequired, IsCritical, Notes, Active y CreatedAt, y sus claves foraneas.
La API no crea ni modifica esta tabla automaticamente. Ejecuta
`migrations/002_machine_spare_parts.sql` en la base de mantenimiento para crearla
o agregar las validaciones e indices si ya existe con el esquema original.
La migracion conserva los registros y revierte sus cambios ante datos invalidos.
Consulta `INVENTARIO_TECNICO.md` para la separacion entre aplicaciones tecnicas,
consumos reales y compras, y los datos requeridos por futuros indicadores.

En **Activos > Maquinas > Ver repuestos** se consultan las asignaciones agrupadas
en generales y por elemento. Desde **Elementos de maquinas > Ver repuestos** se
abre la misma pantalla filtrada al elemento seleccionado. Los administradores
pueden asignar, editar y quitar; los usuarios activos pueden consultar.

- `GET /maquinas/{machine_id}/repuestos`: lista las asignaciones activas.
- `POST /maquinas/{machine_id}/repuestos`: crea una asignacion.
- `PUT /maquinas/{machine_id}/repuestos/{relation_id}`: edita una asignacion activa.
- `DELETE /maquinas/{machine_id}/repuestos/{relation_id}`: establece `Active=0`.

POST y PUT reciben `element_id` (null para general), `spare_part_id`, `position`,
`quantity_required`, `is_critical` y `notes`. La cantidad debe ser positiva, con
un maximo de dos decimales. El elemento debe pertenecer a la maquina y el
repuesto debe estar activo. Las asignaciones no modifican existencias.

Pruebas: `python -m unittest test_machine_spare_parts test_element_data`.

### Consultas y PDF

En **Repuestos > Consultas / PDF** selecciona el tipo de consulta (maquina,
elemento o maquinas que utilizan un repuesto), busca por codigo/nombre y
selecciona el registro. El filtro opcional permite consultar solo criticos.
Se incluyen las asignaciones activas, incluso cuando el repuesto del catalogo
este inactivo, para no ocultar aplicaciones existentes.

**Imprimir / Guardar PDF** abre el dialogo del navegador: selecciona
**Guardar como PDF**. La hoja usa A4 horizontal, repite encabezados de tabla
y muestra fecha, seleccion y criticidad. No requiere instalar una biblioteca
ni enviar datos a un servicio externo. No es una descarga automatica: el
usuario elige destino y nombre en el dialogo de impresion.

La ruta autenticada `GET /reportes/repuestos` acepta `machine_id`, `element_id`
o `spare_part_id` (al menos uno) y `critical_only=true|false`. Si se combinan
identificadores, se aplican todos los filtros. Incluye categoria, marca,
numero de parte, maquina, elemento, posicion, cantidad y criticidad.
Las cantidades requeridas no representan existencias ni calculan por si
solas el stock minimo. Este reporte no incluye historial de compras.

### Compras, intervenciones y consumos

Ejecuta `migrations/003_purchases_and_maintenance_parts.sql` despues de la 002
y reinicia la API. Se agregan MaintenanceEvents, SparePartPurchases y
MaintenancePartsUsed. En **Repuestos** aparecen Compras y Consumos;
**Intervenciones** esta en **Activos**, con filtros por maquina y fechas.
Desde cada fila de Maquinas se abre su historial de intervenciones.
Primero registra la intervencion y despues sus repuestos utilizados.

Rutas autenticadas (lectura para usuarios activos, escritura para administradores):

- `GET/POST /intervenciones`
- `GET/POST /compras-repuestos`
- `GET/POST /consumos-repuestos`
- `POST /compras-repuestos/{id}/anular` con `{"reason":"motivo"}`
- `POST /consumos-repuestos/{id}/anular` con `{"reason":"motivo"}`

Las consultas de compras/consumos aceptan `spare_part_id`, `start`, `end` e
`include_voided`. Consumos acepta tambien `machine_id`. Los campos de escritura
estan documentados en `/docs`. Costo unitario sin impuestos; moneda conservada
por compra. Anular conserva el registro y excluye sus cantidades de resumenes.
Los formularios no modifican existencias. Detalles en `INVENTARIO_TECNICO.md`.

Pruebas: `python -m unittest test_parts_history test_machine_spare_parts test_element_data`.

Ejemplo de `POST /auth/login`:

```json
{
  "nombre": "admin",
  "password": "tu-contrasena"
}
```
