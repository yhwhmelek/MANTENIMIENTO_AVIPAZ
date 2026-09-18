"""Extract the 29 MT/02-08 forms into an app import fixture (stdlib only).

Usage: python import_santafe_haccp.py source.xlsx ../src/santafe-haccp-2026.json
"""
import json
import re
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


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


if __name__ == '__main__':
    items = extract(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(json.dumps(items, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(items)} solicitudes extraídas')
