import unittest
from unittest.mock import MagicMock

from fastapi import FastAPI
from pydantic import ValidationError

from business_contacts import ContactWrite, register_business_contacts


class BusinessContactsTests(unittest.TestCase):
    def setUp(self):
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        app = FastAPI()
        register_business_contacts(app, lambda: self.connection, lambda: 1, lambda: 9)
        self.routes = {(route.path, method): route.endpoint for route in app.routes for method in route.methods}

    def test_contact_without_mobile_and_email_normalization(self):
        data = ContactWrite(name='  Ana Pérez  ', email=' ANA@EXAMPLE.COM ', mobile=' ')
        self.assertEqual((data.name, data.email, data.mobile), ('Ana Pérez', 'ana@example.com', None))
        self.cursor.execute.return_value.fetchone.return_value = (3, data.name, data.email, None)
        saved = self.routes['/contactos-empresariales', 'POST'](data, 9)
        self.assertEqual(saved['mobile'], None)
        self.connection.commit.assert_called_once()
        with self.assertRaises(ValidationError):
            ContactWrite(name=' ', email='ana@example.com')

    def test_recipient_list_combines_sources_and_deduplicates_email(self):
        self.cursor.execute.return_value.fetchall.return_value = [
            ('Ana Pérez', 'ana@example.com', 'Contacto empresarial'),
            ('Proveedor ABC', 'compras@example.com', 'Proveedor'),
            ('Ana', 'ANA@example.com', 'Usuario'),
        ]
        result = self.routes['/contactos-correo', 'GET'](1)
        self.assertEqual(result, [
            {'name': 'Ana Pérez', 'email': 'ana@example.com', 'source': 'Contacto empresarial'},
            {'name': 'Proveedor ABC', 'email': 'compras@example.com', 'source': 'Proveedor'},
        ])


if __name__ == '__main__':
    unittest.main()
