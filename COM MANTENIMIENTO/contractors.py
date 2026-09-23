from contextlib import closing
from typing import Literal

import pyodbc
from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field


class ContractorWrite(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    specialty: Literal['MECANICO', 'ELECTRICO', 'OTRO']
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    active: bool = True


def register_contractors(app, connect, active_user, admin_user):
    def record(row):
        return dict(id=row[0], name=row[1], specialty=row[2], email=row[3], phone=row[4], active=bool(row[5]))

    @app.get('/contratistas')
    def list_contractors(usuario_id: int = Depends(active_user)):
        try:
            with closing(connect()) as connection:
                rows = connection.cursor().execute('SELECT ContractorId,Name,Specialty,Email,Phone,Active FROM dbo.Contractors ORDER BY Active DESC,Name').fetchall()
                return [record(row) for row in rows]
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudieron consultar los contratistas. Ejecuta la migración 014.')

    def save(sql, data, contractor_id=None):
        try:
            with closing(connect()) as connection:
                cursor = connection.cursor()
                args = [data.name.strip(), data.specialty, str(data.email).strip().lower() if data.email else None,
                        data.phone.strip() if data.phone else None, data.active]
                if contractor_id is not None:
                    args.append(contractor_id)
                row = cursor.execute(sql, *args).fetchone()
                if row is None:
                    raise HTTPException(404, 'Contratista no encontrado')
                connection.commit()
                return record(row)
        except HTTPException:
            raise
        except pyodbc.IntegrityError:
            raise HTTPException(409, 'Ya existe un contratista con ese nombre')
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo guardar el contratista')

    @app.post('/contratistas', status_code=201)
    def create_contractor(data: ContractorWrite, usuario_id: int = Depends(admin_user)):
        return save('''INSERT INTO dbo.Contractors(Name,Specialty,Email,Phone,Active)
            OUTPUT INSERTED.ContractorId,INSERTED.Name,INSERTED.Specialty,INSERTED.Email,INSERTED.Phone,INSERTED.Active
            VALUES(?,?,?,?,?)''', data)

    @app.put('/contratistas/{contractor_id}')
    def update_contractor(contractor_id: int, data: ContractorWrite, usuario_id: int = Depends(admin_user)):
        return save('''UPDATE dbo.Contractors SET Name=?,Specialty=?,Email=?,Phone=?,Active=?
            OUTPUT INSERTED.ContractorId,INSERTED.Name,INSERTED.Specialty,INSERTED.Email,INSERTED.Phone,INSERTED.Active
            WHERE ContractorId=?''', data, contractor_id)

    @app.delete('/contratistas/{contractor_id}', status_code=204)
    def deactivate_contractor(contractor_id: int, usuario_id: int = Depends(admin_user)):
        try:
            with closing(connect()) as connection:
                cursor = connection.cursor()
                cursor.execute('UPDATE dbo.Contractors SET Active=0 WHERE ContractorId=?', contractor_id)
                if cursor.rowcount == 0:
                    raise HTTPException(404, 'Contratista no encontrado')
                connection.commit()
                return Response(status_code=204)
        except HTTPException:
            raise
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo desactivar el contratista')
