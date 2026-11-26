# Módulo de calibración — borrador

Basado en el procedimiento **MT/03 Procedimiento de calibración, versión 06** (11/06/2026).

## Instalación

1. Ejecutar en la base de mantenimiento (SSMS), en orden: `migrations/024_calibration_module.sql` y `migrations/025_calibration_activities_orders.sql`. Ambas son repetibles y no modifican datos existentes. La 025 requiere `dbo.Contractors` (migración 014).
2. Reiniciar la API (`main.py` registra el módulo con `register_calibration`).
3. Compilar el frontend con `npm run build` y publicar `dist`.

Sin las migraciones, la pestaña **Calibración** muestra un aviso y el resto de la aplicación funciona igual.

## Estructura

| Elemento del procedimiento | En la aplicación |
|---|---|
| Actividades de calibración | Calibración → Actividades y frecuencias (procedimiento, método, frecuencia, responsable, duración) |
| MT 03/Anexo 1 · Inventario de instrumentos | Calibración → Instrumentos y planes |
| MT 03/Anexo 2 · Matriz AMEM | Plan por instrumento: actividad, frecuencia, responsable, hora y primera fecha |
| Programación / órdenes | Calibración → Programación (preparar, publicar, reprogramar, reasignar, cancelar) |
| MT 03/Anexo 3 · Inventario de pesas patrón | Calibración → Patrones |
| MT/03-03 a MT/03-07 · Verificaciones | Calibración → Registros (formato asignado según el tipo de instrumento) |
| MT/03-02 · Calibración externa | Registros con método «Calibración externa» y número de certificado |

## Flujo (similar a preventivos)

1. **Actividad** (administrador): nombre, método, tipo de instrumento, procedimiento (se puede cargar con los pasos del MT/03), frecuencia, responsable sugerido, hora, duración y personas.
2. **Plan** (administrador): en *Instrumentos y planes → Asignar actividad* se elige la actividad, la frecuencia, la primera fecha, la hora y **quién la realiza**: un grupo (Mecánico, Eléctrico, Técnico o Mantenimiento), una persona específica o un contratista. Sus ciclos aparecen en el calendario como **Calibración planificada**.
3. **Publicación** (administrador): en *Programación → Preparar / publicar* se revisan los ciclos del mes y se publican. Cada ciclo genera una **orden** asignada al responsable y aparece como **Calibración publicada**. Igual que en preventivos: publicar avanza el plan, los ciclos atrasados nunca publicados se agrupan en una orden para hoy y un plan con órdenes abiertas no genera ciclos nuevos.
4. **Ejecución**: el responsable ve sus órdenes en *Programación* (filtro «Solo mis asignaciones») o en el calendario, y registra la verificación desde la orden, con el procedimiento a la vista. Solo pueden registrarla el administrador, la persona asignada o un miembro del grupo asignado; el resultado de un contratista lo registra el administrador.
5. **Cierre**: conforme → orden realizada. No conforme → la orden sigue abierta para reverificar después del ajuste. Retiro o reemplazo → orden cerrada y equipo fuera de uso. Anular el registro reabre la orden.
6. **Revisión**: el administrador revisa y firma el registro (firma del jefe de mantenimiento).

El administrador puede reprogramar (con motivo) o reasignar una orden abierta, o cancelarla con motivo.

## Calendario estándar

El mismo calendario mensual (`src/ActivityCalendar.jsx`, lógica en `src/calendarEvents.js`) se usa en tres lugares:

- **Calendario** (menú principal): todas las fuentes.
- **Preventivos → Cronograma mensual**: preventivos publicados y planificados. Solicitudes y calibraciones están disponibles, pero desactivadas al inicio.
- **Calibración → Calendario general**: calibraciones y preventivos publicados.

| Fuente | Origen |
|---|---|
| Preventivo publicado | `GET /preventivos/semana` (órdenes ya generadas en MT/02-03) |
| Preventivo planificado | Proyección de `GET /preventivos/catalogo` desde `next_due` con la frecuencia del plan (misma regla de meses que el backend). Los planes por horas no se proyectan |
| Solicitud programada | Entradas no preventivas de `GET /preventivos/semana` |
| Calibración | `GET /calibracion/calendario` |

Estados comunes: vencida, pendiente, programada, en proceso, realizada, no conforme/no realizada y reprogramada. Filtros por fuente, grupo (mecánico, eléctrico, técnico, externo) y planta. No requiere cambios en la API para preventivos.

## Reglas

- Balanzas: 5 puntos de excentricidad según la figura del formato MT/03-04. Sistemas de pesaje: cero, carga baja con 3 repeticiones, media y alta (7.2.6).
- Un resultado conforme mueve la próxima fecha a «ejecución + frecuencia». Un resultado no conforme exige una acción y mantiene el vencimiento hasta repetir la verificación (6.1.2, paso 6).
- No se aceptan patrones inactivos o vencidos (política 5.3). Las verificaciones internas exigen al menos un patrón.
- La calibración externa exige el número de certificado (8.1.3). La báscula camionera usa el formato MT/03-02 (8.1.4).
- Retiro o reemplazo deja el instrumento «Fuera de uso». Los registros no se eliminan: se anulan (retención mínima de 1 año).
- La operación no tiene acceso al módulo.

## Pendiente para próximas versiones

- Avisos de calibración en el centro de alertas.
- Impresión/PDF con el diseño de los formatos MT/03-0x y carga del certificado externo (PDF).
- Evaluación de impacto sobre lotes cuando un equipo resulta no conforme (política 5.7).
- Carga inicial de los instrumentos Ext-Bal1 a Ext-Bal7 y del registro de agosto de 2026.

## Pruebas

`python -m unittest test_calibration` y `node src/calibrationSchedule.test.js` (desde la raíz).
