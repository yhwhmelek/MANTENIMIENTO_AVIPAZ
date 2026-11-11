"""Migra planes generales antiguos a un plan por planta.

Los planes con órdenes publicadas no se eliminan: se desactivan y se crean
planes nuevos por planta para los próximos ciclos. Las órdenes existentes
conservan su fotografía histórica de máquinas.
"""
import json
from contextlib import closing

from main import obtener_conexion
from preventive_maintenance import general_coverage, general_machine_ids, dump


def migrate(cursor):
    rows = cursor.execute(
        'SELECT p.PlanId,p.Data,p.NextDue,a.Data FROM dbo.PreventivePlans p '
        'JOIN dbo.PreventiveActivities a ON a.ActivityId=p.ActivityId'
    ).fetchall()
    migrated = []
    for plan_id, raw_plan, next_due, raw_activity in rows:
        plan = json.loads(raw_plan)
        activity = json.loads(raw_activity)
        if plan.get('scope') != 'GENERAL' or plan.get('plant_id'):
            continue
        if activity.get('scope') != 'GENERAL':
            continue
        machines = general_coverage(cursor, general_machine_ids(cursor, plan))
        plants = sorted({machine['plant_id'] for machine in machines if machine['plant_id']})
        if not plants:
            continue
        plan['machine_ids'] = []
        plan['coverage_mode'] = 'PLANT'
        plan['excluded_machine_ids'] = []
        has_history = bool(cursor.execute(
            'SELECT TOP 1 OccurrenceId FROM dbo.PreventiveOccurrences WHERE PlanId=?', plan_id
        ).fetchone() or cursor.execute(
            'SELECT TOP 1 OccurrenceId FROM dbo.PreventiveHourOccurrences WHERE PlanId=?', plan_id
        ).fetchone())
        if len(plants) == 1 and not has_history:
            plan['plant_id'] = plants[0]
            cursor.execute('UPDATE dbo.PreventivePlans SET Data=? WHERE PlanId=?', dump(plan), plan_id)
            migrated.append((plan_id, plants[0], 'actualizado'))
            continue
        # Con historial o con varias plantas, el registro antiguo se conserva
        # como histórico/inactivo y cada planta recibe su propio plan futuro.
        cursor.execute("UPDATE dbo.PreventivePlans SET Data=? WHERE PlanId=?", dump(plan | {'active': False}), plan_id)
        for plant_id in plants:
            plant_plan = plan | {'plant_id': plant_id, 'active': True}
            new_id = cursor.execute(
                'SET NOCOUNT ON; INSERT INTO dbo.PreventivePlans(ActivityId,MachineId,ElementId,Data,NextDue,UpdatedBy,UpdatedAt) '
                'SELECT ActivityId,NULL,ElementId,?,NextDue,UpdatedBy,UpdatedAt FROM dbo.PreventivePlans WHERE PlanId=?; '
                'SELECT CAST(SCOPE_IDENTITY() AS INT)', dump(plant_plan), plan_id
            ).fetchone()[0]
            migrated.append((new_id, plant_id, 'creado'))
    return migrated


if __name__ == '__main__':
    with closing(obtener_conexion()) as connection:
        try:
            result = migrate(connection.cursor())
            connection.commit()
            for plan_id, plant_id, action in result:
                print(f'{action}: plan {plan_id}, planta {plant_id}')
            print(f'Migrados: {len(result)}')
        except Exception:
            connection.rollback()
            raise
