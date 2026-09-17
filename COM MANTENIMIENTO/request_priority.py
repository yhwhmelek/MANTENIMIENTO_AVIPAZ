"""Reglas NIC del procedimiento de priorizacion, version 00, 16/09/2026."""
import json
from datetime import datetime
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class PlanningWrite(StrictModel):
    responsible: str = Field(min_length=1, max_length=150)
    resources: str = Field(min_length=1, max_length=1000)
    permits: str = Field(min_length=1, max_length=1000)
    window: str = Field(min_length=1, max_length=1000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    condition: Literal['LISTA', 'ESPERA_REPUESTOS', 'ESPERA_RECURSOS', 'ESPERA_VENTANA', 'ESPERA_PERMISOS']
    notes: str = Field(default='', max_length=1000)
    expected_revision: int = Field(ge=0)

    @model_validator(mode='after')
    def dates(self):
        if (self.starts_at is None) != (self.ends_at is None):
            raise ValueError('Completa ambas fechas de programacion')
        if self.starts_at and (self.starts_at.tzinfo or self.ends_at.tzinfo or self.ends_at <= self.starts_at):
            raise ValueError('Usa horas locales; el fin debe ser posterior al inicio')
        if self.condition == 'LISTA' and self.starts_at is None:
            raise ValueError('Indica la ventana de fechas para ejecutar la actividad')
        if self.condition != 'LISTA' and not self.notes:
            raise ValueError('Describe la condicion pendiente de programacion')
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
        return (4, 0, 0, 0, str(row['requested_at']), row['id'])
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
        return data

    def stamp(cursor, user):
        person = cursor.execute("SELECT COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(Nombres, ' ', Apellidos))), ''), Nombre) FROM dbo.Usuarios WHERE Id=?", user).fetchone()
        return dict(by=user, name=person[0] if person else str(user), at=now().isoformat())

    @app.post('/solicitudes-mantenimiento/{request_id}/evaluar')
    def evaluate(request_id: int, data: ValidationWrite, usuario_id: int = Depends(admin_user)):
        def operation(cursor):
            original = load(cursor, request_id, data.expected_revision)
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
            original = load(cursor, request_id, data.expected_revision)
            require_validated(original)
            planning = data.model_dump(mode='json', exclude={'expected_revision'}) | stamp(cursor, usuario_id)
            original.setdefault('planning_history', []).append(planning)
            original['planning'] = planning
            original['priority_revision'] = data.expected_revision + 1
            persist(cursor, request_id, original)
            return {'id': request_id}
        return write(operation)
