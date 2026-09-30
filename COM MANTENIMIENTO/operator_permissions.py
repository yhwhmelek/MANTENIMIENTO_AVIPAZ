"""Restricciones del operador, aplicadas también al acceso directo a la API."""
from copy import deepcopy

from fastapi import HTTPException


OPERATOR_ROUTES = {
    ('GET', '/auth/me'),
    ('PATCH', '/auth/me'),
    ('PATCH', '/auth/me/password'),
    ('GET', '/maquinas'),
    ('GET', '/plantas'),
    ('GET', '/torres'),
    ('GET', '/solicitudes-mantenimiento'),
    ('POST', '/solicitudes-mantenimiento'),
    ('POST', '/solicitudes-mantenimiento/{request_id}/recibir'),
    ('GET', '/solicitudes-mantenimiento/{request_id}/imagen'),
    ('GET', '/solicitudes-mantenimiento/{request_id}/imagenes/{index}'),
    ('GET', '/solicitudes-mantenimiento/{request_id}/trabajo-imagenes/{index}'),
}


def authorize_operator(request, cursor, user_id):
    route = request.scope['route'].path
    if (request.method, route) not in OPERATOR_ROUTES:
        raise HTTPException(403, 'El operador solo puede generar y consultar sus solicitudes y confirmar su recepción')
    request_id = request.path_params.get('request_id')
    if request_id is not None:
        owner = cursor.execute(
            'SELECT RequestedBy FROM dbo.MaintenanceRequests WHERE RequestId=?', request_id
        ).fetchone()
        if not owner or owner[0] != user_id:
            raise HTTPException(403, 'Solo puedes acceder a tus propias solicitudes')


def operator_request(row):
    """No entregar información de materiales ni existencias en listados/PDF."""
    result = deepcopy(row)
    data = result['request_data']
    for key in ('requested_part_id', 'requested_quantity', 'requested_part_code',
                'requested_part_name', 'stock_at_request', 'stock_sufficient'):
        data.pop(key, None)
    data['requested_parts'] = []
    # La programación e historiales pueden contener repuestos y saldos anteriores.
    plan = data.get('planning')
    if plan:
        data['planning'] = {key: plan[key] for key in (
            'responsible', 'starts_at', 'ends_at', 'estimated_duration_days',
            'estimated_duration_minutes', 'condition', 'review_required'
        ) if key in plan}
    for key in list(data):
        if 'history' in key:
            data.pop(key)
    execution = result.get('execution_data')
    if execution:
        execution['parts'] = []
        execution['tools'] = []
        execution.pop('other_materials', None)
    return result
