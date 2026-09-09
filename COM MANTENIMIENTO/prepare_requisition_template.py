"""Preparacion unica desde la copia XLSX del documento original, convertida con LibreOffice."""
import sys
from copy import deepcopy
from pathlib import Path
import zipfile
import xml.etree.ElementTree as E

from purchase_requisitions import NS, TEMPLATE, set_cell


def prepare(source_path):
    allowed = {'[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels',
               'xl/worksheets/sheet1.xml','xl/worksheets/_rels/sheet1.xml.rels',
               'xl/drawings/drawing1.xml','xl/drawings/_rels/drawing1.xml.rels',
               'xl/styles.xml','xl/theme/theme1.xml','xl/media/image1.jpeg'}
    with zipfile.ZipFile(source_path) as source:
        content = {name:source.read(name) for name in allowed}
        strings = [''.join(node.itertext()) for node in E.fromstring(source.read('xl/sharedStrings.xml'))]
        sheet = E.fromstring(content['xl/worksheets/sheet1.xml'])
        for cell in sheet.findall(f'.//{{{NS}}}c'):
            if cell.get('t')=='s':
                set_cell(sheet, cell.get('r'), strings[int(cell.find(f'{{{NS}}}v').text)])
        editable = ['B5','E5','B6','E6','B7','B20','B25']+[f'{col}{row}' for row in range(9,20) for col in 'ABCD']
        for ref in editable:
            set_cell(sheet, ref, '')
        setup=sheet.find(f'{{{NS}}}pageSetup')
        setup.set('fitToWidth','1');setup.set('fitToHeight','0')
        content['xl/worksheets/sheet1.xml']=E.tostring(sheet,encoding='utf-8',xml_declaration=True)
        workbook=E.fromstring(content['xl/workbook.xml'])
        sheets=workbook.find(f'{{{NS}}}sheets')
        for node in list(sheets)[1:]:sheets.remove(node)
        sheets[0].set('name','Requisicion')
        names=E.SubElement(workbook,f'{{{NS}}}definedNames')
        E.SubElement(names,f'{{{NS}}}definedName',name='_xlnm.Print_Area',localSheetId='0').text="'Requisicion'!$A$1:$G$27"
        E.SubElement(names,f'{{{NS}}}definedName',name='_xlnm.Print_Titles',localSheetId='0').text="'Requisicion'!$1:$8"
        # definedNames precede calcPr in SpreadsheetML.
        workbook.remove(names);workbook.insert(list(workbook).index(sheets)+1,names)
        content['xl/workbook.xml']=E.tostring(workbook,encoding='utf-8',xml_declaration=True)
        for filename in ['_rels/.rels','xl/_rels/workbook.xml.rels']:
            root=E.fromstring(content[filename])
            for rel in list(root):
                if rel.get('Target') in ['docProps/core.xml','docProps/app.xml','worksheets/sheet2.xml','sharedStrings.xml']:root.remove(rel)
            content[filename]=E.tostring(root,encoding='utf-8',xml_declaration=True)
        types=E.fromstring(content['[Content_Types].xml'])
        for node in list(types):
            if node.get('PartName') and node.get('PartName').lstrip('/') not in allowed:types.remove(node)
        content['[Content_Types].xml']=E.tostring(types,encoding='utf-8',xml_declaration=True)
        styles=E.fromstring(content['xl/styles.xml'])
        xfs = styles.find(f'{{{NS}}}cellXfs')
        wrapped = {}
        for ref in editable:
            cell = sheet.find(f'.//{{{NS}}}c[@r="{ref}"]')
            style_id = int(cell.get('s','0'))
            if style_id in wrapped:
                cell.set('s', wrapped[style_id])
                continue
            xf = deepcopy(xfs[style_id])
            alignment=xf.find(f'{{{NS}}}alignment')
            if alignment is None:alignment=E.SubElement(xf,f'{{{NS}}}alignment')
            alignment.set('wrapText','1')
            xf.set('applyAlignment','1')
            wrapped[style_id] = str(len(xfs))
            cell.set('s', wrapped[style_id])
            xfs.append(xf)
        xfs.set('count',str(len(xfs)))
        content['xl/worksheets/sheet1.xml']=E.tostring(sheet,encoding='utf-8',xml_declaration=True)
        content['xl/styles.xml']=E.tostring(styles,encoding='utf-8',xml_declaration=True)
        TEMPLATE.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(TEMPLATE,'w',zipfile.ZIP_DEFLATED) as target:
            for name,value in content.items():target.writestr(name,value)
    return TEMPLATE


if __name__=='__main__':
    print(prepare(Path(sys.argv[1])))
