# Informe de desarrollo y avances del sistema de mantenimiento AVIPAZ

**Fecha de elaboración:** 30 de septiembre de 2026.  
**Período del historial revisado:** 21 de agosto al 28 de septiembre de 2026.  
**Base del informe:** código fuente, documentación, migraciones e historial Git del proyecto local. Se identificaron 72 registros de cambios. El último corresponde al 28 de septiembre de 2026.

## 1. Objetivo del proyecto

Desarrollar una aplicación web que centralice la información de mantenimiento de AVIPAZ, permita gestionar los equipos y sus componentes, controle repuestos y compras, y facilite el seguimiento de las solicitudes desde su registro hasta la ejecución y conformidad del trabajo.

El sistema contempla la organización por plantas y torres, la participación del personal operativo y técnico, la priorización de actividades y la generación de documentos para apoyar la gestión del departamento.

## 2. Resumen de los trabajos realizados

Se implementaron módulos de activos, inventario, proveedores, solicitudes de mantenimiento, mejoras técnicas, priorización, programación, requisiciones de compra, usuarios y reportes. También se incorporaron fotografías, documentos adjuntos, alertas y registros de responsables y fechas.

Las mejoras más recientes se concentraron en el flujo del personal mecánico y eléctrico, la revisión administrativa de trabajos terminados, el cronograma semanal, las evidencias fotográficas y la presentación de formularios y selectores.

La existencia de estas funciones se comprobó en el proyecto local. Este informe no certifica que todas las migraciones o la última versión estén instaladas en el servidor, ni constituye una auditoría de los datos de producción.

## 3. Funcionalidades desarrolladas por módulo

### 3.1. Acceso, usuarios y responsabilidades

- Inicio de sesión y autenticación mediante tokens JWT; almacenamiento de contraseñas mediante hash bcrypt.
- Gestión de cuentas y asignación de roles: administrador, operador, mecánico, eléctrico y usuario.
- Registro y modificación de nombres y apellidos, conservando el identificador de acceso.
- Perfil personal y cambio de contraseña.
- Presentación del nombre completo de los participantes en los registros operativos.
- Restricción de acciones según el rol y la responsabilidad asignada.
- Eliminación administrativa de usuarios con protección de la cuenta propia y rechazo cuando existen relaciones que impiden borrar el historial asociado.

**Finalidad:** identificar a quienes solicitan, programan, ejecutan, revisan y reciben los trabajos.

### 3.2. Organización por plantas y torres

- Estructura de plantas, torres y máquinas.
- Configuración inicial documentada de Santa Fe —torres 1 y 2— y Samanga —torres 5, 6 y 7—.
- Creación y modificación de plantas y torres desde la aplicación.
- Asignación de máquinas a una torre y obtención de su planta correspondiente.
- Filtros por planta, torre y equipos sin asignación.
- Protección frente a la eliminación de plantas con torres o torres con máquinas.

**Finalidad:** ubicar los activos y organizar las actividades por instalación.

### 3.3. Máquinas, componentes y fichas técnicas

- Registro, consulta y actualización de máquinas y sus datos de identificación y ubicación.
- Fotografías de equipos y elementos.
- Registro de elementos asociados a cada máquina y clasificación por tipo.
- Fichas específicas para motores y reductores, incluida la imagen de placa de motor.
- Validación de compatibilidad entre el tipo de elemento y su ficha técnica.
- Acceso al historial de intervenciones y a los repuestos de cada máquina.
- Filtros de elementos por máquina y mejoras en la consulta de registros.

**Finalidad:** consolidar una base técnica para identificar equipos y preparar intervenciones.

### 3.4. Catálogo e inventario de repuestos

- Registro de código, descripción, categoría, marca, modelo, número de parte y unidad de medida.
- Registro de ubicación de almacenamiento, costo de referencia, mínimos, máximos, notas y fotografías.
- Administración de categorías y estado activo del repuesto.
- Duplicación de fichas sin copiar saldos ni movimientos históricos.
- Registro de saldos iniciales con fecha de corte.
- Consulta de existencias calculadas con saldo inicial, compras y consumos vigentes posteriores al corte; sin saldo inicial se consideran los movimientos disponibles.
- Alertas para repuestos con mínimo configurado y saldo igual o inferior a ese mínimo.
- Actualización periódica de alertas y existencias en las pantallas correspondientes.
- Validación de disponibilidad de repuestos al completar una solicitud.

**Precisión de alcance:** la documentación inicial decía que todavía no existía control de saldos; el código actual ya incorpora saldos y alertas. Esto no equivale a un kardex completo con devoluciones, transferencias y todos los tipos de ajuste.

### 3.5. Repuestos asociados a máquinas y elementos

- Asignación de repuestos generales a una máquina o específicos a uno de sus elementos.
- Registro de posición, cantidad requerida, criticidad y observaciones.
- Consulta de máquinas que utilizan un determinado repuesto.
- Edición y retiro de asignaciones según permisos.
- Consultas e impresión con filtros por máquina, elemento, repuesto y criticidad.

**Finalidad:** conocer las aplicaciones técnicas de cada repuesto. La cantidad requerida por un equipo no representa su existencia en bodega; asignar un repuesto no genera consumo.

### 3.6. Proveedores, contactos empresariales y contratistas

- Administración de proveedores y asociación con repuestos.
- Registro de contactos empresariales con nombre, correo y celular opcional.
- Selección de contactos, proveedores y usuarios como destinatarios de correos de requisiciones.
- Registro de contratistas, especialidad mecánica, eléctrica u otra, y datos de contacto.
- Disponibilidad de contratistas para la asignación de actividades de mantenimiento.

**Finalidad:** centralizar los datos necesarios para compras y coordinación de trabajos internos o externos.

### 3.7. Intervenciones, compras y consumos

- Registro de intervenciones realizadas, con máquina cuando corresponde, fecha, tipo y descripción.
- Historial de compras por repuesto, proveedor, documento, cantidad, costo unitario y moneda.
- Registro de consumos asociados a intervenciones.
- Filtros por fechas, repuesto y máquina según la consulta.
- Anulación de compras y consumos con motivo, conservando el registro histórico.
- Consulta de última compra y cantidades consumidas.
- Captura opcional de lecturas de horómetro para determinadas mediciones de duración de repuestos.

**Finalidad:** relacionar el trabajo ejecutado con los materiales utilizados y las compras efectuadas. Las mediciones de duración de repuestos no deben presentarse como un indicador MTBF ya implementado.

### 3.8. Solicitudes de mantenimiento

- Generación de solicitudes correctivas y preventivas.
- Registro de equipo, ubicación, descripción, fechas operativas, datos de falla y parada cuando corresponden.
- Incorporación de fotografías y selección de repuestos previstos con cantidades.
- Listado general, detalle, filtros y seguimiento de estados.
- Registro de inicio y finalización, causas, trabajo realizado, recomendaciones y materiales utilizados.
- Evidencia fotográfica del trabajo terminado.
- Creación de la intervención y sus consumos en una transacción al completar el trabajo.
- Validaciones de stock, coherencia de fechas y transiciones para evitar entregas repetidas.
- Registro de conformidad y cierre.
- Impresión del formato de solicitud MT/02-05.

**Flujo vigente:** registro → evaluación y programación → inicio por el responsable → ejecución y entrega → revisión administrativa → conformidad del solicitante → cierre.

Los estados principales almacenados son PENDIENTE, EN_PROCESO, POR_RECIBIR y CERRADA. Dentro de POR_RECIBIR se distingue si falta revisión administrativa o conformidad. El flujo nuevo exige revisión previa y recepción por quien generó la solicitud; el código conserva compatibilidad con reglas anteriores para registros históricos.

### 3.9. Mejoras técnicas

- Solicitudes de mejora mediante el formato MT/02-08.
- Registro de situación actual, área, propuesta y beneficio esperado.
- Posibilidad de asociar una máquina o registrar una mejora de área sin máquina.
- Verificación técnica y evaluación de viabilidad por Mantenimiento.
- Integración con la priorización, programación, ejecución, materiales y recepción.
- Registro del resultado de la mejora y fotografías.
- Edición de mejoras pendientes según permisos.
- Impresión del formato y consulta de la información registrada.

La documentación indica que se incorporaron 29 solicitudes HACCP de Santa Fe con sus fotografías y que se retiró la función de importación de la aplicación para impedir repetir la carga. La cantidad y conservación de los registros en la base real deben comprobarse allí; no se consultó esa base para este informe.

### 3.10. Priorización de actividades

- Preevaluación N-I-C opcional al registrar la solicitud y evaluación oficial por Mantenimiento.
- Cálculo de PR = N × I × C, con factores entre 1 y 4.
- Clasificación en prioridad baja, media, alta y crítica.
- Regla que establece nivel mínimo alto cuando C = 4.
- Ordenamiento por nivel final, factores C, I y N, y antigüedad.
- Conservación de preevaluación, validaciones, justificaciones y reevaluaciones.
- Listado común de mantenimiento y mejoras con filtros por ubicación y tipo.
- Identificación de actividades sin validación oficial.
- Reportes de actividades priorizadas con fotografías.

**Finalidad:** respaldar la selección de trabajos con criterios comunes. Los recursos o permisos pendientes no disminuyen automáticamente la prioridad.

### 3.11. Programación y cronograma

- Asignación de actividades a personal interno o contratistas.
- Registro de responsable, recursos, permisos, condiciones de espera, fechas y duración estimada.
- Requisito de programación lista para ejecutar antes de iniciar el trabajo.
- Cronograma visual semanal de lunes a viernes, de 07:30 a 18:00, con intervalos de selección de 30 minutos.
- Navegación entre semanas y selección de fecha y hora desde la cuadrícula.
- Visualización de actividades de la planta y advertencia de cruces para un mismo responsable en esa consulta.
- Colores por responsable, personalizables y guardados en el navegador.
- Reporte semanal imprimible por planta y rango de fechas.

**Límite:** la advertencia de cruces observada corresponde a las actividades de la planta consultada; no se certifica un bloqueo global de disponibilidad entre todas las plantas.

### 3.12. Requisiciones de compra

- Formulario CO/01-01 con departamento, proveedor opcional, fechas, solicitante, máquinas y observaciones.
- Hasta 11 ítems con descripción, cantidad, unidad y especificaciones; selección opcional desde inventario.
- Guardado de requisiciones e historial de consulta.
- Generación y nueva descarga del archivo Excel basado en la plantilla empresarial.
- Alertas administrativas de requisiciones pendientes de llegada.
- Confirmación de recepción con proveedor, documento, fecha, cantidades reales, moneda y precios.
- Registro de compras y cierre de la requisición en una transacción, con protección ante recepciones duplicadas.
- Factura opcional en PDF o imagen y descarga posterior desde el detalle.

**Límite:** la recepción es única; no están contempladas entregas parciales sucesivas. Guardar o enviar la requisición no aumenta las existencias; estas se actualizan con las compras registradas al recibir.

### 3.13. Envío de requisiciones por correo

- Preparación y revisión de destinatarios, copias, asunto y descripción.
- Envío del Excel de requisición y firma.
- Selección de contactos registrados o ingreso manual de direcciones.
- Incorporación de archivos y fotografías adicionales con límites de tamaño y cantidad.
- Configuración SMTP del lado del servidor.
- Manejo de errores y respuesta de aceptación del servicio de correo.

**Límite de verificación:** se identificó la implementación y documentación de pruebas simuladas. No se realizó un envío real ni se verificó la configuración del servidor en esta revisión. Los adjuntos adicionales de correo no se conservan en el historial de requisiciones según la documentación.

### 3.14. Documentos, fotografías y reportes

- Solicitud de mantenimiento MT/02-05 y mejora técnica MT/02-08.
- Excel de requisición CO/01-01.
- Resumen de actividades priorizadas y cronograma semanal.
- Consultas de repuestos y registros históricos con opciones de impresión.
- Fotografías de activos, componentes, placas, repuestos, solicitudes y trabajos ejecutados.
- Almacenamiento centralizado de nuevas imágenes y compatibilidad con rutas anteriores.

La opción de PDF utiliza el diálogo de impresión del navegador. Los espacios de firma de los documentos no constituyen un sistema de firma electrónica certificada.

### 3.15. Fechas históricas y datos para indicadores

- Registro de actividades anteriores con fechas de solicitud, inicio, finalización y recepción.
- Validaciones de secuencia temporal y manejo de hora local de Ecuador continental.
- Corrección administrativa de fechas del flujo.
- Cálculo de duraciones a partir de los registros de ejecución.
- Registro de períodos de operación de máquinas con horas programadas y realmente operadas.
- Validación de períodos sin solapamientos por máquina.
- Datos de base para analizar disponibilidad, MTBF, MTTR, cumplimiento y paradas.

**Estado:** existe captura de datos y cálculo de tiempos en solicitudes; no se identificó un tablero integral que calcule y presente todos esos indicadores.

## 4. Trabajos técnicos y preparación de datos

- Interfaz desarrollada con React y Vite.
- Backend con FastAPI y conexión a SQL Server mediante pyodbc.
- Catorce scripts numerados de migración para ampliar la estructura de datos.
- Transacciones y controles de concurrencia en operaciones sensibles de solicitudes y recepciones.
- Pruebas automatizadas para inventario, solicitudes, prioridad, compras, contactos, imágenes y otros módulos.
- Pruebas de ordenamiento y filtrado de prioridad en JavaScript.
- Historial de ajustes de conexión, acceso por DNS y puesta en marcha en servidor durante septiembre.
- Preparación de importación de fichas de Samanga/Torre 7: 69 hojas revisadas, 65 máquinas y 66 elementos motor preparados según su documentación. Cuatro fichas se omitieron por códigos repetidos.
- Archivos adicionales de preparación de carga para Repicky 5 y solicitudes HACCP.

Los archivos preparados para importar no acreditan por sí solos que su contenido se haya cargado en producción. La documentación de Torre 7 indica expresamente que la preparación no ejecutó la carga contra SQL Server.

## 5. Cronología resumida

| Período | Trabajo registrado en el historial |
| --- | --- |
| 21 de agosto | Registro inicial del proyecto. |
| 4–7 de septiembre | Ajustes de conexión y acceso; categorías, proveedores y datos de elementos. |
| 9–11 de septiembre | Intervenciones, consultas, saldos iniciales, solicitudes, requisiciones, correo y facturas. |
| 16–18 de septiembre | Ajustes para servidor, mejoras técnicas, priorización, formatos, filtros, nombres, contactos y fotografías. |
| 22–23 de septiembre | Fechas históricas, adjuntos de correo, selección de repuestos, roles técnicos, contratistas y cronograma. |
| 25 de septiembre | Formularios de mecánico y eléctrico, fotografía del trabajo, fechas y eliminación de usuarios. |
| 28 de septiembre | Ajustes de presentación de solicitudes y corrección de selectores de búsqueda. |

## 6. Estado de los trabajos recientes

Las últimas líneas de trabajo registradas se centran en consolidar la operación diaria: facilitar los formularios del personal técnico, identificar responsables, programar actividades y documentar su entrega.

Al comenzar esta revisión no había cambios locales pendientes registrados por Git. Por tanto, no hay evidencia suficiente para afirmar que exista una funcionalidad concreta actualmente en desarrollo sin guardar. Los puntos siguientes son necesidades de verificación y ampliaciones identificadas, no compromisos aprobados ni trabajos que se puedan dar por iniciados.

## 7. Pendientes y aspectos por consolidar

| Aspecto | Estado o acción necesaria |
| --- | --- |
| Verificación en servidor | Confirmar versión publicada, migraciones aplicadas y funcionamiento con SQL Server real. |
| Pruebas operativas | Recorrer con usuarios reales la solicitud, programación, ejecución, revisión, conformidad y recepción de compras. |
| Documentación | Actualizar textos antiguos sobre permisos, inventario y flujo, que ya no describen completamente la versión actual. |
| Datos maestros | Comprobar integridad y actualización de equipos, torres, fichas, responsables, proveedores y saldos. |
| Importaciones | Confirmar cargas efectivas y resolver los códigos repetidos o datos técnicos pendientes de las fichas. |
| Correo | Verificar configuración SMTP y entrega real de mensajes y adjuntos. |
| Indicadores | Definir fórmulas, períodos y tratamiento de paradas; desarrollar el tablero si se incluye en la siguiente etapa. |
| Inventario ampliado | Evaluar devoluciones, ajustes y demás movimientos necesarios para un kardex completo. |
| Compras | Evaluar recepciones parciales si el proceso operativo las necesita. |
| Mantenimiento preventivo | La captura y programación de solicitudes no equivalen a un generador automático de planes recurrentes por tiempo u horómetro; evaluar esa ampliación. |
| Respaldo | Verificar respaldo de base de datos, facturas y carpetas de fotografías. |

## 8. Aporte esperado a la gestión

La aplicación reúne información técnica y operativa que permite consultar el historial de los equipos, organizar actividades por prioridad, relacionar trabajos con materiales y dar seguimiento a compras y conformidades. Los reportes y fotografías proporcionan soporte documental para la coordinación del mantenimiento.

La reducción de tiempos, costos o fallas debe medirse con datos de operación antes de expresarse como un resultado cuantificado. No se dispone en esta revisión de mediciones que permitan atribuir porcentajes de ahorro o mejora.

## 9. Alcance y fuentes de la revisión

Se revisaron componentes de `src`, módulos del backend en `COM MANTENIMIENTO`, sus documentos funcionales, scripts de migración, archivos de importación e historial Git. Se contrastaron especialmente `Dashboard.jsx`, `MaintenanceRequests.jsx`, `PlanningSchedule.jsx`, `MaintenanceScheduleReport.jsx`, `StockAlerts.jsx`, `main.py` y `maintenance_requests.py`.

Para elaborar este informe no se modificó el código funcional, no se consultó la base de producción y no se ejecutaron pruebas automatizadas ni una nueva compilación. La presencia de pruebas se informa como trabajo existente en el repositorio, sin afirmar que hayan pasado en esta revisión.
