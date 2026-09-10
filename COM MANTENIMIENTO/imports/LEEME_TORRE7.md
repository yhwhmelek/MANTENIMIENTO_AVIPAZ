# Carga de fichas de Samanga / Torre 7

Hojas leidas: 69. Maquinas listas: 65. Elementos motor: 66.

## Uso

Abrir `cargar_torre7.sql` en la base de mantenimiento. Ejecutar primero con `@Aplicar=0` para revisar las dos tablas. Para guardar, cambiar a `@Aplicar=1` y ejecutar todo el archivo. Requiere migraciones 001 a 007. No se ha ejecutado contra SQL Server desde esta preparacion.

Las coincidencias por codigo y nombre conservan los datos existentes. Solo se asigna Torre 7 si la ubicacion esta vacia. Conflictos de nombre, torre o motores existentes abortan la transaccion. La repeticion no duplica los codigos importados. Los codigos de motor son CODIGO-M1, CODIGO-M2.

No se importan imagenes ni movimientos historicos. Estado inicial ACTIVA/OPERATIVO salvo fichas fuera de servicio; verificar el estado actual en la aplicacion. Los motores sin datos quedan pendientes de verificar en Notas. No se infiere cantidad adicional si la ficha no la indica.

Voltajes, corrientes y velocidades multiples se conservan completos en Notas; su campo numerico queda nulo. Fases no se confunde con polos. Potencias W se convierten a kW; HP y kW se conservan cuando figuran expresamente. Los datos de QUEMADOR de los calderos quedan en notas de maquina, sin atribuirlos a su motor. BIN PRODUCTO TERMINADO 8 usa la ficha derecha T7BPT8, no la copia de BIN 6 a la izquierda.

## Maquinas omitidas por indicacion del usuario (codigos repetidos)

- RANGER 1(FUERA DE SERVICIO): T7RNG1
- SIFTER: T7RNG1
- SELLADORA TERMICA 2: T7SET2
- PLUMBING RACK: T7SET2

Para corregirlos, crear un JSON con nombre de hoja y codigo definitivo y regenerar con `python prepare_torre7.py "ruta.ods" --codes codigos.json`.

## Maquinas preparadas

| Codigo | Maquina | Motores |
|---|---|---|
| T7CA1 | CALDERO 1 | 1 |
| T7CA2 | CALDERO 2 | 1 |
| T7COM1 | COMPRESOR 1 | 1 |
| T7COM2 | COMPRESOR 2 | 1 |
| T7CHI1 | CHILLER | 1 |
| T7MGP5 | IMÁN PERMANENTE 5 | 1 |
| T7TOP1 | TOLVA PULMÓN 1 | 1 |
| T7TOV1 | TOLVA VIVA 1 | 1 |
| T7ALM4 | ALIMENTADOR 4 | 1 |
| T7ACN2 | ACONDICIONADOR 2 | 1 |
| T7EXT2 | EXTRUSOR 2 | 1 |
| T7TRN1 | TRANSPORTADOR NEUMATICO 1 | 1 |
| T7ARL7 | AIR LOCK 7 | 1 |
| T7BRD1 | BRAZO DE DISTRIBUCIÓN 1 | 1 |
| T7SCD1 | SECADORA 1 | 2 |
| T7CLV5 | CICLON VENTILADOR 5 | 1 |
| T7ARL8 | AIR LOCK 8 | 1 |
| T7CLV6 | CICLON VENTILADOR 6 | 1 |
| T7ARL9 | AIR LOCK 9 | 1 |
| T7BTR1 | BANDA TRANSPORTADORA 1 | 1 |
| T7ELC11 | ELEVADOR DE CANGILONES 11 | 1 |
| T7ACU7 | ACUMULADOR SECADO 1 | 1 |
| T7BTR2 | BANDA TRANSPORTADORA 2 | 1 |
| T7AA1 | TAMBOR DE ADHESION DE ACEITES | 1 |
| T7TA1 | TANQUE DE ACEITES 1 | 1 |
| T7TS1 | TANQUE SABORIZANTE 1 | 1 |
| T7ARL10 | AIR LOCK 10 | 1 |
| T7RPK1 | REPICKY 1 | 1 |
| T7CDP1 | COLECTOR DE POLVOS 1 | 1 |
| T7ARL11 | AIR LOCK 11 | 1 |
| T7EFV1 | ENFRIADOR VERTICAL 1 | 1 |
| T7ARL12 | AIR LOCK 12 | 1 |
| T7CLV7 | CICLON VENTILADOR 7 | 1 |
| T7ARL13 | AIR LOCK 13 | 1 |
| T7RPK2 | REPICKY 2 | 1 |
| T7CDP2 | RECOLECTOR DE POLVOS 2 | 1 |
| T7ARL14 | AIR LOCK 14 | 1 |
| T7TRE11 | TRANSPORTADOR RELER 11 | 1 |
| T7BPT1 | BIN PRODUCTO TERMINADO 1 | 1 |
| T7BPT2 | BIN PRODUCTO TERMINADO 2 | 1 |
| T7BPT3 | BIN PRODUCTO TERMINADO 3 | 1 |
| T7BPT4 | BIN PRODUCTO TERMINADO 4 | 1 |
| T7RPK3 | REPICKY 3 | 1 |
| T7ARL15 | AIR LOCK 15 | 1 |
| T7ARL16 | AIR LOCK 16 | 1 |
| T7ARL17 | AIR LOCK 17 | 1 |
| T7ARL18 | AIR LOCK 18 | 1 |
| T7ARL19 | AIR LOCK 19 | 1 |
| T7CDP3 | COLECTOR DE POLVOS 3 | 1 |
| T7BPT5 | BIN PRODUCTO TERMINADO 5 | 1 |
| T7BPT6 | BIN PRODUCTO TERMINADO 6 | 1 |
| T7BPT7 | BIN PRODUCTO TERMINADO 7 | 1 |
| T7BPT8 | BIN PRODUCTO TERMINADO 8 | 1 |
| T7RPK4 | REPICKY 4 | 1 |
| T7ARL20 | AIR LOCK 20 | 1 |
| T7ARL21 | AIR LOCK 21 | 1 |
| T7ARL22 | AIR LOCK 22 | 1 |
| T7ENS1 | ENSACADORA 1 | 1 |
| T7ENS2 | ENSACADORA 2 | 1 |
| T7COS4 | COSEDORA 4 | 1 |
| T7BTR3 | BANDA TRANSPORTADORA 3 | 1 |
| T7SET1 | SELLADORA TERMICA 1 | 1 |
| T7MPK1 | MULTICABEZAL 1 | 1 |
| T7CDF1 | CODIFICADORA 1 | 1 |
| T7CDF2 | CODIFICADORA 2 | 1 |
