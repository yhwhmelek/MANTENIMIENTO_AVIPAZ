"""Planes por calendario y registro semanal MT/02-03 sobre las órdenes existentes."""
import calendar
import json
from contextlib import closing
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

import pyodbc
from fastapi import Depends, HTTPException
from fastapi.responses import Response
from pydantic import Field, model_validator
from request_priority import StrictModel, NIC, ASSIGNMENT_GROUPS, priority


def now():
    return datetime.now(timezone(timedelta(hours=-5))).replace(tzinfo=None)


def dump(value):
    return json.dumps(value, ensure_ascii=False, default=lambda x: x.isoformat())


class Frequency(StrictModel):
    every: int = Field(ge=1, le=1200)
    unit: Literal['DIAS', 'SEMANAS', 'MESES']


class ActivityWrite(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    procedure: str = Field(min_length=1, max_length=4000)
    kind: Literal['GENERAL', 'ENGRASE', 'ACEITE', 'RODAMIENTOS', 'BOBINADO'] = 'GENERAL'
    frequency: Frequency
    group: Literal['MECANICO', 'ELECTRICO', 'MECANICO_ELECTRICO', 'MANTENIMIENTO']
    duration_minutes: int = Field(ge=1, le=525600)
    crew_size: int = Field(default=1, ge=1, le=100)
    factors: NIC
    reference: str = Field(default='', max_length=500)
    requires_shutdown: bool = False
    active: bool = True
    revision: int = Field(default=0, ge=0)


class Point(StrictModel):
    name: str = Field(min_length=1, max_length=150)
    bearing_code: str = Field(default='', max_length=100)
    housing_code: str = Field(default='', max_length=100)
    lubricant: str = Field(default='', max_length=150)
    dose: str = Field(default='', max_length=100)


class PlanWrite(StrictModel):
    activity_id: int = Field(gt=0)
    machine_id: int = Field(gt=0)
    element_id: int | None = Field(default=None, gt=0)
    first_due: date
    start_time: time = time(8)
    frequency_override: Frequency | None = None
    override_reason: str = Field(default='', max_length=500)
    route: str = Field(default='', max_length=150)
    points: list[Point] = Field(default_factory=list, max_length=100)
    active: bool = True
    revision: int = Field(default=0, ge=0)

    @model_validator(mode='after')
    def valid(self):
        if not date(2000, 1, 1) <= self.first_due <= date(2200, 12, 31):
            raise ValueError('La fecha base debe estar entre los años 2000 y 2200')
        if self.frequency_override and not self.override_reason:
            raise ValueError('Indica el motivo de la frecuencia particular')
        if self.start_time.tzinfo:
            raise ValueError('Utiliza la hora local de Ecuador')
        if len({p.name.casefold() for p in self.points}) != len(self.points):
            raise ValueError('Los nombres de los puntos no deben repetirse')
        return self


class WeekWrite(StrictModel):
    week: date


class PublishWrite(WeekWrite):
    plan_ids: list[int] = Field(min_length=1, max_length=500)


class RescheduleWrite(StrictModel):
    scheduled_date: date
    reason: str = Field(min_length=1, max_length=1000)


class ChecklistResult(StrictModel):
    key: str = Field(min_length=1, max_length=100)
    status: Literal['PENDIENTE', 'REALIZADO', 'NO_REALIZADO']
    notes: str = Field(default='', max_length=1000)

    @model_validator(mode='after')
    def reason(self):
        if self.status == 'NO_REALIZADO' and not self.notes:
            raise ValueError('Indica el motivo del punto no realizado')
        return self


class Participant(StrictModel):
    user_id: int = Field(gt=0)
    minutes: int = Field(ge=1, le=525600)


class ChecklistWrite(StrictModel):
    revision: int = Field(ge=0)
    items: list[ChecklistResult] = Field(min_length=1, max_length=100)
    participants: list[Participant] = Field(default_factory=list, max_length=100)


def monday(day):
    return day - timedelta(days=day.weekday())


def next_due(current, frequency, anchor_day):
    if frequency['unit'] != 'MESES':
        return current + timedelta(days=frequency['every'] * (7 if frequency['unit'] == 'SEMANAS' else 1))
    month = current.year * 12 + current.month - 1 + frequency['every']
    year, month = divmod(month, 12)
    month += 1
    return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))


def due_cycles(plan, activity, week):
    """Calendario fijo. Un vencimiento atrasado visible y siguientes ciclos de la semana."""
    end = monday(week) + timedelta(days=6)
    current = date.fromisoformat(plan['next_due'])
    frequency = plan.get('frequency_override') or activity['frequency']
    anchor = date.fromisoformat(plan['first_due']).day
    result = []
    # Saltar ciclos atrasados sin marcarlos realizados; conservar su intervalo en la orden.
    while current <= end:
        if len(result) >= 8:
            break
        scheduled = max(current, monday(week))
        following = next_due(current, frequency, anchor)
        skipped = 0
        while following <= scheduled:
            following = next_due(following, frequency, anchor)
            skipped += 1
        result.append(dict(due=current.isoformat(), scheduled=scheduled.isoformat(), next_due=following.isoformat(), skipped=skipped))
        current = following
    return result


def checklist_complete(data):
    preventive = data.get('preventive')
    if not preventive:
        return
    items = preventive.get('items', [])
    if not items or any(i.get('status') == 'PENDIENTE' for i in items):
        raise HTTPException(409, 'Completa el checklist preventivo: registra cada punto realizado o su motivo de no ejecución')
    if not preventive.get('participants'):
        raise HTTPException(409, 'Registra los participantes y sus minutos reales en el checklist')


def item_status(request_status, data, moved=False):
    if moved:
        return 'REPROGRAMADO'
    items = data.get('preventive', {}).get('items', [])
    done = sum(i.get('status') == 'REALIZADO' for i in items)
    if request_status in ('POR_RECIBIR', 'CERRADA'):
        if items and done != len(items):
            return 'PARCIAL' if done else 'NO_REALIZADO'
        return 'EJECUTADO' if data.get('admin_review') or request_status == 'CERRADA' else 'POR_VALIDAR'
    return 'EN_PROCESO' if request_status == 'EN_PROCESO' else 'PENDIENTE'


def register_preventive(app, connect, active_user, admin_user):
    def transaction(operation):
        try:
            with closing(connect()) as connection:
                try:
                    result = operation(connection.cursor())
                    connection.commit()
                    return result
                except Exception:
                    connection.rollback()
                    raise
        except pyodbc.IntegrityError:
            raise HTTPException(409, 'Los datos cambiaron o ya se generó esa actividad. Actualiza el módulo.')
        except (pyodbc.Error, RuntimeError):
            raise HTTPException(503, 'No se pudo acceder al módulo preventivo. Verifica la conexión y la migración 015.')

    def staff(cursor, user):
        row = cursor.execute('SELECT Rol FROM dbo.Usuarios WHERE Id=? AND Activo=1', user).fetchone()
        if not row or row[0] not in ('ADMIN', 'MECANICO', 'ELECTRICO'):
            raise HTTPException(403, 'Este módulo es para el personal de mantenimiento')

    def stamp(cursor, user):
        person = cursor.execute("SELECT COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(Nombres,' ',Apellidos))),''),Nombre) FROM dbo.Usuarios WHERE Id=?", user).fetchone()
        return dict(by=user, name=person[0] if person else str(user), at=now().isoformat())

    def serialized(rows, plans=False):
        return [json.loads(r[1]) | dict(id=r[0], revision=r[2]) | (dict(next_due=r[3].isoformat()) if plans else {}) for r in rows]

    def catalogs(cursor):
        activities = serialized(cursor.execute('SELECT ActivityId,Data,Revision FROM dbo.PreventiveActivities ORDER BY ActivityId').fetchall())
        plans = serialized(cursor.execute('SELECT PlanId,Data,Revision,NextDue FROM dbo.PreventivePlans ORDER BY PlanId').fetchall(), True)
        return dict(activities=activities, plans=plans)

    def week_open(cursor, week):
        if cursor.execute('SELECT WeekStart FROM dbo.PreventiveWeekClosures WITH (UPDLOCK,HOLDLOCK) WHERE WeekStart=?', monday(week)).fetchone():
            raise HTTPException(409, 'La semana está cerrada. Conserva su registro y programa en otra semana abierta.')

    @app.get('/preventivos/catalogo')
    def catalog(usuario_id: int = Depends(active_user)):
        def operation(cursor):
            staff(cursor, usuario_id)
            return catalogs(cursor)
        return transaction(operation)

    @app.get('/preventivos/personal')
    def people(usuario_id: int = Depends(active_user)):
        def operation(cursor):
            staff(cursor, usuario_id)
            rows = cursor.execute("SELECT Id,COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(Nombres,' ',Apellidos))),''),Nombre),Rol FROM dbo.Usuarios WHERE Activo=1 AND Rol IN ('ADMIN','MECANICO','ELECTRICO') ORDER BY Nombre").fetchall()
            return [dict(id=r[0], nombre_completo=r[1], rol=r[2]) for r in rows]
        return transaction(operation)

    def save_activity(cursor, data, user, activity_id=None):
        payload = data.model_dump(mode='json', exclude={'revision'})
        if activity_id:
            row = cursor.execute('SELECT Revision FROM dbo.PreventiveActivities WITH (UPDLOCK,HOLDLOCK) WHERE ActivityId=?', activity_id).fetchone()
            if not row:
                raise HTTPException(404, 'Actividad no encontrada')
            if row[0] != data.revision:
                raise HTTPException(409, 'La actividad cambió. Recarga antes de editar.')
            cursor.execute('UPDATE dbo.PreventiveActivities SET Data=?,Revision=Revision+1,UpdatedBy=?,UpdatedAt=? WHERE ActivityId=?', dump(payload), user, now(), activity_id)
        else:
            activity_id = cursor.execute('SET NOCOUNT ON; INSERT INTO dbo.PreventiveActivities(Data,UpdatedBy,UpdatedAt) VALUES(?,?,?); SELECT CAST(SCOPE_IDENTITY() AS INT)', dump(payload), user, now()).fetchone()[0]
        return {'id': activity_id}

    @app.post('/preventivos/actividades')
    def create_activity(data: ActivityWrite, usuario_id: int = Depends(admin_user)):
        return transaction(lambda cursor: save_activity(cursor, data, usuario_id))

    @app.put('/preventivos/actividades/{activity_id}')
    def update_activity(activity_id: int, data: ActivityWrite, usuario_id: int = Depends(admin_user)):
        return transaction(lambda cursor: save_activity(cursor, data, usuario_id, activity_id))

    def save_plan(cursor, data, user, plan_id=None):
        activity = cursor.execute('SELECT Data FROM dbo.PreventiveActivities WITH (HOLDLOCK) WHERE ActivityId=?', data.activity_id).fetchone()
        if not activity or (data.active and not json.loads(activity[0])['active']):
            raise HTTPException(422, 'Selecciona una actividad activa')
        machine = cursor.execute('SELECT Status FROM dbo.Machines WHERE MachineId=?', data.machine_id).fetchone()
        if not machine or (data.active and machine[0] == 'FUERA_SERVICIO'):
            raise HTTPException(422, 'Selecciona una máquina activa')
        if data.element_id:
            element = cursor.execute('SELECT MachineId,Active FROM dbo.MachineElements WHERE ElementId=?', data.element_id).fetchone()
            if not element or element[0] != data.machine_id or (data.active and not element[1]):
                raise HTTPException(422, 'Selecciona un elemento activo de esa máquina')
        if json.loads(activity[0])['kind'] == 'ENGRASE' and not data.points:
            raise HTTPException(422, 'Agrega los puntos de engrase con su identificación')
        payload = data.model_dump(mode='json', exclude={'revision'})
        if plan_id:
            old = cursor.execute('SELECT Data,Revision FROM dbo.PreventivePlans WITH (UPDLOCK,HOLDLOCK) WHERE PlanId=?', plan_id).fetchone()
            if not old:
                raise HTTPException(404, 'Plan no encontrado')
            if old[1] != data.revision:
                raise HTTPException(409, 'El plan cambió. Recarga antes de editar.')
            original = json.loads(old[0])
            for key in ('first_due', 'activity_id', 'machine_id', 'element_id'):
                if payload[key] != original[key]:
                    raise HTTPException(422, 'Para cambiar el activo, actividad o fecha base, desactiva este plan y crea otro; se conserva el historial')
            cursor.execute('UPDATE dbo.PreventivePlans SET Data=?,Revision=Revision+1,UpdatedBy=?,UpdatedAt=? WHERE PlanId=?', dump(payload), user, now(), plan_id)
        else:
            plan_id = cursor.execute('SET NOCOUNT ON; INSERT INTO dbo.PreventivePlans(ActivityId,MachineId,ElementId,Data,NextDue,UpdatedBy,UpdatedAt) VALUES(?,?,?,?,?,?,?); SELECT CAST(SCOPE_IDENTITY() AS INT)', data.activity_id, data.machine_id, data.element_id, dump(payload), data.first_due, user, now()).fetchone()[0]
        return {'id': plan_id}

    @app.post('/preventivos/planes')
    def create_plan(data: PlanWrite, usuario_id: int = Depends(admin_user)):
        return transaction(lambda cursor: save_plan(cursor, data, usuario_id))

    @app.put('/preventivos/planes/{plan_id}')
    def update_plan(plan_id: int, data: PlanWrite, usuario_id: int = Depends(admin_user)):
        return transaction(lambda cursor: save_plan(cursor, data, usuario_id, plan_id))

    def due(cursor, week):
        cat = catalogs(cursor)
        acts = {a['id']: a for a in cat['activities']}
        rows = []
        for p in cat['plans']:
            a = acts[p['activity_id']]
            if not p['active'] or not a['active']:
                continue
            # Mantener el vencimiento sin generar nuevas alertas mientras exista trabajo abierto.
            if cursor.execute("SELECT TOP 1 o.OccurrenceId FROM dbo.PreventiveOccurrences o JOIN dbo.MaintenanceRequests r ON r.RequestId=o.RequestId WHERE o.PlanId=? AND r.Status<>'CERRADA'", p['id']).fetchone():
                continue
            for cycle in due_cycles(p, a, week):
                rows.append(dict(plan=p, activity=a, **cycle))
        return rows

    @app.get('/preventivos/proximos')
    def upcoming(week: date, usuario_id: int = Depends(admin_user)):
        return transaction(lambda cursor: due(cursor, week))

    @app.post('/preventivos/publicar')
    def publish(data: PublishWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            week_open(cursor, data.week)
            # Orden estable de bloqueo; generación repetida no duplica ocurrencias.
            selected = sorted(set(data.plan_ids))
            for plan_id in selected:
                cursor.execute('SELECT PlanId FROM dbo.PreventivePlans WITH (UPDLOCK,HOLDLOCK) WHERE PlanId=?', plan_id).fetchone()
            candidates = [x for x in due(cursor, data.week) if x['plan']['id'] in selected]
            actor = stamp(cursor, usuario_id)
            generated = []
            for entry in candidates:
                p, a = entry['plan'], entry['activity']
                machine = cursor.execute('''SELECT m.AssetCode,m.Name,t.PlantId,m.TowerId,p.Name,t.Name,m.Status
                    FROM dbo.Machines m LEFT JOIN dbo.Towers t ON t.TowerId=m.TowerId
                    LEFT JOIN dbo.Plants p ON p.PlantId=t.PlantId WHERE m.MachineId=?''', p['machine_id']).fetchone()
                if not machine or machine[6] == 'FUERA_SERVICIO':
                    raise HTTPException(422, 'Hay una máquina inactiva en los planes seleccionados')
                element_name = ''
                if p['element_id']:
                    element = cursor.execute('SELECT Name,Active,MachineId FROM dbo.MachineElements WHERE ElementId=?', p['element_id']).fetchone()
                    if not element or not element[1] or element[2] != p['machine_id']:
                        raise HTTPException(422, 'Un elemento del plan fue desactivado o cambió de máquina')
                    element_name = element[0]
                starts = datetime.combine(date.fromisoformat(entry['scheduled']), time.fromisoformat(p['start_time']))
                plan = dict(assignment_type=a['group'], assigned_user_id=None, contractor_id=None,
                            responsible=ASSIGNMENT_GROUPS[a['group']][0], responsible_role=a['group'], starts_at=starts.isoformat(),
                            ends_at=(starts+timedelta(minutes=a['duration_minutes'])).isoformat(),
                            estimated_duration_days=a['duration_minutes']//1440, estimated_duration_minutes=a['duration_minutes']%1440,
                            resources='N/A', permits='N/A', window='Requiere parada' if a['requires_shutdown'] else 'N/A',
                            condition='ESPERA_VENTANA' if a['requires_shutdown'] else 'LISTA', notes='Generado desde plan preventivo aprobado',
                            requested_parts=[], review_required=True, **actor)
                points = p['points'] or [dict(name=element_name or machine[1])]
                items = [dict(**point, key=str(i+1), status='PENDIENTE', notes='') for i, point in enumerate(points)]
                validation = dict(factors=a['factors'], justification='Aprobación de actividad preventiva al publicar', technical_review=None, **actor)
                payload = dict(machine_id=p['machine_id'], machine_name=machine[1], machine_code=machine[0], plant_id=machine[2], tower_id=machine[3],
                               plant_name=machine[4], tower_name=machine[5], maintenance_type='PREVENTIVO', description=a['name'],
                               failure=False, equipment_stopped=False, hour_meter=None, requested_parts=[], priority_revision=1,
                               requested_at=now().isoformat(), priority_validation=validation, priority_history=[validation], planning=plan, planning_history=[plan],
                               preventive=dict(plan_id=p['id'], activity_id=a['id'], activity_revision=a['revision'], plan_revision=p['revision'],
                                               due=entry['due'], skipped_cycles=entry['skipped'], route=p['route'], element_id=p['element_id'], element_name=element_name,
                                               procedure=a['procedure'], reference=a['reference'], crew_size=a['crew_size'], items=items, participants=[], revision=0))
                request_id = cursor.execute('SET NOCOUNT ON; INSERT INTO dbo.MaintenanceRequests(MachineId,RequestedBy,RequestedAt,RequestData) VALUES(?,?,?,?); SELECT CAST(SCOPE_IDENTITY() AS INT)', p['machine_id'], usuario_id, now(), dump(payload)).fetchone()[0]
                cursor.execute('INSERT INTO dbo.PreventiveOccurrences(PlanId,DueDate,RequestId) VALUES(?,?,?)', p['id'], date.fromisoformat(entry['due']), request_id)
                cursor.execute('INSERT INTO dbo.PreventiveSchedule(RequestId,ScheduledDate,CreatedBy,CreatedAt) VALUES(?,?,?,?)', request_id, date.fromisoformat(entry['scheduled']), usuario_id, now())
                cursor.execute('UPDATE dbo.PreventivePlans SET NextDue=?,Revision=Revision+1 WHERE PlanId=?', date.fromisoformat(entry['next_due']), p['id'])
                generated.append(request_id)
            return dict(request_ids=generated)
        return transaction(operation)

    @app.put('/preventivos/solicitudes/{request_id}/checklist')
    def save_checklist(request_id: int, data: ChecklistWrite, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            staff(cursor, usuario_id)
            row = cursor.execute('SELECT Status,AssignedTo,RequestData FROM dbo.MaintenanceRequests WITH (UPDLOCK,HOLDLOCK) WHERE RequestId=?', request_id).fetchone()
            if not row or row[0] != 'EN_PROCESO' or row[1] != usuario_id:
                raise HTTPException(409, 'Solo el ejecutor puede registrar el checklist de un trabajo en proceso')
            original = json.loads(row[2])
            preventive = original.get('preventive')
            if not preventive or preventive['revision'] != data.revision:
                raise HTTPException(409, 'El checklist cambió. Recarga antes de guardar.')
            values = {i.key: i for i in data.items}
            if len(values) != len(data.items) or set(values) != {i['key'] for i in preventive['items']}:
                raise HTTPException(422, 'Conserva todos los puntos originales del checklist')
            if len({p.user_id for p in data.participants}) != len(data.participants):
                raise HTTPException(422, 'No repitas participantes')
            participants = []
            for person in data.participants:
                staff(cursor, person.user_id)
                participants.append(person.model_dump() | dict(name=stamp(cursor, person.user_id)['name']))
            actor = stamp(cursor, usuario_id)
            for item in preventive['items']:
                result = values[item['key']].model_dump(exclude={'key'})
                if any(item.get(k) != v for k, v in result.items()):
                    item.update(result, recorded_by=usuario_id, recorded_at=actor['at'])
            preventive['participants'] = participants
            preventive['revision'] += 1
            cursor.execute('UPDATE dbo.MaintenanceRequests SET RequestData=? WHERE RequestId=?', dump(original), request_id)
            return dict(id=request_id)
        return transaction(operation)

    @app.post('/preventivos/solicitudes/{request_id}/reprogramar')
    def reschedule(request_id: int, data: RescheduleWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            week_open(cursor, data.scheduled_date)
            row = cursor.execute('SELECT Status,RequestData FROM dbo.MaintenanceRequests WITH (UPDLOCK,HOLDLOCK) WHERE RequestId=?', request_id).fetchone()
            if not row or row[0] != 'PENDIENTE':
                raise HTTPException(409, 'Solo se reprograman actividades pendientes de iniciar')
            original = json.loads(row[1])
            if not original.get('preventive'):
                raise HTTPException(422, 'La solicitud no proviene de un plan preventivo')
            old = cursor.execute('SELECT ScheduleId,ScheduledDate FROM dbo.PreventiveSchedule WITH (UPDLOCK,HOLDLOCK) WHERE RequestId=? AND Moved=0', request_id).fetchone()
            if not old or old[1] == data.scheduled_date:
                raise HTTPException(422, 'Selecciona una fecha diferente')
            cursor.execute('UPDATE dbo.PreventiveSchedule SET Moved=1,Reason=? WHERE ScheduleId=?', data.reason, old[0])
            cursor.execute('INSERT INTO dbo.PreventiveSchedule(RequestId,ScheduledDate,CreatedBy,CreatedAt) VALUES(?,?,?,?)', request_id, data.scheduled_date, usuario_id, now())
            plan = dict(original['planning'])
            starts = datetime.combine(data.scheduled_date, datetime.fromisoformat(plan['starts_at']).time())
            duration = plan['estimated_duration_days']*1440 + plan['estimated_duration_minutes']
            plan.update(starts_at=starts.isoformat(), ends_at=(starts+timedelta(minutes=duration)).isoformat(), notes=data.reason, **stamp(cursor, usuario_id))
            original['planning'] = plan
            original.setdefault('planning_history', []).append(plan)
            original['priority_revision'] += 1
            cursor.execute('UPDATE dbo.MaintenanceRequests SET RequestData=? WHERE RequestId=?', dump(original), request_id)
            return dict(id=request_id)
        return transaction(operation)

    def report(cursor, week):
        start = monday(week)
        end = start + timedelta(days=7)
        closure = cursor.execute('SELECT Snapshot FROM dbo.PreventiveWeekClosures WHERE WeekStart=?', start).fetchone()
        if closure:
            return json.loads(closure[0])
        rows = cursor.execute('''SELECT s.ScheduleId,s.ScheduledDate,s.Moved,s.Reason,r.RequestId,r.Status,r.RequestData,r.ExecutionData,r.CompletedAt,
            COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.Nombres,' ',u.Apellidos))),''),u.Nombre)
            FROM dbo.PreventiveSchedule s JOIN dbo.MaintenanceRequests r ON r.RequestId=s.RequestId
            LEFT JOIN dbo.Usuarios u ON u.Id=r.AssignedTo WHERE s.ScheduledDate>=? AND s.ScheduledDate<? ORDER BY s.ScheduledDate,s.ScheduleId''', start, end).fetchall()
        entries = []
        def entry(request_id, status, raw, execution, completed, assigned, scheduled, moved=False, reason='', key=None):
            data = json.loads(raw)
            plan = data.get('planning') or {}
            prev = data.get('preventive') or {}
            items = prev.get('items', [])
            result = json.loads(execution) if execution else {}
            return dict(key=key or f'request-{request_id}', request_id=request_id, status=item_status(status, data, moved), request_status=status,
                        moved=bool(moved), scheduled=scheduled.isoformat(), completed_at=completed.isoformat() if completed else None,
                        machine=data.get('machine_name',''), machine_id=data.get('machine_id'), plant=data.get('plant_name',''), tower=data.get('tower_name',''),
                        element=prev.get('element_name',''), activity=data.get('description',''), route=prev.get('route',''),
                        origin='MT/02-01' if prev else 'MT/02-08' if data.get('maintenance_type')=='MEJORA_TECNICA' else 'MT/02-05',
                        kind=data.get('maintenance_type',''), group=plan.get('assignment_type',''), assignee=assigned or '',
                        crew_size=prev.get('crew_size',1), minutes=plan.get('estimated_duration_days',0)*1440+plan.get('estimated_duration_minutes',0),
                        real_minutes=result.get('repair_duration_minutes'), human_minutes=sum(p['minutes'] for p in prev.get('participants',[])),
                        priority=priority(data['priority_validation']['factors'])['level'] if data.get('priority_validation') else 'SIN_VALIDAR',
                        notes=reason or result.get('work_done',''), items=items, participants=prev.get('participants',[]),
                        validated=bool(data.get('admin_review')), reviewer=data.get('admin_review'), preventive=bool(prev))
        for r in rows:
            entries.append(entry(r[4],r[5],r[6],r[7],r[8],r[9],r[1],r[2],r[3],f'schedule-{r[0]}'))
        # Emergentes y programación manual: lectura del mismo origen de datos, sin duplicar órdenes.
        others = cursor.execute("SELECT r.RequestId,r.Status,r.RequestData,r.ExecutionData,r.CompletedAt,COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.Nombres,' ',u.Apellidos))),''),u.Nombre),r.RequestedAt FROM dbo.MaintenanceRequests r LEFT JOIN dbo.Usuarios u ON u.Id=r.AssignedTo WHERE NOT EXISTS(SELECT 1 FROM dbo.PreventiveOccurrences o WHERE o.RequestId=r.RequestId)").fetchall()
        for r in others:
            raw = json.loads(r[2]); planned = (raw.get('planning') or {}).get('starts_at')
            scheduled = datetime.fromisoformat(planned).date() if planned else r[6].date()
            if start <= scheduled < end:
                entries.append(entry(*r[:6],scheduled))
        program = [e for e in entries if e['preventive']]
        # Misma orden reprogramada dentro de la semana: una sola actividad en el indicador.
        unique = {}
        for e in program:
            if e['request_id'] not in unique or not e['moved']:
                unique[e['request_id']] = e
        executed = sum(e['status']=='EJECUTADO' and e['completed_at'] is not None and datetime.fromisoformat(e['completed_at']).date()<end for e in unique.values())
        return dict(week=start.isoformat(), end=(end-timedelta(days=1)).isoformat(), closed=False, entries=entries,
                    summary=dict(programmed=len(unique), executed=executed, percent=round(executed*100/len(unique),2) if unique else None))

    @app.get('/preventivos/semana')
    def week_report(week: date, usuario_id: int = Depends(active_user)):
        def operation(cursor):
            staff(cursor, usuario_id)
            return report(cursor, week)
        return transaction(operation)

    @app.post('/preventivos/cerrar-semana')
    def close_week(data: WeekWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            week_open(cursor, data.week)
            if monday(data.week)+timedelta(days=6) > now().date():
                raise HTTPException(422, 'El cierre está disponible desde el domingo de la semana seleccionada')
            snapshot = report(cursor, data.week)
            snapshot.update(closed=True, closure=stamp(cursor, usuario_id))
            cursor.execute('INSERT INTO dbo.PreventiveWeekClosures(WeekStart,Snapshot,ClosedBy,ClosedAt) VALUES(?,?,?,?)', monday(data.week), dump(snapshot), usuario_id, now())
            return snapshot
        return transaction(operation)

    @app.get('/preventivos/semana.xlsx')
    def excel(week: date, usuario_id: int = Depends(active_user)):
        from preventive_export import workbook
        data = week_report(week, usuario_id)
        return Response(workbook(data), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': f'attachment; filename="MT_02-03_{monday(week)}.xlsx"'})
