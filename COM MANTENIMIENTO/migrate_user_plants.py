"""Install/check migration 018 using the configured connection without exposing credentials."""
import argparse
from contextlib import closing
from pathlib import Path
import sys
from main import obtener_conexion


def run():
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--apply', action='store_true')
    action.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        with closing(obtener_conexion()) as connection:
            cursor = connection.cursor()
            if args.apply:
                cursor.execute(Path(__file__).with_name('migrations').joinpath('018_user_plants.sql').read_text(encoding='utf-8'))
                while cursor.nextset():
                    pass
                connection.commit()
            installed = cursor.execute("SELECT COL_LENGTH('dbo.Usuarios','PlantId')").fetchone()[0]
            print('USER_PLANTS', 'OK' if installed else 'MIGRATION_018_REQUIRED')
            if not installed:
                sys.exit(1)
    except Exception as error:
        print('DATABASE_ERROR', type(error).__name__)
        sys.exit(1)


if __name__ == '__main__':
    run()
