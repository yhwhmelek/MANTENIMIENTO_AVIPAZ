from contextlib import closing

import pyodbc
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from parts_history import records


class PlantWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    name: str = Field(min_length=1,max_length=100)


class TowerWrite(PlantWrite):
    plant_id: int = Field(gt=0)


def validate_machine_tower(cursor, tower_id):
    if tower_id is not None and not cursor.execute('SELECT TowerId FROM dbo.Towers WITH (HOLDLOCK) WHERE TowerId=?', tower_id).fetchone():
        raise HTTPException(422,'La torre seleccionada no existe')


def register_plant_structure(app, connect, active_user, admin_user):
    def read(sql):
        try:
            with closing(connect()) as connection:
                cursor=connection.cursor();cursor.execute(sql)
                return records(cursor)
        except (pyodbc.Error,RuntimeError):
            raise HTTPException(503,'No se pudo consultar plantas y torres. Verifica la migracion 007.')

    def write(operation):
        try:
            with closing(connect()) as connection:
                try:
                    result=operation(connection.cursor());connection.commit();return result
                except Exception:
                    connection.rollback();raise
        except pyodbc.IntegrityError:
            raise HTTPException(409,'Nombre duplicado o registro con elementos asociados. No se puede eliminar una planta con torres ni una torre con maquinas.')
        except (pyodbc.Error,RuntimeError):
            raise HTTPException(503,'No se pudo guardar. Verifica la migracion 007 y la conexion.')

    @app.get('/plantas')
    def plants(usuario_id: int=Depends(active_user)):
        return read('''SELECT p.PlantId AS plant_id,p.Name AS name,
            (SELECT COUNT(*) FROM dbo.Towers t WHERE t.PlantId=p.PlantId) AS tower_count
            FROM dbo.Plants p ORDER BY p.Name''')

    @app.get('/torres')
    def towers(usuario_id: int=Depends(active_user)):
        return read('''SELECT t.TowerId AS tower_id,t.PlantId AS plant_id,t.Name AS name,p.Name AS plant_name,
            (SELECT COUNT(*) FROM dbo.Machines m WHERE m.TowerId=t.TowerId) AS machine_count
            FROM dbo.Towers t JOIN dbo.Plants p ON p.PlantId=t.PlantId ORDER BY p.Name,t.Name''')

    @app.post('/plantas',status_code=201)
    def create_plant(data: PlantWrite,usuario_id: int=Depends(admin_user)):
        def operation(cursor):
            row=cursor.execute('SET NOCOUNT ON; INSERT INTO dbo.Plants(Name) VALUES(?); SELECT CAST(SCOPE_IDENTITY() AS int);',data.name).fetchone()
            return {'plant_id':row[0],'name':data.name}
        return write(operation)

    @app.put('/plantas/{plant_id}')
    def update_plant(plant_id: int,data: PlantWrite,usuario_id: int=Depends(admin_user)):
        def operation(cursor):
            cursor.execute('UPDATE dbo.Plants SET Name=? WHERE PlantId=?',data.name,plant_id)
            if cursor.rowcount!=1:raise HTTPException(404,'Planta no encontrada')
            return {'plant_id':plant_id,'name':data.name}
        return write(operation)

    @app.post('/torres',status_code=201)
    def create_tower(data: TowerWrite,usuario_id: int=Depends(admin_user)):
        def operation(cursor):
            if not cursor.execute('SELECT PlantId FROM dbo.Plants WITH (HOLDLOCK) WHERE PlantId=?',data.plant_id).fetchone():
                raise HTTPException(422,'Planta no encontrada')
            row=cursor.execute('SET NOCOUNT ON; INSERT INTO dbo.Towers(PlantId,Name) VALUES(?,?); SELECT CAST(SCOPE_IDENTITY() AS int);',data.plant_id,data.name).fetchone()
            return {'tower_id':row[0],'plant_id':data.plant_id,'name':data.name}
        return write(operation)

    @app.put('/torres/{tower_id}')
    def update_tower(tower_id: int,data: TowerWrite,usuario_id: int=Depends(admin_user)):
        def operation(cursor):
            actual=cursor.execute('SELECT PlantId FROM dbo.Towers WITH (UPDLOCK,HOLDLOCK) WHERE TowerId=?',tower_id).fetchone()
            if not actual:raise HTTPException(404,'Torre no encontrada')
            if actual[0]!=data.plant_id:raise HTTPException(422,'La planta de una torre no se puede cambiar. Crea la torre en la planta correcta y reasigna sus maquinas.')
            cursor.execute('UPDATE dbo.Towers SET Name=? WHERE TowerId=?',data.name,tower_id)
            return {'tower_id':tower_id,'plant_id':data.plant_id,'name':data.name}
        return write(operation)

    def delete_record(table, column, record_id):
        def operation(cursor):
            cursor.execute(f'DELETE FROM dbo.{table} WHERE {column}=?',record_id)
            if cursor.rowcount!=1:raise HTTPException(404,'Registro no encontrado')
            return {'deleted':True}
        return write(operation)

    @app.delete('/plantas/{plant_id}')
    def delete_plant(plant_id: int,usuario_id: int=Depends(admin_user)):
        return delete_record('Plants','PlantId',plant_id)

    @app.delete('/torres/{tower_id}')
    def delete_tower(tower_id: int,usuario_id: int=Depends(admin_user)):
        return delete_record('Towers','TowerId',tower_id)
