# Plantas, torres y máquinas

Ejecutar `migrations/007_plants_and_towers.sql`, reiniciar la API y publicar el frontend actualizado. Compatible con SQL Server 2014 (12.x). La migración crea:

- Santa Fe: Torre 1, Torre 2.
- Samanga: Torre 5, Torre 6, Torre 7.

Las tablas son `dbo.Plants` y `dbo.Towers`. Cada torre tiene un `PlantId`; cada máquina tiene un `TowerId` opcional. La planta de la máquina se obtiene de su torre, evitando asignaciones contradictorias. Los nombres de torres son únicos dentro de cada planta, por lo que dos plantas sí pueden tener una torre con el mismo nombre.

En **Activos → Plantas y torres**, el administrador puede crear y renombrar plantas y torres. No puede borrar plantas con torres ni torres con máquinas. La planta de una torre existente no se cambia: para corregir una distribución se crea la torre destino y se reasignan las máquinas.

En **Activos → Máquinas → Editar**, seleccionar planta y torre y guardar. También se incluyen estos campos al crear máquinas. Las máquinas existentes quedan **Sin asignar** hasta completar la distribución; no se modifican su código, área, ubicación, repuestos, solicitudes ni historial.

El listado de máquinas muestra planta y torre y permite filtrar por ambas, incluyendo las máquinas sin asignación. La opción Sin asignar al editar elimina únicamente la relación con la torre.

La migración se puede volver a ejecutar sin duplicar las plantas ni torres iniciales. No se ha aplicado automáticamente a una base de datos externa.
