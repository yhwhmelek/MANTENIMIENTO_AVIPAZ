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
const baseFetch=window.fetch;
const staff={id:2,nombre:'tecnico',nombre_completo:'Personal de prueba',rol:'MECANICO',planta_id:null,correo:'personal@example.com',activo:true,creado_en:'2026-01-01'};
window.__switchUser=(rol,plant)=>{Object.assign(user,{id:rol==='ADMIN'?1:2,rol,planta_id:plant});window.dispatchEvent(new Event('focus'))};
const makeWork=(id,plant,description,assignment='TECNICO')=>({id,status:'PENDIENTE',assigned_to:null,requested_by:1,requested_at:'2026-10-01T08:00:00',request_data:{plant_id:plant,machine_id:null,target_area:description,description,planning:{assignment_type:assignment,condition:'LISTA'}}});
const jobs=[makeWork(1,1,'Trabajo Samanga'),makeWork(2,2,'Trabajo Santa Fe'),makeWork(3,null,'Trabajo sin planta'),makeWork(4,2,'Trabajo electrico','ELECTRICO'),makeWork(5,null,'Engrase compartido')];
jobs[4].request_data.preventive={machines:[{machine_id:1,plant_id:1,code:'SAM-01',name:'Motor Samanga',plant:'Samanga'},{machine_id:2,plant_id:2,code:'SF-01',name:'Motor Santa Fe',plant:'Santa Fe'}]};
window.fetch=async(url,options={})=>{
 const path=new URL(url,location.href).pathname;let data;
 if(path.endsWith('/plantas'))data=[{plant_id:1,name:'Samanga'},{plant_id:2,name:'Santa Fe'}];
 else if(path.endsWith('/usuarios'))data=[{...user,creado_en:'2026-01-01'},staff];
 else if(path.endsWith('/usuarios/2/planta')){window.__plantSave=JSON.parse(options.body);Object.assign(staff,window.__plantSave);data=staff;}
 else if(path.endsWith('/usuarios/2/rol')){Object.assign(staff,JSON.parse(options.body));data=staff;}
 else if(path.endsWith('/solicitudes-mantenimiento'))data=jobs.map(j=>({...j,alert_plant_id:user.planta_id,alert_in_plant:user.rol==='ADMIN'||(user.planta_id!=null&&(j.request_data.plant_id===user.planta_id||j.request_data.preventive?.machines.some(m=>m.plant_id===user.planta_id)))}));
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
            await click('Usuarios')
            await wait_for("document.querySelector('select[aria-label=\"Planta de Personal de prueba\"]')")
            await evaluate("(()=>{const s=document.querySelector('select[aria-label=\"Planta de Personal de prueba\"]');s.value='2';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
            await wait_for("window.__plantSave?.planta_id===2")
            await evaluate("(()=>{const row=[...document.querySelectorAll('.users-card tbody tr')].find(r=>r.innerText.includes('Personal de prueba'));const s=row.querySelector('select');s.value='TECNICO';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
            await wait_for("staff.rol==='TECNICO'")
            await evaluate("window.__switchUser('TECNICO',2)")
            await wait_for("document.querySelector('.admin-user').textContent.includes('TECNICO')")
            await evaluate("document.querySelector('.alerts-center-trigger').click()")
            await wait_for("document.querySelector('dialog').textContent.includes('Trabajo Santa Fe')")
            assert await evaluate("document.querySelector('dialog').textContent.includes('Trabajos disponibles y en curso: 2')")
            assert not await evaluate("document.querySelector('dialog').textContent.includes('Trabajo Samanga')")
            assert not await evaluate("document.querySelector('dialog').textContent.includes('Trabajo electrico')")
            assert not await evaluate("document.querySelector('dialog').textContent.includes('Motor Samanga')")
            assert await evaluate("document.querySelector('dialog').textContent.includes('Motor Santa Fe')")
            await evaluate("window.__switchUser('TECNICO',1)")
            await wait_for("document.querySelector('dialog').textContent.includes('Trabajo Samanga')")
            assert not await evaluate("document.querySelector('dialog').textContent.includes('Trabajo Santa Fe')")
            await evaluate("window.__switchUser('TECNICO',null)")
            await wait_for("document.querySelector('dialog').textContent.includes('No tienes planta asignada')")
            await wait_for("document.querySelectorAll('dialog .request-alert-work').length===0")
            await evaluate("window.__switchUser('ADMIN',null)")
            await wait_for("document.querySelector('.admin-user').textContent.includes('ADMIN')")
            await evaluate("document.querySelector('.alerts-center-trigger').click()")
            await wait_for("document.querySelectorAll('dialog .request-alert-work').length===5")
            assert await evaluate('window.__errors.length') == 0
            print('PLANT_UI_OK: save plant, assign technician role, scoped alerts and counts, mixed coverage, live reassignment, unassigned warning, administrators')

    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
        server.shutdown()


if __name__=='__main__':asyncio.run(run())
