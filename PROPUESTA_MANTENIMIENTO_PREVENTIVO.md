# Propuesta de módulo de mantenimiento preventivo

Estado: propuesta de referencia. Se implementó una primera versión funcional; consultar `COM MANTENIMIENTO/PREVENTIVOS.md` para el alcance entregado, uso y límites. Las extensiones descritas aquí no se consideran todas implementadas.

## Ajuste al registro semanal MT/02-03 aportado por el usuario

Referencia revisada: `MT_02-03_REGISTRO DE MANTENIMIENTO ABRIL.xlsx`, código MT/02-03, versión 4. Se revisaron contenidos, fórmulas, celdas con formato de programación y estructura de hojas; no se modificó el original. Las indicaciones de la hoja «Instrucciones» describen el proceso documental existente y se toman como referencia, no como autorización para enviar, publicar o modificar documentos externos.

El resultado funcional esperado es una pantalla compartida «Programación y registro semanal de mantenimiento — MT/02-03». Antes de ejecutar muestra la programación; durante la semana muestra avance y al cierre conserva el resultado de esa misma programación. Exportación a Excel/PDF con código, versión del formato, semana, fechas, ejecutores y verificador. Diferenciar la versión del formato de la revisión del registro semanal.

El libro tiene cuatro hojas semanales, TOTAL, RESUMEN, Instrucciones y FUTURO. Las hojas semanales contienen origen, torre/área, máquina/equipo, actividad, tipo, prioridad, tamaño del grupo, horas reloj, horas hombre, grupo asignado, lunes a sábado, validación, estado y observaciones; separan trabajos previstos de emergentes/correctivos. RESUMEN es una referencia inicial para el catálogo de actividades y frecuencias, no una importación automática de reglas: contiene abreviaturas y actividades generales que necesitan vincularse a activos identificados.

### Flujo semanal propuesto

1. Preparar borrador con los vencimientos preventivos por máquina/elemento, rutas de lubricación y solicitudes que se incorporen al programa.
2. Supervisor revisa fechas, grupos, recursos y duración; publica la semana. Guardar una base de programación publicada, autor, fecha y revisiones.
3. Todo el personal autorizado de mantenimiento puede consultar la semana completa. Los filtros por especialidad, planta, torre y máquina facilitan la consulta sin restringir la visión general a las alertas personales.
4. Publicar genera o vincula las órdenes y sus alertas por grupo una sola vez. Las alertas son otra vista de la misma orden; no son tareas independientes del calendario.
5. La primera persona habilitada que acepta queda como responsable y comienza el trabajo; desaparece la oferta para los demás, pero la actividad permanece visible para todos en el calendario con su ejecutor y estado. Permitir registrar colaboradores: aceptar como responsable no significa que el trabajo sea de una sola persona.
6. Registrar por actividad/punto ejecución, fecha real, participantes, tiempos, resultados, materiales y motivo de lo no ejecutado. Al entregar, distinguir «realizado, pendiente de validación» de «validado».
7. Al cierre el supervisor revisa y guarda una versión del resultado semanal. El paso del tiempo no confirma que un trabajo fue ejecutado. Reabrir o corregir requiere autor, fecha y motivo; no sobrescribir silenciosamente el cierre.

### Presentación y estados

Conservar una tabla equivalente al formato, con actividad en filas y días en columnas. Mostrar programación y resultado como datos diferentes: bloque planificado y marca de ejecución, con detalle al abrir. Mantener ✓ ejecutado, P pendiente y R reprogramado, y distinguir visualmente trabajo en curso, ejecución parcial y ejecución pendiente de revisión. Una celda sin registro no cuenta como ejecutada.

La semana muestra todas las actividades previstas y las añadidas después de publicarse, identificando las adiciones. Los emergentes se registran aparte, como en el Excel. No limitar el mes a cuatro semanas: generar fechas reales y permitir semanas que cruzan meses.

El formato semanal actual presenta lunes a sábado, mientras RESUMEN contiene una actividad de domingo. La aplicación debe almacenar los siete días y admitir domingo en pantalla/exportación cuando haya actividades, con adaptación explícita del formato. No omitir el domingo ni moverlo automáticamente al sábado.

### Rutas de lubricación

Una fila general, por ejemplo «Ruta de lubricación — Torre 7», permite abrir el detalle de máquinas, elementos y puntos de engrase. Mostrar avance explícito, por ejemplo 18 de 20 puntos. No dar por realizada toda la ruta por haber realizado uno de sus puntos.

Conservar la cabecera de ruta y sus órdenes por máquina si se reutiliza el flujo actual. En el reporte contar la fila de ruta como actividad general y medir puntos ejecutados en un indicador separado: no sumar simultáneamente cabecera e hijos como actividades distintas para el mismo indicador.

### Cierre, reprogramaciones y métricas

Guardar en el cierre lo que estaba previsto, lo realizado al corte, lo no realizado, el motivo, los pendientes de validación, las reprogramaciones y sus nuevas fechas. Una actividad trasladada a otra semana permanece como R en la semana original, vinculada a su siguiente programación. Completarla después no convierte retrospectivamente el cierre original en cumplimiento oportuno.

Mostrar por separado cumplimiento del programa preventivo, emergentes resueltos y avance de puntos de lubricación. El denominador del cumplimiento planificado se basa en la programación publicada, preservando las reprogramaciones no cumplidas; registrar cancelaciones y su tratamiento explícitamente. Diferenciar terminación dentro de la semana y cumplimiento de la fecha prevista cuando se necesiten ambos indicadores.

El Excel calcula horas hombre como tamaño del grupo × horas reloj. Conservar ese cálculo para previsión; en ejecución registrar horas reales por participante y sumarlas, porque los participantes pueden trabajar tiempos diferentes.

Hallazgos del archivo que no deben trasladarse sin revisión:

- Las instrucciones indican que Estado se calcula según las marcas diarias, pero las fórmulas revisadas de BJ dependen de Validación (BI). Propuesta: estado de ejecución derivado de registros reales y validación administrativa en un campo separado.
- El cumplimiento total semanal promedia los porcentajes de preventivos y emergentes, aunque tengan cantidades distintas. En Semana 1, los datos guardados son 9/12 y 2/7: el promedio mostrado es 51,79 %, mientras la proporción total por cantidad de actividades es 11/19 = 57,89 %. Son métricas distintas. Mantener indicadores separados y usar la segunda solo si se presenta como cumplimiento total por cantidad de actividades.
- La hoja TOTAL contiene un error #REF!. Los totales futuros deben calcularse desde los registros, no copiar esa fórmula.
- El área de impresión semanal llega hasta BK; los indicadores están en BM/BN. La exportación debe incluir explícitamente el resumen si se quiere que forme parte del documento final.

### Extensiones necesarias al diseño

Añadir programación semanal y versiones de cierre, líneas de programación vinculadas a órdenes/rutas, historial de reprogramaciones y participantes con tiempos reales. Guardar instantáneas de nombres, grupos, puntos y fechas relevantes al cierre para que editar un elemento o plan no cambie documentos históricos.

Pruebas adicionales: visibilidad general frente a alertas por grupo; aceptación sin borrar la fila del calendario; colaboración de varias personas; reprogramación entre semanas sin duplicar órdenes; rutas parcialmente ejecutadas; domingo y quinta/sexta semana del mes; cumplimiento sin doble conteo; cierre histórico estable después de una ejecución tardía; exportación con indicadores y todas las filas, sin límites fijos de 12 o 13 actividades.

## Base existente revisada

- `src/MachineElements.jsx`: elementos por máquina, tipo, posición y elemento padre.
- `src/MachineSpareParts.jsx`: repuestos asociados a máquina y opcionalmente a elemento.
- `COM MANTENIMIENTO/main.py`: fichas de motor con rodamientos DE/NDE y lubricante; fichas de reductor con aceite, viscosidad y cantidad. Los perfiles actuales son NONE, MOTOR y REDUCTOR.
- `COM MANTENIMIENTO/maintenance_requests.py`: solicitudes PREVENTIVO, ejecución, entrega, consumos, revisión y aceptación. Hay registros de horómetro y períodos de operación, pero no un programador recurrente por elemento.
- `src/PriorityWorkflow.jsx` y `src/workAssignment.js`: programación y aceptación por grupo. Reutilizar este flujo para ejecutar los preventivos.

## Estructura funcional

Separar cuatro conceptos: ficha del elemento, actividad estándar, plan aplicado a un elemento y ejecución concreta. Un elemento puede tener varios planes con distintas frecuencias.

La actividad define qué hacer, su procedimiento, datos a registrar, especialidad y frecuencia predeterminada. El plan define dónde se aplica, desde cuándo, próxima intervención, frecuencia heredada o particular y excepciones. La orden registra una ejecución, sus resultados y su responsable real.

## Ficha de cada elemento

Añadir una acción «Preventivos» y un perfil de datos EJE. Mantener los tipos de elementos configurables; el perfil determina los campos disponibles.

Ejes: lista de apoyos o posiciones, referencia de rodamiento, referencia de chumacera/conjunto, cantidad, identificación del punto de engrase, lubricante y dosis por punto. Usar vínculos al catálogo de repuestos cuando existan; distinguir código interno y referencia comercial. Permitir registrar una referencia técnica aún no incorporada al almacén. Evitar contabilizar como repuestos independientes un conjunto completo y sus componentes sin identificar cómo se suministran.

El checkbox «Incluir en ruta de engrase» crea o activa la vinculación al plan correspondiente; no es un dato aislado. Mostrar frecuencia heredada, última ejecución y próximo vencimiento. No incluir automáticamente componentes que no admiten reengrase. Un eje con apoyos distintos necesita varios puntos, no un solo par de campos para todos.

Reductores: reutilizar aceite, viscosidad y litros existentes. Asociar planes distintos para inspección de fugas/nivel y cambio de aceite, con frecuencia particular si corresponde. Conservar el cambio inicial de rodaje como actividad única cuando lo prescriba el fabricante.

Motores: reutilizar referencias DE/NDE. Separar inspección de rodamientos, lubricación cuando aplique, sustitución programada cuando esté justificada, y limpieza/inspección eléctrica del bobinado. Registrar mediciones y unidades definidas por procedimiento. El rebobinado no se genera como reemplazo periódico predeterminado: se origina por diagnóstico.

Si varios motores o reductores necesitan historiales independientes, representarlos como elementos identificables separados, aunque la ficha actual permita cantidad mayor que uno.

## Pantalla «Mantenimiento preventivo»

1. Actividades estándar: nombre, procedimiento, frecuencia predeterminada, unidad, grupo responsable, duración prevista, materiales, requisitos de parada y documento de referencia.
2. Planes por elemento: planta, torre, máquina, elemento/punto, actividad, estado, frecuencia efectiva, origen de esa frecuencia, fecha base, última ejecución y próxima fecha.
3. Rutas de engrase: agrupar elementos compatibles por ubicación y frecuencia; ordenar su recorrido.
4. Calendario y vencimientos: próximos, vencidos, generados, en ejecución y pendientes de revisión.
5. Historial: cumplimiento por punto, ejecutor, fecha, materiales, mediciones y hallazgos.

La frecuencia común de «Engrase general de chumaceras» se configura una vez y la heredan sus planes. Permitir excepciones justificadas, visibles y auditables. Tener chumacera no implica que el mismo intervalo sea técnicamente adecuado para todos los equipos.

## Recurrencia

- Admitir días, semanas y meses como unidades distintas; un mes no equivale siempre a 30 días.
- Preparar el modelo para horas de operación y combinación calendario/horas, lo que ocurra primero.
- Activar planes por horas solo con una fuente confiable de lecturas acumuladas; una lectura aislada en una solicitud no basta. Registrar cambios o reinicios del contador. Una estimación por turnos debe identificarse como tal.
- Exigir fecha base o primera intervención al activar un plan. Si no se conoce el último servicio, marcarlo como desconocido, sin inventar una ejecución.
- Ofrecer calendario fijo, útil para rutas, o intervalo desde la ejecución real, útil para determinadas sustituciones. El retraso de una ruta fija no debe desplazar silenciosamente todos los vencimientos.
- Calcular desde la fecha real del trabajo validado, no desde la fecha de aprobación administrativa. Mientras esté pendiente de revisión, mostrar esa condición y evitar duplicados.
- Al cambiar una frecuencia, mostrar el efecto sobre próximas fechas. No modificar órdenes ya generadas ni el historial; guardar la revisión del plan.
- Un vencimiento incumplido permanece visible. No cerrar automáticamente ciclos atrasados como si se hubieran realizado.

## Generación y ejecución

Un proceso del servidor, independiente de que haya navegadores abiertos, comprueba los planes activos y genera trabajo con la anticipación configurada. Comienza en modo manual «Generar próximos» durante la validación inicial y habilita posteriormente una tarea programada.

La generación debe ser idempotente: el mismo plan y vencimiento no pueden producir dos trabajos, aunque se ejecute dos veces o en paralelo. Usar restricción única y transacciones. Definir una política de acumulación: por defecto, conservar el trabajo abierto vencido y mostrar los ciclos atrasados sin crear alertas idénticas indefinidamente.

Una ruta tiene una cabecera y una lista de puntos con estado individual: pendiente, realizado, no realizado o no aplica, con motivo para los dos últimos. No marcar todos los puntos realizados por cerrar la cabecera. Solo actualizar el último servicio de los puntos realmente ejecutados y validados. Guardar una instantánea de los puntos incluidos para que un cambio posterior en la ruta no altere su historial.

En una primera versión, agrupar recorridos por máquina para reutilizar las solicitudes existentes, que requieren una máquina para PREVENTIVO. Para una ruta transversal a varias máquinas, añadir una cabecera de ruta con solicitudes hijas por máquina y detalle por elemento. No asignar una ruta de varias máquinas a una sola máquina ficticia.

Las órdenes llegan al grupo configurado. Quien acepta queda como ejecutor mediante el bloqueo transaccional existente. Los consumos reales reutilizan el registro de inventario; no descontar materiales por el solo hecho de programar.

La aprobación inicial del plan debe definir los requisitos que necesitan las órdenes para ejecutarse, incluyendo prioridad y programación. No crear órdenes bloqueadas indefinidamente por faltar la validación NIC del flujo actual, ni inventar factores para evitarlas: resolver la herencia explícita de una plantilla aprobada y su trazabilidad.

Un hallazgo de una inspección permite crear una solicitud correctiva vinculada. No confundir «se realizó la inspección» con «se reparó la anomalía».

## Modelo de datos propuesto

| Entidad | Responsabilidad |
|---|---|
| ShaftSpecifications / LubricationPoints | Datos de eje y posiciones lubricables; vínculo a elemento y repuestos |
| PreventiveActivities | Catálogo y procedimiento versionado, frecuencia predeterminada |
| ElementPreventivePlans | Elemento/punto, actividad, recurrencia, excepciones, fechas, grupo y estado |
| PreventiveRoutes / PreventiveRouteItems | Agrupación y orden del recorrido |
| PreventiveOccurrences | Vencimiento e instantánea del plan, estado y vínculo a solicitud existente |
| PreventiveExecutionItems | Resultado individual, ejecutor, fechas, lecturas y consumos relacionados |

Agregar lecturas acumuladas de contador cuando se implementen frecuencias por horas. Mantener claves foráneas e índices de vencimiento; desactivar planes con historial en vez de eliminarlos. Evitar duplicar las tablas existentes de repuestos, consumos y solicitudes. Unicidad de ocurrencia por plan y ciclo; revisiones y cambios registrados con autor y fecha.

## Implementación gradual y aceptación

Primero: ficha de eje/puntos, actividades, vinculación desde elementos, frecuencia por calendario, excepciones y vista de vencimientos. Segundo: generación y rutas por máquina, alertas por grupo, ejecución detallada, revisión y consumos. Tercero: horas de operación, rutas entre máquinas y mediciones por condición.

Verificar herencia y excepción de frecuencias; activación sin duplicados; ejecución parcial; fechas de fin de mes; generación concurrente; aceptación por una sola persona; retiro de alertas; preservación de historial al editar planes; desactivación de elementos; consumos sin duplicación; independencia entre ejecución y revisión administrativa.

## Referencias técnicas

Estas fuentes orientan el diseño; no establecen un intervalo universal para los equipos de esta planta. Los valores concretos deben proceder del manual del modelo instalado y de sus condiciones de servicio.

- SKF, lubricación y efecto de las condiciones sobre frecuencia y cantidad: https://evolution.skf.com/en/skf-grease-knowledge-sustainability-2/
- SEW-EURODRIVE, intervalos de cambio según lubricante, temperatura y condiciones, y análisis de aceite: https://download.sew-eurodrive.com/download/html/31981496/en-EN/743421451.html
- WEG, manual de motores de inducción T, inspección y mantenimiento de bobinados y rodamientos: https://static.weg.net/medias/downloadcenter/hf2/h8f/WEG-three-phase-induction-motors-t-line-squirrel-cage-rotor-12364818-manual-english-dc.pdf
