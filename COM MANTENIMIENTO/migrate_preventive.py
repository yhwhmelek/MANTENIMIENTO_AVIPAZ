"""python migrate_preventive.py --check | --apply. Usa la conexión configurada sin mostrar credenciales."""
import argparse
from pathlib import Path
import sys
from main import obtener_conexion


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        connection = obtener_conexion()
        try:
            cursor = connection.cursor()
            if args.apply:
                cursor.execute(Path(__file__).with_name('migrations').joinpath('015_preventive_maintenance.sql').read_text(encoding='utf-8'))
                while cursor.nextset():
                    pass
                connection.commit()
                print('MIGRATION_015_APPLIED')
            for name in ('PreventiveActivities','PreventivePlans','PreventiveOccurrences','PreventiveSchedule','PreventiveWeekClosures'):
                exists = cursor.execute('SELECT OBJECT_ID(?, ?)', 'dbo.'+name, 'U').fetchone()[0]
                print(name, 'OK' if exists else 'NOT_INSTALLED')
        finally:
            connection.close()
    except Exception as error:
        # El texto ODBC puede contener dirección/usuario; limitar la salida al código.
        print('DATABASE_ERROR', type(error).__name__, str(error.args[0])[:8] if error.args else '')
        sys.exit(1)


if __name__ == '__main__':
    run()
