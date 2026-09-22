# Fechas historicas de mantenimiento

Las nuevas solicitudes y transiciones permiten cargar actividades antiguas en hora local de Ecuador (UTC-5).

- Al generar una solicitud, ingresar su fecha y hora y la fecha de deteccion. RequestedAt guarda requested_at; si un cliente anterior omite el campo, se utiliza detected_at.
- Al iniciar un trabajo, ingresar la fecha y hora real de inicio. AcceptedAt guarda started_at. Debe ser posterior o igual a RequestedAt.
- Al entregar el trabajo, CompletedAt guarda repair_finished_at. La intervencion y los consumos conservan la fecha de realizacion del mantenimiento. El inicio registrado se conserva para calcular la duracion.
- Al confirmar la recepcion, ReceivedAt guarda received_at. No puede ser anterior a CompletedAt.
- No se permiten fechas reales futuras ni valores con zona horaria explicita. Las fechas planificadas mantienen sus propias reglas.

La fecha de carga queda separada en RequestData.recorded_at, RequestData.start_recorded_at, ExecutionData.recorded_at y RequestData.receipt_recorded_at, segun la etapa. Las fechas tecnicas CreatedAt de las otras tablas mantienen su significado de auditoria.

No requiere migracion SQL. No modifica automaticamente fechas de registros existentes. Reiniciar la API y actualizar el frontend para habilitar los campos nuevos.
