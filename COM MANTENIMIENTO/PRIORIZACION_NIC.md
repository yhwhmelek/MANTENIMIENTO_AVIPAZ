# Priorización común de mantenimiento y mejoras

Implementación basada en los tres documentos proporcionados el 16/09/2026:
`Procedimiento_Priorizacion_Mantenimiento_y_Mejoras.docx`,
`Formatos_Solicitud_Mantenimiento_y_Mejora_Actualizados.xlsx` y
`Matriz_Priorizacion_Mantenimiento_y_Mejoras.xlsx`.

## Flujo

1. ADMIN u OPERADOR registra la solicitud y su preevaluación N-I-C opcional (completa, parcial o sin valorar),
   según efectos observables. La mejora requiere área, propuesta y beneficio
   esperado. No se pide evaluación técnica al solicitante.
2. ADMIN, como responsable de Mantenimiento, confirma o modifica N-I-C y registra
   observación técnica/justificación. Para mejoras completa cinco verificaciones
   (sí/no/no aplica y observaciones) y viabilidad técnica. Se conserva la
   preevaluación original, el evaluador, la fecha y todas las reevaluaciones.
3. La lista común muestra la prioridad oficial de mayor a menor, filtra por planta,
   torre, nivel y tipo, y permite imprimir o guardar como PDF un resumen de las
   actividades filtradas con las fotos adjuntas a cada solicitud.
4. Mantenimiento programa responsable/técnico, recursos y personal, permisos,
   ventana y fechas. Puede registrar condiciones de espera sin alterar prioridad.
   Para iniciar, la programación debe estar «Lista para ejecutar» y tener fechas.
5. Iniciar trabajo mantiene la transición PENDIENTE → EN_PROCESO y registra al
   administrador que inicia y su fecha. La mejora necesita viabilidad «Procede»
   o «Procede con modificaciones». «No procede» y «Análisis adicional» permanecen
   pendientes hasta reevaluación; no cierran ni generan consumos automáticamente.
6. La entrega conserva las validaciones de tiempos, stock, materiales e
   intervención en una transacción; cambia EN_PROCESO → POR_RECIBIR.
7. Solo la confirmación del solicitante o de un administrador cambia POR_RECIBIR
   → CERRADA, registrando quién acepta, cuándo y su conformidad. Se conserva el
   comportamiento previo de aceptación administrativa. Las actividades entregadas
   y cerradas ya no permiten modificar evaluación o programación.

## Reglas

- PR = N × I × C (factores enteros de 1 a 4).
- 48–64 CRÍTICO; 24–47 ALTO; 12–23 MEDIO; 1–11 BAJO.
- C=4 exige como mínimo ALTO. Se conserva tanto el nivel base como el final.
- Orden: nivel final, mayor C, mayor I, mayor N, solicitud más antigua;
  el identificador resuelve empates exactos. No se ordena por producto dentro
  de un mismo nivel.
- Recursos, repuestos, permisos y ventanas no reducen la prioridad.
- El listado incluye pendientes, en proceso y por recibir. Las cerradas están
  en «Todas las solicitudes / cerradas». Los registros sin validación aparecen
  separados por su etiqueta «Sin validar», al final y sin nivel oficial.
- El aviso de control inmediato ante peligro inminente/exigencia legal se muestra
  en la lista conforme al procedimiento; no sustituye los protocolos de seguridad.
- N=4 no implica equipo parado. El estado real de parada se registra aparte.

## Persistencia y compatibilidad

No requiere migración SQL adicional: preevaluación, validación, programación,
revisiones e historiales se guardan en `MaintenanceRequests.RequestData`.
Las actualizaciones usan bloqueo de fila y revisión optimista para evitar
sobrescrituras entre administradores. La prioridad se calcula en el servidor.

Las solicitudes antiguas conservan sus datos. Urgencia/impacto/riesgo anteriores
no se convierten automáticamente en NIC y no constituyen prioridad oficial.
Las antiguas pendientes o en proceso necesitan validación y programación antes
de iniciar/entregar. Las ya entregadas pueden aceptarse normalmente.

La impresión MT/02-05 (versión 05 - PROPUESTA) y MT/02-08 (versión 00 - PROPUESTA)
incluye las dos evaluaciones, verificación técnica, programación, ejecución,
materiales, entrega y aceptación. Conserva la etiqueta de versión de los archivos
recibidos; el HTML adapta la paginación al contenido.

Actualizar juntos backend y frontend, reiniciar API y Vite o publicar `dist`.
La migración 010 anterior sigue siendo necesaria para mejoras sin máquina.

## Verificación

`python -m unittest discover` desde el backend.
`node src/priorityOrder.test.js` y `npm run build` desde el frontend.
Las 64 combinaciones se contrastan con `priority_matrix_reference.json`, extraído
directamente de los cuatro mapas de la hoja Matriz NIC del Excel proporcionado.

## Repuestos previstos

La solicitud admite hasta 30 repuestos previstos, con cantidad por fila y sin duplicados.
Se conserva el saldo consultado como referencia; solicitar no reserva ni consume stock.
Al entregar, se cargan todos los previstos para ajustar lo realmente usado.
Los registros anteriores con un solo repuesto siguen siendo compatibles.
La evaluacion oficial de Mantenimiento continua exigiendo los tres factores NIC.
