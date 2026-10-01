"""Exportación OOXML sin dependencias adicionales ni fórmulas provenientes de usuarios."""
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
from datetime import date, timedelta


def column(index):
    result = ''
    while index:
        index, digit = divmod(index-1, 26)
        result = chr(65+digit)+result
    return result


def workbook(report):
    rows = [
        ['PROGRAMACIÓN Y REGISTRO SEMANAL DE MANTENIMIENTO', 'MT/02-03', 'Formato digital'],
        ['Desde', report['week'], 'Hasta', report['end'], 'Cerrado' if report['closed'] else 'En seguimiento'],
        ['Preventivos programados', report['summary']['programmed'], 'Ejecutados validados', report['summary']['executed'], '%', report['summary']['percent'] if report['summary']['percent'] is not None else 'N/A'],
        ['Ítem','Origen','Planta / Torre','Máquina / Elemento','Actividad / Ruta','Tipo','Prioridad','Personas previstas','Horas previstas','Horas hombre previstas','Grupo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo','Estado','Ejecutor','Verificación','Observaciones'],
    ]
    marks = {'EJECUTADO':'✓','PENDIENTE':'P','REPROGRAMADO':'R','EN_PROCESO':'En curso','PARCIAL':'Parcial','NO_REALIZADO':'No realizado','POR_VALIDAR':'Por validar'}
    details = [['Solicitud','Máquina','Elemento','Punto','Rodamiento','Chumacera','Lubricante','Dosis','Estado','Observaciones']]
    coverage = [['Solicitud','Actividad general','Código','Máquina incluida','Planta','Torre']]
    for i, item in enumerate(report['entries'], 1):
        day = date.fromisoformat(item['scheduled']).weekday()
        days = ['']*7
        days[day] = marks.get(item['status'], item['status'])
        note = item['notes']
        if item['completed_at']:
            note += ' | Fin real: '+item['completed_at']
        rows.append([i,item['origin'],' / '.join(filter(None,[item['plant'],item['tower']])),
                     ' / '.join(filter(None,[item['machine'],item['element']])),
                     ' / '.join(filter(None,[item['activity'],item['route']])),item['kind'],item['priority'],item['crew_size'],
                     item['minutes']/60,item['minutes']*item['crew_size']/60,item['group'],*days,item['status'],item['assignee'],
                     (item.get('reviewer') or {}).get('name','Pendiente'),note])
        for p in item['items']:
            details.append([item['request_id'],item['machine'],item['element'],p['name'],p.get('bearing_code',''),p.get('housing_code',''),p.get('lubricant',''),p.get('dose',''),p['status'],p['notes']])
        for machine in item.get('machines', []):
            coverage.append([item['request_id'],item['activity'],machine['code'],machine['name'],machine['plant'],machine['tower']])
    if report.get('closure'):
        rows.append(['Cierre verificado por', report['closure']['name'],report['closure']['at']])
    out = BytesIO()
    with ZipFile(out, 'w', ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="MT-02-03 Semana" sheetId="1" r:id="rId1"/><sheet name="Detalle de puntos" sheetId="2" r:id="rId2"/><sheet name="Maquinas incluidas" sheetId="3" r:id="rId3"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in (1,2,3))+'</Relationships>')
        for index, table in enumerate((rows, details, coverage),1):
            xml = ['<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="22" width="18" customWidth="1"/><col min="4" max="5" width="35" customWidth="1"/></cols><sheetData>']
            for r, values in enumerate(table,1):
                xml.append(f'<row r="{r}">')
                for c, value in enumerate(values,1):
                    ref = f'{column(c)}{r}'
                    if isinstance(value,(int,float)):
                        xml.append(f'<c r="{ref}"><v>{value}</v></c>')
                    else:
                        clean = ''.join(ch for ch in str(value or '') if ord(ch)>=32 or ch in '\n\r\t')
                        xml.append(f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(clean)}</t></is></c>')
                xml.append('</row>')
            xml.append('</sheetData><pageMargins left="0.2" right="0.2" top="0.3" bottom="0.3" header="0.1" footer="0.1"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>')
            z.writestr(f'xl/worksheets/sheet{index}.xml',''.join(xml))
    return out.getvalue()
