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
                for migration in ('015_preventive_maintenance.sql', '016_general_preventive_plans.sql', '017_preventive_operating_hours.sql'):
                    cursor.execute(Path(__file__).with_name('migrations').joinpath(migration).read_text(encoding='utf-8'))
                    while cursor.nextset():
                        pass
                    connection.commit()
                    print('MIGRATION_APPLIED', migration)
            for name in ('PreventiveActivities','PreventivePlans','PreventiveOccurrences','PreventiveSchedule','PreventiveWeekClosures','MachineHourReadings','PreventiveHourOccurrences'):
                exists = cursor.execute('SELECT OBJECT_ID(?, ?)', 'dbo.'+name, 'U').fetchone()[0]
                print(name, 'OK' if exists else 'NOT_INSTALLED')
            column = cursor.execute("SELECT is_nullable FROM sys.columns WHERE object_id=OBJECT_ID('dbo.PreventivePlans') AND name='MachineId'").fetchone()
            print('GeneralPreventivePlans', 'OK' if column and column[0] else 'MIGRATION_016_REQUIRED')
        finally:
            connection.close()
    except Exception as error:
        # El texto ODBC puede contener dirección/usuario; limitar la salida al código.
        print('DATABASE_ERROR', type(error).__name__, str(error.args[0])[:8] if error.args else '')
        sys.exit(1)


if __name__ == '__main__':
    run()
