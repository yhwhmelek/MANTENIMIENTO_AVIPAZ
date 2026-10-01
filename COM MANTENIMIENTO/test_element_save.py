import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import main


class ElementSaveTests(unittest.TestCase):
    def test_create_and_edit_with_and_without_photo(self):
        for element_id in (None, 42):
            for image in (None, 'data:image/jpeg;base64,aW1hZ2U='):
                with self.subTest(element_id=element_id, photo=bool(image)):
                    data = main.MachineElementWrite(machine_id=1, element_type_id=2, name='Bomba de agua', image_data=image)
                    connection = MagicMock()
                    cursor = connection.cursor.return_value
                    cursor.execute.return_value.fetchone.side_effect = [
                        ('previous.jpg',) if element_id else (42,), ('saved',),
                    ]
                    result = {'element_id':42,'machine_id':1,'name':data.name}
                    with patch.object(main, 'obtener_conexion', return_value=connection), \
                         patch.object(main, 'validar_relaciones_elemento') as validate, \
                         patch.object(main, 'guardar_imagen_maquina', return_value='new.jpg' if image else None) as photo, \
                         patch.object(main, 'machine_record', return_value=result):
                        self.assertEqual(main.guardar_elemento(data, element_id), result)
                        validate.assert_called_once_with(cursor, data, element_id)
                        photo.assert_called_once_with(image)
                        connection.commit.assert_called_once()
                        writes = [call for call in cursor.execute.call_args_list if 'INSERT INTO' in call.args[0] or 'UPDATE dbo.MachineElements' in call.args[0]]
                        self.assertEqual(len(writes),1)
                        if element_id:
                            self.assertEqual(writes[0].args[-2], 'new.jpg' if image else 'previous.jpg')

    def test_motor_specification_does_not_require_machine_tower_field(self):
        for existing in (None, SimpleNamespace(NameplateImagePath='previous.jpg')):
            with self.subTest(existing=bool(existing)):
                connection = MagicMock()
                connection.cursor.return_value.execute.return_value.fetchone.side_effect = [existing, ('saved',)]
                with patch.object(main, 'obtener_conexion', return_value=connection), \
                     patch.object(main, 'validar_tipo_data'), patch.object(main, 'validar_data_existente'), \
                     patch.object(main, 'guardar_imagen_maquina', return_value='new.jpg'), \
                     patch.object(main, 'machine_record', return_value={'element_id':42}):
                    self.assertEqual(main.guardar_especificaciones_motor(42, main.MotorSpecificationWrite(), usuario_id=1), {'element_id':42})
                    connection.commit.assert_called_once()


if __name__ == '__main__':
    unittest.main()
