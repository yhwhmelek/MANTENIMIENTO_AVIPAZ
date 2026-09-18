"""One server folder for new photos, with read access to previous locations."""

import os
from pathlib import Path


def image_directory():
    return Path(os.getenv('IMAGE_DIR', str(Path(__file__).parent / 'uploads' / 'solicitudes'))).resolve()


def legacy_image_directories():
    roots = [Path(__file__).parent / 'uploads' / 'maquinas']
    for name in ('REQUEST_IMAGE_DIR', 'MACHINE_IMAGE_DIR', 'MOTOR_NAMEPLATE_DIR', 'SPARE_PART_IMAGE_DIR'):
        value = os.getenv(name)
        if value:
            roots.append(Path(value))
    if os.name == 'nt':
        roots.extend(Path(value) for value in (
            r'D:\MANTENIMIENTO\IMAGES\MOTORES\PLACAS',
            r'D:\MANTENIMIENTO\IMAGES\REPUESTOS',
        ))
    return [root.resolve() for root in roots]


def stored_image(path_value):
    if not path_value:
        return None
    path = Path(path_value).resolve()
    if path.is_file() and any(path.is_relative_to(root) for root in [image_directory(), *legacy_image_directories()]):
        return path
    return None
