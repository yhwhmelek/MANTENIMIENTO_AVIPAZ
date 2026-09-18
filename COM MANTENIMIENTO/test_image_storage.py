import base64
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main
import maintenance_requests
from image_storage import image_directory, stored_image


class ImageStorageTests(unittest.TestCase):
    def test_all_new_images_share_one_folder(self):
        png = b'\x89PNG\r\n\x1a\n' + b'test image'
        data = 'data:image/png;base64,' + base64.b64encode(png).decode()
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'IMAGE_DIR': folder}):
            paths = [
                main.guardar_imagen_maquina(data),
                main.guardar_imagen_placa('M-1', data),
                main.guardar_imagen_repuesto('R-1', data),
                maintenance_requests.save_request_image(data),
            ]
            self.assertEqual(len(set(paths)), 4)
            self.assertTrue(all(Path(path).parent == image_directory() for path in paths))
            self.assertTrue(all(stored_image(path) == Path(path) for path in paths))

    def test_old_configured_folder_remains_readable(self):
        with tempfile.TemporaryDirectory() as old, tempfile.TemporaryDirectory() as new:
            path = Path(old) / 'original.jpg'
            path.write_bytes(b'previous photo')
            with patch.dict(os.environ, {'IMAGE_DIR': new, 'MOTOR_NAMEPLATE_DIR': old}):
                self.assertEqual(stored_image(str(path)), path.resolve())
                self.assertIsNone(stored_image(str(Path(new).parent / 'outside.jpg')))


if __name__ == '__main__':
    unittest.main()
