"""Directorio de contactos para destinatarios de requisiciones."""
from contextlib import closing

import pyodbc
from fastapi import Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, model_validator


class ContactWrite(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    email: EmailStr = Field(max_length=254)
    mobile: str | None = Field(default=None, max_length=30)

    @model_validator(mode='after')
    def normalize(self):
        self.name = self.name.strip()
        self.email = str(self.email).strip().lower()
        self.mobile = self.mobile.strip() or None if self.mobile is not None else None
        if not self.name:
            raise ValueError('El nombre es obligatorio')
        return self


def register_business_contacts(app, connect, active_user, admin_user):
    def read(query, *params):
        try:
            with closing(connect()) as connection:
                return connection.cursor().execute(query, *params).fetchall()
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo consultar el directorio. Verifica la migracion 012.')

    def write(query, *params):
        try:
            with closing(connect()) as connection:
                cursor = connection.cursor()
                row = cursor.execute(query, *params).fetchone()
                if row is None:
                    raise HTTPException(404, 'Contacto no encontrado')
                connection.commit()
                return dict(id=row[0], name=row[1], email=row[2], mobile=row[3])
        except HTTPException:
            raise
        except pyodbc.IntegrityError:
            raise HTTPException(409, 'Ya existe un contacto empresarial con ese correo')
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo guardar el contacto. Verifica la migracion 012.')

    @app.get('/contactos-empresariales')
    def list_business_contacts(user: int = Depends(admin_user)):
        rows = read('SELECT ContactId, Name, Email, Mobile FROM dbo.BusinessContacts ORDER BY Name, ContactId')
        return [dict(id=r[0], name=r[1], email=r[2], mobile=r[3]) for r in rows]

    @app.post('/contactos-empresariales', status_code=201)
    def create_contact(data: ContactWrite, user: int = Depends(admin_user)):
        return write('''INSERT INTO dbo.BusinessContacts (Name, Email, Mobile)
            OUTPUT INSERTED.ContactId, INSERTED.Name, INSERTED.Email, INSERTED.Mobile
            VALUES (?, ?, ?)''', data.name, str(data.email), data.mobile)

    @app.put('/contactos-empresariales/{contact_id}')
    def update_contact(contact_id: int, data: ContactWrite, user: int = Depends(admin_user)):
        return write('''UPDATE dbo.BusinessContacts SET Name=?, Email=?, Mobile=?
            OUTPUT INSERTED.ContactId, INSERTED.Name, INSERTED.Email, INSERTED.Mobile
            WHERE ContactId=?''', data.name, str(data.email), data.mobile, contact_id)

    @app.delete('/contactos-empresariales/{contact_id}', status_code=204)
    def delete_contact(contact_id: int, user: int = Depends(admin_user)):
        try:
            with closing(connect()) as connection:
                cursor = connection.cursor()
                cursor.execute('DELETE FROM dbo.BusinessContacts WHERE ContactId=?', contact_id)
                if not cursor.rowcount:
                    raise HTTPException(404, 'Contacto no encontrado')
                connection.commit()
        except HTTPException:
            raise
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo eliminar el contacto')

    @app.get('/contactos-correo')
    def mail_recipients(user: int = Depends(active_user)):
        rows = read('''SELECT Name, Email, 'Contacto empresarial' AS Source FROM dbo.BusinessContacts
            UNION ALL
            SELECT COALESCE(NULLIF(LTRIM(RTRIM(ContactName)), ''), Name), Email, 'Proveedor'
              FROM dbo.Suppliers WHERE Active=1 AND Email IS NOT NULL AND LTRIM(RTRIM(Email))<>''
            UNION ALL
            SELECT COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(Nombres, ' ', Apellidos))), ''), Nombre), Correo, 'Usuario'
              FROM dbo.Usuarios WHERE Activo=1 AND Correo IS NOT NULL AND LTRIM(RTRIM(Correo))<>''
            ORDER BY Source, Name''')
        seen = set()
        contacts = []
        for name, email, source in rows:
            key = email.strip().lower()
            if key not in seen:
                seen.add(key)
                contacts.append(dict(name=name, email=email, source=source))
        return contacts
