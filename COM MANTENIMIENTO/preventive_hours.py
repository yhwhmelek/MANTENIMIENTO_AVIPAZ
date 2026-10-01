"""Operating-hour readings and preventive thresholds; no conversion to wall-clock time."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from fastapi import HTTPException
from pydantic import Field, model_validator
from request_priority import StrictModel


def local_now():
    return datetime.now(timezone(timedelta(hours=-5))).replace(tzinfo=None)


class HourReading(StrictModel):
    machine_id: int = Field(gt=0)
    hours: Decimal = Field(ge=0, le=999999999, decimal_places=2)
    observed_at: datetime = Field(default_factory=local_now)
    counter_reset: bool = False

    @model_validator(mode='after')
    def valid_time(self):
        if self.observed_at.tzinfo or self.observed_at > local_now():
            raise ValueError('La lectura debe tener fecha local de Ecuador y no ser futura')
        return self


def record_reading(cursor, data, user):
    if not cursor.execute('SELECT MachineId FROM dbo.Machines WITH (UPDLOCK,HOLDLOCK) WHERE MachineId=?', data.machine_id).fetchone():
        raise HTTPException(422, 'Máquina no encontrada')
    previous = cursor.execute('SELECT TOP 1 Hours,ObservedAt,CounterHours FROM dbo.MachineHourReadings WHERE MachineId=? ORDER BY ObservedAt DESC,ReadingId DESC', data.machine_id).fetchone()
    if previous and data.observed_at < previous[1]:
        raise HTTPException(409, 'La lectura no puede ser anterior a la última registrada')
    if previous and data.observed_at == previous[1]:
        if data.hours != previous[2]:
            raise HTTPException(409, 'Ya existe otra lectura para ese instante')
        return dict(machine_id=data.machine_id,hours=str(previous[0]),counter_hours=str(previous[2]),observed_at=previous[1].isoformat())
    if previous and data.hours < previous[2] and not data.counter_reset:
        raise HTTPException(409, 'El contador bajó. Si se reinició el PLC, confirma el reset; registra primero la lectura final anterior al reset.')
    if data.counter_reset and not previous:
        raise HTTPException(422, 'Registra la lectura anterior antes de confirmar un reset')
    accumulated = previous[0] + data.hours - (Decimal(0) if data.counter_reset else previous[2]) if previous else data.hours
    cursor.execute('INSERT INTO dbo.MachineHourReadings(MachineId,Hours,CounterHours,CounterReset,ObservedAt,RecordedBy) VALUES(?,?,?,?,?,?)', data.machine_id, accumulated, data.hours, data.counter_reset, data.observed_at, user)
    return dict(machine_id=data.machine_id, hours=str(accumulated), counter_hours=str(data.hours), observed_at=data.observed_at.isoformat())


def latest_readings(cursor):
    rows = cursor.execute('''SELECT MachineId,Hours,ObservedAt,CounterHours FROM (
        SELECT MachineId,Hours,ObservedAt,CounterHours,ROW_NUMBER() OVER(PARTITION BY MachineId ORDER BY ObservedAt DESC,ReadingId DESC) AS rn
        FROM dbo.MachineHourReadings) readings WHERE rn=1''').fetchall()
    return {r[0]:dict(machine_id=r[0],hours=str(r[1]),counter_hours=str(r[3]),observed_at=r[2].isoformat()) for r in rows}


def machine_threshold(plan, frequency, machine_id, reading, completed=None, open_request=None):
    baseline = Decimal(str(plan.get('hour_bases',{}).get(str(machine_id), plan.get('hour_base',0))))
    base = Decimal(str(completed)) if completed is not None else baseline
    first = completed is None and not plan.get('first_service_done',False)
    target = base + Decimal(str((frequency.get('first_hours') or frequency['every']) if first else frequency['every']))
    advance = Decimal(str(frequency.get('advance_hours',0)))
    current = Decimal(str(reading['hours'])) if reading else None
    state = 'SIN_LECTURA' if current is None else 'VENCIDO' if current >= target else 'PROXIMO' if current >= target-advance else 'AL_DIA'
    if current is not None and current < base:
        state = 'REVISAR_REFERENCIA'
    if open_request:
        state = 'EN_TRABAJO'
    return dict(machine_id=machine_id, current_hours=str(current) if current is not None else None,
                counter_hours=reading.get('counter_hours') if reading else None,
                service_hours=str(current-base) if current is not None else None,
                target_hours=str(target), alert_hours=str(max(Decimal(0),target-advance)),
                remaining_hours=str(target-current) if current is not None else None, first_service=first,
                state=state, request_id=open_request, observed_at=reading['observed_at'] if reading else None)


def hour_states(cursor, catalog):
    activities = {a['id']:a for a in catalog['activities']}
    plans = [p for p in catalog['plans'] if p['active'] and activities[p['activity_id']]['active'] and (p.get('frequency_override') or activities[p['activity_id']]['frequency'])['unit']=='HORAS']
    if not plans:
        return []
    readings = latest_readings(cursor)
    history = cursor.execute('''SELECT o.PlanId,o.MachineId,o.CompletedHours,o.RequestId,r.Status
        FROM dbo.PreventiveHourOccurrences o JOIN dbo.MaintenanceRequests r ON r.RequestId=o.RequestId
        ORDER BY o.OccurrenceId''').fetchall()
    completed, opened = {}, {}
    for plan_id,machine_id,hours,request_id,status in history:
        if hours is not None:
            completed[plan_id,machine_id] = hours
        if status != 'CERRADA':
            opened[plan_id,machine_id] = request_id
    calendar_open = dict(cursor.execute('''SELECT o.PlanId,o.RequestId FROM dbo.PreventiveOccurrences o
        JOIN dbo.MaintenanceRequests r ON r.RequestId=o.RequestId WHERE r.Status<>'CERRADA' ''').fetchall())
    result = []
    for plan in plans:
        activity = activities[plan['activity_id']]
        frequency = plan.get('frequency_override') or activity['frequency']
        machine_ids = plan['machine_ids'] if plan.get('scope')=='GENERAL' else [plan['machine_id']]
        machines = [machine_threshold(plan,frequency,i,readings.get(i),completed.get((plan['id'],i)),opened.get((plan['id'],i)) or calendar_open.get(plan['id'])) for i in machine_ids]
        result.append(dict(plan_id=plan['id'], activity=activity['name'], group=activity['group'], frequency=frequency, machines=machines))
    return result


def finish_hour_work(cursor, request_id, original, values, user):
    targets = (original.get('preventive') or {}).get('hour_targets', [])
    if not targets:
        return
    items = original['preventive']['items']
    # An unperformed/partial job must not restart its service interval.
    if any(item['status'] != 'REALIZADO' for item in items):
        return
    required = {str(t['machine_id']) for t in targets}
    if set(values) != required:
        raise HTTPException(422, 'Registra el horómetro al terminar para cada máquina del preventivo por horas')
    for target in sorted(targets, key=lambda t:t['machine_id']):
        value = values[str(target['machine_id'])]
        reading = HourReading(machine_id=target['machine_id'], hours=value)
        recorded = record_reading(cursor, reading, user)
        if Decimal(recorded['hours']) < Decimal(target['current_hours']):
            raise HTTPException(422, 'Las horas acumuladas no pueden ser menores a las registradas al programar')
        cursor.execute('UPDATE dbo.PreventiveHourOccurrences SET CompletedHours=? WHERE RequestId=? AND MachineId=?', Decimal(recorded['hours']), request_id, reading.machine_id)
