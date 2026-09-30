# Módulo preventivo — primera versión

## Uso

1. En **Preventivos → Actividades y frecuencias**, el administrador crea el procedimiento (engrase, aceite, rodamientos, bobinado o general), su frecuencia por días/semanas/meses, grupo, duración, personas y factores NIC. Introducir intervalos adecuados al equipo; no hay actividades precargadas con frecuencias técnicas supuestas.
2. En **Activos → Elementos → Preventivos / engrase**, agregar un plan al elemento. También se permiten planes para una máquina completa. Seleccionar actividad, primera intervención, hora, ruta opcional y puntos/apoyos. El plan hereda la frecuencia; una frecuencia particular requiere motivo. El checkbox de inclusión activa el cronograma de engrase.
3. En **Calendario MT/02-03**, seleccionar la semana y **Preparar / publicar preventivos**. Revisar y seleccionar los planes que se publicarán. Las órdenes se generan una sola vez y aparecen en las alertas del grupo. Un plan con órdenes sin cerrar espera antes de generar nuevos ciclos.
4. Abrir el trabajo y **Aceptar e iniciar**. Guardar resultados por punto y participantes con minutos reales en el checklist. Entregar el trabajo en el formulario habitual, registrando sus consumos y evidencias. El administrador revisa y quien publicó confirma recepción, usando el flujo existente.
5. Usar **Reprogramar** desde el calendario para mover trabajos aún no iniciados, indicando motivo. El registro anterior queda R; no se crea otra solicitud ni se duplica la alerta. Si requiere parada, confirmar su ventana en la programación antes de iniciar.
6. Desde el domingo, el administrador puede **Cerrar semana**. Se conserva una copia histórica de pendientes, parciales, realizados y reprogramados. Excel exporta toda la semana y detalle de puntos; imprimir/PDF respeta los filtros de pantalla. Los indicadores corresponden a toda la semana.

## Reglas

- Lectura general: administradores, mecánicos y eléctricos. En los roles actuales los dos últimos son el personal técnico; no se introduce otro rol de autenticación.
- Las rutas se identifican por nombre y se filtran juntas en el calendario. Cada plan/elemento genera su propia orden y checklist, con trazabilidad a su máquina. Esta versión no genera una sola orden de cabecera para una ruta que cruza varias máquinas.
- Recurrencia fija por calendario, con ancla de día para meses cortos. Un vencimiento atrasado conserva la fecha original; los ciclos acumulados se señalan, no se presentan como ejecutados.
- Cambiar frecuencia conserva la próxima fecha por generar. Al generar se aplica el intervalo vigente al siguiente ciclo. Editar actividad/plan no cambia órdenes publicadas. Desactivar conserva historial. Cambiar activo, actividad o fecha base requiere crear otro plan.
- Se distinguen realización, ejecución parcial y validación. Los puntos no ejecutados exigen motivo y no cuentan como realizados.
- Horas hombre previstas = personas × duración. Horas hombre reales = suma de minutos registrados por participante.
- El porcentaje preventivo cuenta órdenes generadas únicas, ejecutadas y validadas dentro de la semana. Reprogramaciones dentro de la misma semana no duplican su denominador. Los trabajos emergentes/manuales se presentan aparte. Una edición después de un cierre no altera la copia cerrada.
- Las solicitudes generadas tienen referencias de base de datos que impiden borrarlas mientras sostienen el historial preventivo.

## Instalación y comprobaciones

Ejecutar `python migrate_preventive.py --apply` usando la conexión de `.env`. La migración 015 es repetible y agrega cinco tablas; requiere las migraciones existentes de activos y solicitudes. No incluye cambios de credenciales ni modificación de registros anteriores.

El backend debe ejecutar la versión actualizada de `main.py` (reiniciar el servicio si no usa recarga). Compilar frontend con `npm run build`.

- Pruebas: `python -m unittest discover -p "test_*.py"`.
- Integración SQL: `python smoke_preventive.py`. Utiliza administrador y máquina existentes, crea registros temporales y revierte la transacción completa, incluso si falla. Requiere una semana actual abierta. Puede dejar saltos normales en los identificadores IDENTITY, sin registros de prueba persistidos.

## Límites explícitos de esta versión

La publicación es manual desde la semana elegida; no hay tarea automática en segundo plano. Las frecuencias por horómetro, reabrir un cierre con nueva revisión, firma digital y consolidar toda una ruta en una sola orden quedan para una siguiente iteración. Los códigos de rodamientos/chumaceras de los puntos son referencias técnicas; los repuestos de almacén se seleccionan en los formularios de programación/entrega existentes.

La exportación mantiene el contenido del registro MT/02-03 y agrega domingo y detalle de puntos. No es una copia exacta del diseño gráfico ni de la versión documental 4 del Excel original; aparece como formato digital para su revisión interna.
