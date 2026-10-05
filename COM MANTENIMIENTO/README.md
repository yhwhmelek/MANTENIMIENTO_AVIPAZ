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

### Planes preventivos generales

Aplica `migrations/016_general_preventive_plans.sql` después de la 015 y reinicia
la API. También puedes ejecutar `python migrate_preventive.py --apply`, que
comprueba/instala ambas migraciones. `--check` indica si los planes generales
están habilitados. La migración permite planes sin una máquina individual y
conserva los planes y las órdenes existentes.

En **Actividades y frecuencias**, crea una actividad con alcance **General para
varias máquinas**, una hora sugerida y la duración total del trabajo. En
**Planes de mantenimiento → Asignar actividad general**, marca las máquinas
(o selecciona todas las visibles tras filtrar), la primera fecha y la hora.
Al publicar se genera una sola solicitud por vencimiento, una alerta y una
fila semanal, independientemente del número de máquinas. La selección queda
conservada en la orden y en la hoja «Maquinas incluidas» del Excel.

Los planes existentes siguen siendo específicos. No se convierten ni se
agrupan automáticamente. Al sustituirlos por un plan general, desactiva los
planes específicos equivalentes para evitar trabajos duplicados en próximos
ciclos. Las órdenes abiertas mantienen su seguimiento e historial original.

Pruebas: `python -m unittest test_preventive_maintenance test_general_preventive`;
interfaz simulada: `python smoke_general_preventive_ui.py`.

Las frecuencias por horas admiten un primer cambio, un intervalo posterior y
horas de aviso anticipado. Ejemplo ilustrativo: primero a 50 h, luego cada
500 h desde el cambio realmente realizado, aviso 10 h antes. No son valores
técnicos recomendados para ningún equipo; se configuran según su procedimiento.

Aplica también `migrations/017_preventive_operating_hours.sql` (incluida en
`python migrate_preventive.py --apply`) y reinicia la API. En **Preventivos →
Horómetros y avisos** se registran lecturas manuales. Los avisos se actualizan
al guardar y cada 30 segundos en la ventana de alertas. El administrador
prepara/publica la orden desde el calendario cuando el plan entra en aviso.
Los planes generales agrupan en una orden las máquinas que alcanzaron el umbral;
las que todavía no lo alcanzan conservan su propio seguimiento.

Al entregar un preventivo por horas realizado se exige la lectura final de
cada máquina incluida. Esa lectura inicia el intervalo siguiente; los trabajos
no realizados no reinician el intervalo. Para equipos nuevos la referencia
acumulada es 0. Para equipos con cambios previos, marca que el primer cambio
ya se realizó y registra la referencia acumulada de ese último cambio.

El contador del PLC y las horas acumuladas se conservan por separado. Registra
la lectura final **antes de resetear el PLC** y confirma el reset al registrar
la primera lectura posterior. Un reset por sí solo no significa que el cambio
se haya realizado. Si falta la lectura final previa al reset, no se pueden
reconstruir las horas perdidas. La integración física con el PLC aún no está
conectada. Su futuro importador deberá enviar la lectura final y el evento de
reset explícito, no deducirlos de una lectura baja aislada.

Rutas autenticadas: `GET/POST /preventivos/horometros`,
`GET /preventivos/estado-horas`, `GET /preventivos/alertas-horas`.
El POST recibe `machine_id`, `hours` (contador del PLC), `observed_at` (hora
local de Ecuador, opcional) y `counter_reset` (predeterminado false).
Las lecturas del mismo instante son idempotentes si el valor coincide.
Las nuevas frecuencias admiten semanas/horas; los días/meses anteriores se
conservan. Pruebas: `python -m unittest test_preventive_frequency test_preventive_hours`.

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

### Planta del personal y rol Técnico

Antes de actualizar la API, ejecutar `python migrate_user_plants.py --apply`
(requiere las migraciones previas, incluida 007 para plantas y 013 para roles).
Aplicar `018_user_plants.sql` agrega `Usuarios.PlantId` con referencia a `Plants`
y permite el rol `TECNICO` en las restricciones existentes. Es repetible y no
asigna plantas automáticamente. Reiniciar la API y publicar el contenido de `dist`.

En **Usuarios**, el administrador selecciona el rol y la planta de cada persona
desde el catálogo existente, por ejemplo Samanga o Santa Fe. El nuevo rol
**Técnico** tiene su grupo propio y participa también en **Mantenimiento (todos)**;
no participa automáticamente en los grupos exclusivos Mecánico o Eléctrico.
La planta asignada se consulta en **Mi perfil**. La API de asignación es
`PATCH /usuarios/{id}/planta` con `{"planta_id": 1}`, solo para administradores.
Enviar `null` quita la asignación.

Los avisos de solicitudes y sus contadores se restringen a la planta del personal
mecánico, eléctrico y técnico. Los preventivos por horas se filtran además por
especialidad. Una actividad general de varias plantas avisa en cada planta
incluida, mostrando en la alerta solo su cobertura local; sigue siendo una única
orden compartida. Los administradores reciben avisos de todas las plantas.
Sin planta asignada, el personal ve una indicación para solicitar su configuración
y no recibe avisos de actividades de plantas indeterminadas. El listado histórico
y los permisos para ejecutar trabajos conservan su funcionamiento: este filtro
organiza notificaciones, no establece aislamiento de datos entre plantas.

Las consultas de avisos usan la asignación actual del servidor. El perfil se
actualiza cada 30 segundos y al recuperar el foco, sin exigir cerrar sesión.
Verificaciones: `python -m unittest discover -p "test_*.py"`,
`node src/plantAlerts.test.js`, `node src/workAssignment.test.js` (desde la raíz)
y `python smoke_plant_alerts_ui.py` con Edge y datos simulados.

Ejemplo de `POST /auth/login`:

```json
{
  "nombre": "admin",
  "password": "tu-contrasena"
}
```
