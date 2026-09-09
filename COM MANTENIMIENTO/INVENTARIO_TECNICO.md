# Flujo de informacion de repuestos

| Concepto | Tabla | Significado |
| --- | --- | --- |
| Aplicacion tecnica | MachineSpareParts | Repuestos requeridos por maquina/elemento y posicion |
| Intervencion realizada | MaintenanceEvents | Equipo, fecha, tipo y descripcion del trabajo realizado |
| Consumo real | MaintenancePartsUsed | Cantidad utilizada durante una intervencion |
| Compra real | SparePartPurchases | Proveedor, fecha, documento, cantidad, costo unitario y moneda |
| Oferta de proveedores | SparePartSuppliers | Proveedores y condiciones actuales; no es historial de compras |

Las cinco entidades tienen soporte en el sistema. MaintenanceEvents es un
registro basico del trabajo realizado, no un planificador de ordenes preventivas.

## Instalacion

1. Ejecutar la migracion 001 si esta pendiente (especificaciones de elementos).
2. Ejecutar `migrations/002_machine_spare_parts.sql`.
3. Ejecutar `migrations/003_purchases_and_maintenance_parts.sql`.
4. Reiniciar la API y actualizar el frontend.

Los scripts 002 y 003 pueden repetirse para las tablas con el esquema esperado.
No eliminan registros. No ejecutar en una base distinta de mantenimiento.
La API no ejecuta migraciones automaticamente.

## Uso

- Maquinas / Elementos > Ver repuestos: aplicaciones tecnicas; cantidad requerida.
- Repuestos > Compras: registrar una linea por repuesto/documento. El costo es
  unitario sin impuestos, en la moneda indicada; el total es cantidad por costo.
- Activos > Intervenciones: registrar el equipo, fecha y trabajo realizado.
  Filtrar por maquina y fechas, o abrir desde Maquinas > Intervenciones.
  Al crear un registro, se preselecciona la maquina del historial abierto.
- Repuestos > Consumos: seleccionar la intervencion y el repuesto utilizado.
  Se permite consumir repuestos no asignados previamente en MachineSpareParts.
- Consultar por repuesto y fechas; en consumos tambien por maquina. El periodo
  incluye ambos extremos. Imprimir / Guardar PDF usa el dialogo del navegador.

Administradores registran y anulan; usuarios activos consultan. Para corregir
una compra o consumo, anular con motivo y registrar el dato correcto. Se guarda
usuario y fecha de creacion/anulacion. No hay borrado fisico ni edicion del costo
historico. Una intervencion incorrecta se reemplaza por un nuevo registro;
anular y volver a registrar sus consumos si correspondiera.

Compras y consumos conservan la unidad de medida usada al registrarlos; las
etiquetas de repuesto, maquina y proveedor se consultan del catalogo actual.
CreatedBy y VoidedBy guardan los identificadores de usuario autenticado.
Las compras no cambian los precios del catalogo ni agregan automaticamente
relaciones en SparePartSuppliers.

## Consultas e indicadores

- Ultima compra: seleccionar un repuesto en Compras. Se toma la compra vigente
  mas reciente dentro del periodo, desempatada por ID. Vaciar fechas para
  consultar todo el historial. Se muestra su proveedor y moneda, sin conversion.
- Consumos de 2026: seleccionar repuesto y fechas 2026-01-01 / 2026-12-31.
  Son cantidades consumidas, no necesariamente unidades reemplazadas.
- Duracion: opcionalmente registrar en un consumo de cantidad 1 los horometros
  de instalacion anterior y retiro de una unidad del mismo repuesto. Deben ser
  del mismo contador, sin reinicios. Se promedian solamente registros vigentes
  con ambas lecturas, para el repuesto y filtros seleccionados. Se muestra el
  numero de mediciones. No es MTBF ni seguimiento completo de vida de activos.
- Los anulados pueden visualizarse pero se excluyen de los resumenes.
- Las cantidades se agrupan por unidad; no se suman importes de monedas distintas.

## Limites del alcance

Estos registros NO modifican existencias de bodega. Todavia no existe un kardex
con saldos iniciales, recepciones, devoluciones, ajustes y salidas transaccionales.
Las devoluciones parciales y notas de credito tampoco estan modeladas. No usar
compras menos consumos como saldo de inventario sin esos movimientos.

No se generan planes preventivos, ordenes de trabajo ni indicadores MTBF/MTTR.
La asignacion tecnica sigue independiente: quitarla no elimina compras ni consumos.

Pruebas: `python -m unittest test_parts_history test_machine_spare_parts test_element_data`.
