# Solicitudes de mantenimiento

## Activación

1. Ejecutar `migrations/005_maintenance_requests.sql` después de 001–004. Es transaccional y se puede volver a ejecutar. No crea datos de ejemplo.
2. Reiniciar la API y publicar la compilación actual del frontend.
3. En Usuarios, el administrador asigna el rol `OPERADOR` a las cuentas que generan solicitudes.

## Ejercicio: cambio de malla del molino

1. El administrador registra la malla en Inventario y su saldo inicial, con corte anterior al día del consumo, o registra la compra correspondiente.
2. El operador entra a **Solicitudes → Generar solicitud**. Selecciona el molino, describe el cambio de malla, indica tipo, detección del daño, criticidad y si se trata de una falla. Registra la parada y el horómetro cuando correspondan. Puede señalar la malla y la cantidad prevista.
3. Las demás cuentas activas ven una alerta de solicitud por atender. Otra persona pulsa **Atender solicitud**; queda identificada como responsable.
4. El responsable registra horas reales, causas, trabajo, recomendaciones, condiciones de entrega y la malla realmente usada. Al entregar se crea una intervención y su consumo en una sola transacción. Se valida saldo suficiente y fecha posterior al corte inicial. Sin piezas utilizadas, la lista queda vacía.
5. El solicitante ve la alerta **Por recibir**, revisa el trabajo y confirma su recepción con observaciones. Solo él puede cerrar la solicitud. La recepción no genera un segundo consumo.
6. **Imprimir / guardar PDF MT/02-05** abre la impresión del navegador. Elegir Guardar como PDF, A4 vertical, escala 100 % y desactivar encabezados/pies del navegador.

Los avisos se actualizan cada 30 segundos, al volver a la ventana y después de una acción propia. Una falla de conexión se muestra explícitamente. La alerta cuenta tareas pendientes de la cuenta actual, y el listado muestra todas las solicitudes.

## Formato impreso

Se tomó la hoja **VERSION 3** del archivo `MT 02-05 SOLICITUD DE MANTENIMIENTO.xlsx`, con código **MT/02-05** y versión de encabezado **05**. La plantilla conserva sus celdas combinadas, proporciones, textos, logo y secciones. El anexo contiene textos completos, todos los repuestos/herramientas y datos operativos; las descripciones extensas se abrevian únicamente en la primera hoja. Los espacios de firmas manuscritas se conservan. Los nombres y fechas de confirmación son registros de usuario, no imágenes de firmas.

## Datos para indicadores posteriores

Se guardan datos de base; este cambio no incorpora un tablero que calcule los indicadores.

| Indicador | Datos disponibles |
| --- | --- |
| Disponibilidad | Inicio de parada, retorno a servicio; registro separado de horas programadas y realmente operadas por máquina y período. |
| MTTR | Inicio y fin reales de reparación, condición de falla, causa y espera por repuestos en minutos. |
| MTBF | Máquina, marca de falla correctiva, fecha de detección, horómetros y horas realmente operadas por período. |
| Cumplimiento | Inicio y fin planificados, fin real del trabajo; se conserva separadamente la fecha de recepción. |
| Paradas | Inicio y fin reales de parada; comparar con el intervalo previsto cuando exista. |
| Stock | Repuesto previsto, cantidad, saldo y suficiencia al solicitar; cantidad consumida, saldo previo y minutos de espera al ejecutar. El catálogo mantiene los mínimos para el porcentaje de referencias sobre mínimo. |

En **Solicitudes → Datos de operación para indicadores**, un operador o administrador registra períodos finalizados (por ejemplo turnos), sus horas programadas y las realmente operadas dentro del horario programado. No se permiten solapamientos por máquina. No se deben sumar denominadores repetidos por solicitud. Al desarrollar el tablero se debe definir período, población de equipos, tratamiento de paradas superpuestas y fórmula concreta del porcentaje de stock. Ausencia de planificación o de horómetro se almacena como dato no informado, nunca como cero.

Las fechas operativas se expresan en hora local de Ecuador continental, UTC−5. Los saldos iniciales son al cierre del día: un consumo del mismo día del corte no se contabilizaría, por eso la entrega lo rechaza.

## Integridad y límites

- Operadores y administradores crean solicitudes y períodos. Toda cuenta activa puede consultar y atender solicitudes de otra persona.
- Solo el responsable asignado entrega; solo el solicitante recibe. No hay cambio de responsable, cancelación o reapertura en esta versión.
- La toma y entrega usan bloqueos transaccionales; una entrega repetida se rechaza por estado. Cualquier fallo revierte intervención, consumos y cambio de estado.
- Los repuestos duplicados no heredan saldos ni movimientos.
- La migración y las transacciones deben verificarse con SQL Server antes de usarlo en producción. Las pruebas automatizadas locales emplean conexiones simuladas; no ejecutan la migración contra una base real.
