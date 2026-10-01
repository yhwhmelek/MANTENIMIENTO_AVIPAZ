"""Prueba visual con Edge sin ventana y respuestas simuladas. No accede a la API real."""
import asyncio
import base64
import functools
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import websockets

from smoke_preventive_ui import FIXTURE
FIXTURE += r'''
const generalActivity={...activity,id:2,name:'Engrase general',scope:'GENERAL',start_time:'09:30',duration_minutes:120};
const manyMachines=Array.from({length:250},(_,i)=>({...machine,machine_id:i+1,asset_code:`M-${i+1}`,name:`Motor ${i+1}`}));
const baseFetch=window.fetch;
window.fetch=async(url,options={})=>{
 const path=new URL(url,location.href).pathname;let data;
 if(path.endsWith('/maquinas'))data=manyMachines;
 else if(path.endsWith('/preventivos/catalogo'))data={activities:[activity,generalActivity],plans:[plan,...(window.__generalPlan?[window.__generalPlan]:[])]};
 else if(path.endsWith('/preventivos/planes')&&options.method==='POST'){
  window.__savedGeneral=JSON.parse(options.body);window.__generalPlan={...window.__savedGeneral,id:2,revision:1,next_due:window.__savedGeneral.first_due};data={id:2};
 }
 else if(path.endsWith('/preventivos/planes/2')&&options.method==='PUT'){
  window.__savedGeneral=JSON.parse(options.body);window.__generalPlan={...window.__generalPlan,...window.__savedGeneral,revision:2};data={id:2};
 }
 else if(path.endsWith('/preventivos/proximos'))data=[{plan:window.__generalPlan,activity:generalActivity,due:window.__generalPlan.first_due,scheduled:window.__generalPlan.first_due,skipped:0}];
 else if(path.endsWith('/preventivos/publicar')){window.__published=JSON.parse(options.body);data={request_ids:[2]};}
 else if(path.endsWith('/solicitudes-mantenimiento')&&window.__published){data=[{id:2,status:'PENDIENTE',requested_at:'2026-10-01T08:00:00',requested_by:1,request_data:{machine_id:null,plant_id:1,machine_name:'',description:'Engrase general',target_area:'Engrase general',planning:{assignment_type:'MECANICO'},preventive:{scope:'GENERAL',machines:manyMachines.map(m=>({machine_id:m.machine_id,code:m.asset_code,name:m.name,plant:'Samanga',tower:'Torre 7'}))}}}];}
 else if(path.endsWith('/preventivos/semana')&&window.__published){
  const report=await (await baseFetch(url,options)).json();
  report.entries=[{...report.entries[0],key:'general-2',request_id:2,machine:'',machine_id:null,element:'',activity:'Engrase general',scope:'GENERAL',minutes:120,start_time:'09:30',items:[{key:'1',name:'Engrase general',status:'PENDIENTE',notes:''}],machines:manyMachines.map(m=>({machine_id:m.machine_id,code:m.asset_code,name:m.name,plant:'Samanga',tower:'Torre 7'}))}];data=report;
 }
 else return baseFetch(url,options);
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
'''


async def run():
    root = Path(__file__).resolve().parent.parent
    profile = Path(tempfile.mkdtemp(prefix='preventive-ui-'))
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self,*args): pass
        def handle(self):
            try: super().handle()
            except (ConnectionResetError, BrokenPipeError): pass
    server = ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root/'dist')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    browser = Path(os.environ.get('PROGRAMFILES(X86)',r'C:\Program Files (x86)'))/'Microsoft/Edge/Application/msedge.exe'
    process = subprocess.Popen([str(browser),'--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
        '--remote-debugging-port=0',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        for _ in range(200):
            if (profile/'DevToolsActivePort').exists(): break
            await asyncio.sleep(.1)
        port, endpoint=(profile/'DevToolsActivePort').read_text().splitlines()[:2]
        async with websockets.connect(f'ws://127.0.0.1:{port}{endpoint}',max_size=10_000_000) as ws:
            seq=0
            async def command(method,params=None,session=None):
                nonlocal seq
                seq+=1; ident=seq
                payload={'id':ident,'method':method,'params':params or {}}
                if session:payload['sessionId']=session
                await ws.send(json.dumps(payload))
                while True:
                    result=json.loads(await asyncio.wait_for(ws.recv(),15))
                    if result.get('id')==ident:
                        if 'error' in result:raise RuntimeError(result['error'])
                        return result.get('result',{})
            target=await command('Target.createTarget',{'url':'about:blank'})
            session=(await command('Target.attachToTarget',{'targetId':target['targetId'],'flatten':True}))['sessionId']
            async def evaluate(expression):
                result=await command('Runtime.evaluate',{'expression':expression,'returnByValue':True,'awaitPromise':True},session)
                if result.get('exceptionDetails'):raise AssertionError(result['exceptionDetails'])
                return result.get('result',{}).get('value')
            async def wait_for(expression):
                for _ in range(100):
                    if await evaluate(f'Boolean({expression})'):return
                    await asyncio.sleep(.1)
                raise AssertionError(f'UI timeout: {expression}; JS errors: {await evaluate("window.__errors")}')
            async def click(text):
                await evaluate(f"(()=>{{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==={json.dumps(text)});if(!b)throw Error('Missing button');b.click()}})()")
            await command('Page.enable',session=session)
            await command('Page.addScriptToEvaluateOnNewDocument',{'source':FIXTURE},session)
            await command('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False},session)
            await command('Page.navigate',{'url':f'http://127.0.0.1:{server.server_port}/'},session)
            await wait_for("document.querySelector('.alerts-center-trigger')")
            await click('Preventivos')
            await click('Planes de mantenimiento')
            await wait_for("[...document.querySelectorAll('button')].some(b=>b.textContent==='Asignar actividad general'&&!b.disabled)")
            await click('Asignar actividad general')
            await wait_for("document.querySelector('.general-plan-editor')")
            assert await evaluate("document.querySelector('.general-plan-editor input[type=time]').value==='09:30'")
            await click('Seleccionar todas las visibles')
            assert await evaluate("document.querySelectorAll('.general-machine-list input:checked').length") == 250
            await click('Guardar plan general')
            await wait_for("!!window.__savedGeneral")
            assert await evaluate("window.__savedGeneral.machine_ids.length===250&&window.__savedGeneral.machine_id===null&&window.__savedGeneral.points.length===0")
            await wait_for("!document.querySelector('.general-plan-editor')")
            await click('Editar selección')
            assert await evaluate("document.querySelectorAll('.general-machine-list input:checked').length") == 250
            await click('Cancelar')
            # Specific plans still use their independent element form.
            await click('Agregar plan al elemento / máquina')
            await wait_for("document.querySelector('.preventive-editor')")
            assert await evaluate("!document.querySelector('.preventive-editor select').querySelector('option[value=\"2\"]')")
            await click('Cerrar')
            await click('Actividades y frecuencias')
            await evaluate("[...document.querySelectorAll('tr')].find(r=>r.querySelector('strong')?.textContent==='Engrase general').querySelector('button').click()")
            await wait_for("document.querySelector('.preventive-editor input[type=time]')")
            assert await evaluate("document.querySelector('.preventive-editor input[type=time]').value==='09:30'")
            await click('Cerrar')
            await click('Calendario MT/02-03')
            await click('Preparar / publicar preventivos')
            await wait_for("document.querySelector('[aria-label=\"Publicar semana\"]')")
            assert await evaluate("document.querySelector('[aria-label=\"Publicar semana\"]').innerText.includes('250')")
            await click('Publicar y generar alertas')
            await wait_for("!!window.__published&&!document.querySelector('[aria-label=\"Publicar semana\"]')")
            await wait_for("document.querySelector('.preventive-week-table').innerText.includes('Engrase general')")
            assert await evaluate("document.querySelectorAll('.preventive-week-table tbody tr').length") == 1
            assert await evaluate("document.querySelector('.preventive-week-table').innerText.includes('09:30')")
            await click('Ver trabajo')
            await wait_for("document.querySelector('.preventive-coverage')")
            assert await evaluate("document.querySelectorAll('.modal-backdrop .preventive-coverage li').length") == 250
            await click('Cerrar')
            await click('Alertas disponibles')
            await wait_for("document.querySelectorAll('.alerts-center .request-alert-work').length===1")
            assert await evaluate("document.querySelector('.alerts-center .request-alert-work').innerText.includes('Engrase general')")
            assert await evaluate("document.querySelectorAll('.alerts-center .preventive-coverage li').length") == 250
            assert await evaluate('window.__errors.length') == 0
            print('GENERAL_PREVENTIVE_UI_OK: 250 checkboxes, one plan/publication/calendar row, coverage detail, time and specific form')
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
        server.shutdown()


if __name__=='__main__':asyncio.run(run())
