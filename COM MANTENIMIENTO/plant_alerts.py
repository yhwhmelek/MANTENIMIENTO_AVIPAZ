"""Plant routing for maintenance notifications, independent of historical access."""

TECHNICAL_ROLES = ('MECANICO', 'ELECTRICO', 'TECNICO')


def request_in_plant(row, plant_id):
    if plant_id is None:
        return False
    data = row['request_data']
    coverage = (data.get('preventive') or {}).get('machines') or []
    if coverage:
        return any(machine.get('plant_id') == plant_id for machine in coverage)
    return (data.get('plant_id') or row.get('machine_plant_id')) == plant_id


def route_request_alerts(rows, role, plant_id):
    for row in rows:
        row['alert_in_plant'] = role not in TECHNICAL_ROLES or request_in_plant(row, plant_id)
        row['alert_plant_id'] = plant_id if role in TECHNICAL_ROLES else None
    return rows


def filter_hour_alerts(entries, role, plant_id, machine_plants, assignment_groups):
    result = []
    for entry in entries:
        if role != 'ADMIN' and role not in assignment_groups[entry['group']][1]:
            continue
        machines = [m for m in entry['machines']
                    if m['state'] in ('PROXIMO', 'VENCIDO') and
                    (role == 'ADMIN' or (plant_id is not None and machine_plants.get(m['machine_id']) == plant_id))]
        if machines:
            result.append(dict(entry, machines=machines))
    return result
