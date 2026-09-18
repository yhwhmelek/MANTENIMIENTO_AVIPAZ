"""Extract the 29 MT/02-08 forms into an app import fixture (stdlib only).

Usage: python import_santafe_haccp.py source.xlsx ../src/santafe-haccp-2026.json
"""
import json
import posixpath
import re
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
DRAWING_NS = {'x': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
              'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
REL_NS = '{http://schemas.openxmlformats.org/package/2006/relationships}'
OFFICE_REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def extract(source):
    with zipfile.ZipFile(source) as archive:
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            shared = [''.join(si.itertext()) for si in root]
        result = []
        sheets = sorted((name for name in archive.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', name)),
                        key=lambda name: int(re.search(r'sheet(\d+)', name).group(1)))
        for number, name in enumerate(sheets, 1):
            root = ET.fromstring(archive.read(name))
            cells = {}
            for cell in root.findall('.//x:sheetData/x:row/x:c', NS):
                value = cell.find('x:v', NS)
                inline = cell.find('x:is', NS)
                if value is not None:
                    cells[cell.attrib['r']] = shared[int(value.text)] if cell.attrib.get('t') == 's' else value.text
                elif inline is not None:
                    cells[cell.attrib['r']] = ''.join(inline.itertext())
            def after(ref):
                return re.split(r':', cells.get(ref, ''), maxsplit=1)[-1].strip()
            stamp = datetime.strptime(after('E4'), '%d/%m/%Y')
            hour = re.search(r'(\d{1,2}):(\d{2})\s*(am|pm)', cells.get('H4', ''), re.I)
            if hour:
                h = int(hour.group(1)) % 12 + (12 if hour.group(3).lower() == 'pm' else 0)
                stamp = stamp.replace(hour=h, minute=int(hour.group(2)))
            checks = ['affects_food_safety', 'requires_shutdown', 'requires_training', 'improves_safety']
            evaluation = {key: cells.get(f'D{row}', '').strip().lower() == 'x' for row, key in zip(range(19, 23), checks)}
            result.append({
                'source_key': f'SANTAFE-HACCP-2026-{number:02d}',
                'source_sheet': str(number),
                'source_requester': after('B4'),
                'requested_at': stamp.isoformat(timespec='minutes'),
                'requesting_area': after('B6').replace('\n', ' ').strip(),
                'target_area': after('F6').replace('\n', ' ').strip(),
                'description': after('B8'),
                'improvement_proposal': after('B12'),
                'technical_evaluation': evaluation,
            })
        return result


def extract_photos(source, destination):
    """Package all non-logo sheet photos and their request keys for server import."""
    manifest = {}
    with zipfile.ZipFile(source) as workbook, zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as output:
        sheets = sorted((name for name in workbook.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', name)),
                        key=lambda name: int(re.search(r'sheet(\d+)', name).group(1)))
        added = set()
        for number, sheet in enumerate(sheets, 1):
            root = ET.fromstring(workbook.read(sheet))
            drawing_ref = root.find('x:drawing', NS)
            if drawing_ref is None:
                raise ValueError(f'Hoja {number} sin dibujo')
            sheet_rels = f'xl/worksheets/_rels/{posixpath.basename(sheet)}.rels'
            links = {node.attrib['Id']: node.attrib['Target'] for node in ET.fromstring(workbook.read(sheet_rels))}
            drawing = posixpath.normpath(posixpath.join('xl/worksheets', links[drawing_ref.attrib[OFFICE_REL+'id']]))
            drawing_rels = f'xl/drawings/_rels/{posixpath.basename(drawing)}.rels'
            images = {node.attrib['Id']: node.attrib['Target'] for node in ET.fromstring(workbook.read(drawing_rels))}
            photos = []
            for anchor in ET.fromstring(workbook.read(drawing)):
                blip = anchor.find('.//a:blip', DRAWING_NS)
                if blip is None:
                    continue
                row = anchor.find('x:from/x:row', DRAWING_NS)
                if row is None or int(row.text) < 8:
                    continue  # The repeated company logo is anchored at the top of each form.
                target = posixpath.normpath(posixpath.join('xl/drawings', images[blip.attrib[OFFICE_REL+'embed']]))
                if not target.startswith('xl/media/'):
                    raise ValueError(f'Imagen fuera de xl/media: {target}')
                name = f'photos/{posixpath.basename(target)}'
                if name not in added:
                    output.writestr(name, workbook.read(target))
                    added.add(name)
                photos.append(name)
            if not photos:
                raise ValueError(f'Hoja {number} sin fotos de solicitud')
            manifest[f'SANTAFE-HACCP-2026-{number:02d}'] = photos
        output.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    return manifest


if __name__ == '__main__':
    if len(sys.argv) > 3 and sys.argv[3] == '--photos':
        manifest = extract_photos(Path(sys.argv[1]), Path(sys.argv[2]))
        print(f'{len(manifest)} solicitudes, {sum(map(len, manifest.values()))} fotos asociadas')
    else:
        items = extract(Path(sys.argv[1]))
        Path(sys.argv[2]).write_text(json.dumps(items, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'{len(items)} solicitudes extraídas')
