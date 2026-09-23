"""Reglas NIC del procedimiento de priorizacion, version 00, 16/09/2026."""
import json
from datetime import datetime, timedelta
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from decimal import Decimal


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class NIC(StrictModel):
    n: int = Field(ge=1, le=4, strict=True)
    i: int = Field(ge=1, le=4, strict=True)
    c: int = Field(ge=1, le=4, strict=True)


class TechnicalCheck(StrictModel):
    answer: Literal['SI', 'NO', 'NA']
    notes: str = Field(default='', max_length=500)


class ImprovementReview(StrictModel):
    shutdown: TechnicalCheck
    materials: TechnicalCheck
    modification: TechnicalCheck
    training: TechnicalCheck
    safety: TechnicalCheck
    feasibility: Literal['PROCEDE', 'CON_MODIFICACIONES', 'ANALISIS_ADICIONAL', 'NO_PROCEDE']


class ValidationWrite(StrictModel):
    factors: NIC
    justification: str = Field(min_length=1, max_length=2000)
    technical_review: ImprovementReview | None = None
    expected_revision: int = Field(ge=0)


class PlannedSparePart(StrictModel):
    machine_spare_part_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0, max_digits=10, decimal_places=2)


class PlanningWrite(StrictModel):
    assignment_type: Literal['USER', 'CONTRACTOR'] = 'USER'
    assigned_user_id: int | None = Field(default=None, gt=0)
    contractor_id: int | None = Field(default=None, gt=0)
    responsible: str = Field(default='', max_length=150)
    resources: str = Field(default='N/A', min_length=1, max_length=1000)
    permits: str = Field(default='N/A', min_length=1, max_length=1000)
    window: str = Field(default='N/A', min_length=1, max_length=1000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    estimated_duration_days: int = Field(default=0, ge=0, le=3650)
    estimated_duration_minutes: int = Field(default=0, ge=0, le=1439)
    condition: Literal['LISTA', 'ESPERA_REPUESTOS', 'ESPERA_RECURSOS', 'ESPERA_VENTANA', 'ESPERA_PERMISOS']
    notes: str = Field(default='N/A', max_length=1000)
    requested_parts: list[PlannedSparePart] = Field(default_factory=list, max_length=30)
    expected_revision: int = Field(ge=0)

    @field_validator('resources', 'permits', 'window', 'notes', mode='before')
    @classmethod
    def optional_text(cls, value):
        return value if isinstance(value, str) and value.strip() else 'N/A'

    @model_validator(mode='after')
    def dates(self):
        if self.assignment_type == 'USER' and (self.assigned_user_id is None or self.contractor_id is not None):
            raise ValueError('Selecciona un usuario mecánico o eléctrico')
        if self.assignment_type == 'CONTRACTOR' and (self.contractor_id is None or self.assigned_user_id is not None):
            raise ValueError('Selecciona un contratista')
        if self.starts_at and self.starts_at.tzinfo:
            raise ValueError('Usa la fecha y hora local de Ecuador')
        duration = self.estimated_duration_days * 1440 + self.estimated_duration_minutes
        if self.starts_at and duration:
            self.ends_at = self.starts_at + timedelta(minutes=duration)
        elif self.starts_at and self.ends_at:  # Compatibilidad con programaciones anteriores.
            if self.ends_at.tzinfo or self.ends_at <= self.starts_at:
                raise ValueError('El fin debe ser posterior al inicio')
            duration = int((self.ends_at-self.starts_at).total_seconds()/60)
            self.estimated_duration_days, self.estimated_duration_minutes = divmod(duration, 1440)
        elif self.starts_at:
            raise ValueError('Indica el tiempo estimado en dias y minutos')
        elif self.ends_at or duration:
            raise ValueError('Indica la fecha de inicio de la actividad')
        if self.condition == 'LISTA' and self.starts_at is None:
            raise ValueError('Indica la fecha de inicio y el tiempo estimado')
        if len({part.machine_spare_part_id for part in self.requested_parts}) != len(self.requested_parts):
            raise ValueError('Selecciona cada repuesto una sola vez')
        return self


def priority(factors):
    factors = NIC.model_validate(factors)
    score = factors.n * factors.i * factors.c
    base = 'CRITICO' if score >= 48 else 'ALTO' if score >= 24 else 'MEDIO' if score >= 12 else 'BAJO'
    final = 'ALTO' if factors.c == 4 and base in ('BAJO', 'MEDIO') else base
    return dict(score=score, base=base, level=final, escalated=final != base)


def decorate(row):
    data = row['request_data']
    validation = data.get('priority_validation')
    row['priority'] = priority(validation['factors']) if validation else None
    return row


def backlog_key(row):
    validation = row['request_data'].get('priority_validation')
    if not validation:
        return (-1, 0, 0, 0, str(row['requested_at']), row['id'])
    factors = validation['factors']
    level = priority(factors)['level']
    return ({'CRITICO':0, 'ALTO':1, 'MEDIO':2, 'BAJO':3}[level],
            -factors['c'], -factors['i'], -factors['n'], str(row['requested_at']), row['id'])


def require_validated(data):
    validation = data.get('priority_validation')
    if not validation:
        raise HTTPException(409, 'Mantenimiento debe validar N, I y C antes de ejecutar o entregar el trabajo')
    review = validation.get('technical_review')
    if data['maintenance_type'] == 'MEJORA_TECNICA' and (not review or review['feasibility'] not in ('PROCEDE', 'CON_MODIFICACIONES')):
        raise HTTPException(409, 'La mejora requiere una evaluacion tecnica favorable antes de ejecutarse')


def require_planned(data):
    require_validated(data)
    if data.get('planning', {}).get('condition') != 'LISTA':
        raise HTTPException(409, 'Registra la programacion y resuelve sus condiciones pendientes antes de ejecutar')


def register_priority(app, write, locked, admin_user, now):
    def persist(cursor, request_id, data):
        cursor.execute('UPDATE dbo.MaintenanceRequests SET RequestData=? WHERE RequestId=?',
                       json.dumps(data, ensure_ascii=False), request_id)

    def load(cursor, request_id, revision):
        row = locked(cursor, request_id)
        if row[2] not in ('PENDIENTE', 'EN_PROCESO'):
            raise HTTPException(409, 'La evaluacion y programacion quedan cerradas al entregar el trabajo')
        data = json.loads(row[3])
        if data.get('priority_revision', 0) != revision:
            raise HTTPException(409, 'Otro administrador actualizo la actividad. Recarga antes de guardar')
        return data, row

    def stamp(cursor, user):
        person = cursor.execute("SELECT COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(Nombres, ' ', Apellidos))), ''), Nombre) FROM dbo.Usuarios WHERE Id=?", user).fetchone()
        return dict(by=user, name=person[0] if person else str(user), at=now().isoformat())

    @app.post('/solicitudes-mantenimiento/{request_id}/evaluar')
    def evaluate(request_id: int, data: ValidationWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            original, _ = load(cursor, request_id, data.expected_revision)
            if original['maintenance_type'] == 'MEJORA_TECNICA' and data.technical_review is None:
                raise HTTPException(422, 'Completa la verificacion y viabilidad tecnica de la mejora')
            if original['maintenance_type'] != 'MEJORA_TECNICA' and data.technical_review is not None:
                raise HTTPException(422, 'La verificacion de mejoras solo corresponde a mejora tecnica')
            validation = data.model_dump(mode='json', exclude={'expected_revision'}) | stamp(cursor, usuario_id)
            original.setdefault('priority_history', []).append(validation)
            original['priority_validation'] = validation
            original['priority_revision'] = data.expected_revision + 1
            persist(cursor, request_id, original)
            return {'id': request_id, 'priority': priority(data.factors), 'revision': original['priority_revision']}
        return write(operation)

    @app.post('/solicitudes-mantenimiento/{request_id}/programar')
    def plan(request_id: int, data: PlanningWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            original, request_row = load(cursor, request_id, data.expected_revision)
            require_validated(original)
            planning = data.model_dump(mode='json', exclude={'expected_revision', 'requested_parts'})
            planning['review_required'] = True
            if data.assignment_type == 'USER':
                assigned = cursor.execute("SELECT COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(Nombres, ' ', Apellidos))), ''), Nombre), Rol FROM dbo.Usuarios WHERE Id=? AND Activo=1", data.assigned_user_id).fetchone()
                if not assigned or assigned[1] not in ('MECANICO', 'ELECTRICO'):
                    raise HTTPException(422, 'Selecciona un usuario activo con rol Mecánico o Eléctrico')
                planning['responsible'] = assigned[0]
                planning['responsible_role'] = assigned[1]
            else:
                contractor = cursor.execute('SELECT Name,Specialty FROM dbo.Contractors WHERE ContractorId=? AND Active=1', data.contractor_id).fetchone()
                if not contractor:
                    raise HTTPException(422, 'Selecciona un contratista activo')
                planning['responsible'] = contractor[0]
                planning['responsible_role'] = 'CONTRATISTA'
                planning['contractor_specialty'] = contractor[1]
            if request_row[2] == 'EN_PROCESO':
                raise HTTPException(409, 'No se puede cambiar el ejecutor después de iniciar el trabajo')
            if planning.get('starts_at') and planning.get('ends_at'):
                scheduled = cursor.execute("SELECT RequestId,RequestData FROM dbo.MaintenanceRequests WITH (HOLDLOCK) WHERE RequestId<>? AND Status IN ('PENDIENTE','EN_PROCESO')", request_id).fetchall()
                for other_id, raw in scheduled:
                    other = json.loads(raw)
                    other_plan = other.get('planning') or {}
                    if str(other.get('plant_id')) != str(original.get('plant_id')):
                        continue
                    same_responsible = (
                        planning['assignment_type'] == (other_plan.get('assignment_type') or 'USER') and
                        ((planning['assignment_type'] == 'USER' and planning.get('assigned_user_id') == other_plan.get('assigned_user_id')) or
                         (planning['assignment_type'] == 'CONTRACTOR' and planning.get('contractor_id') == other_plan.get('contractor_id')))
                    )
                    if not same_responsible or not other_plan.get('starts_at') or not other_plan.get('ends_at'):
                        continue
                    other_start, other_end = datetime.fromisoformat(other_plan['starts_at']), datetime.fromisoformat(other_plan['ends_at'])
                    if data.starts_at < other_end and data.ends_at > other_start:
                        raise HTTPException(409, f'El responsable ya tiene la solicitud #{other_id} en ese horario dentro de la planta')
            planning['requested_parts'] = []
            selected_spare_ids = set()
            for selected in data.requested_parts:
                part = cursor.execute('''SELECT m.MachineSparePartId, m.MachineId, m.ElementId, m.SparePartId,
                    s.InternalCode, s.Description, s.UnitOfMeasure,
                    a.AssetCode, a.Name, e.ElementCode, e.Name
                    FROM dbo.MachineSpareParts m JOIN dbo.SpareParts s ON s.SparePartId=m.SparePartId
                    JOIN dbo.Machines a ON a.MachineId=m.MachineId
                    LEFT JOIN dbo.MachineElements e ON e.ElementId=m.ElementId AND e.MachineId=m.MachineId
                    WHERE m.MachineSparePartId=? AND m.Active=1 AND s.Active=1''', selected.machine_spare_part_id).fetchone()
                if not part:
                    raise HTTPException(422, 'Uno de los repuestos seleccionados ya no está asignado o activo')
                if part[3] in selected_spare_ids:
                    raise HTTPException(422, 'Selecciona cada repuesto una sola vez y agrupa su cantidad')
                selected_spare_ids.add(part[3])
                planning['requested_parts'].append(dict(machine_spare_part_id=part[0], machine_id=part[1], element_id=part[2],
                    spare_part_id=part[3], internal_code=part[4], description=part[5], unit_of_measure=part[6],
                    machine_code=part[7], machine_name=part[8], element_code=part[9], element_name=part[10],
                    quantity=str(selected.quantity)))
            planning |= stamp(cursor, usuario_id)
            original.setdefault('planning_history', []).append(planning)
            original['planning'] = planning
            original['priority_revision'] = data.expected_revision + 1
            persist(cursor, request_id, original)
            return {'id': request_id}
        return write(operation)
