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


FIXTURE = r"""
window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));
const user={id:1,nombre:'Mecanico',rol:'MECANICO',activo:true,planta_id:1};
sessionStorage.setItem('access_token','SIMULADO');sessionStorage.setItem('usuario',JSON.stringify(user));
const work={id:61,status:'EN_PROCESO',assigned_to:1,requested_by:2,requested_at:'2026-01-01T08:00:00',accepted_at:'2026-01-01T09:00:15',priority:{level:'ALTO'},request_data:{machine_id:1,machine_name:'Molino',description:'Reparar motor',maintenance_type:'CORRECTIVO',plant_id:1,stopped_at:'2026-01-01T08:20:35',planning:{condition:'LISTA',assigned_user_id:1}}};
window.__reject=true;
window.fetch=async(url,options={})=>{
 const path=new URL(url,location.href).pathname;let data=[];
 if(path.endsWith('/auth/me'))data=user;
 else if(path.endsWith('/solicitudes-mantenimiento/61/completar')){
  window.__payload=JSON.parse(options.body);
  if(window.__reject)return new Response(JSON.stringify({detail:[{loc:['body','work_done'],msg:'Rechazo de prueba'}]}),{status:422,headers:{'Content-Type':'application/json'}});
  work.status='POR_RECIBIR';data={id:61};
 }
 else if(path.endsWith('/solicitudes-mantenimiento'))data=[work];
 else if(path.endsWith('/maquinas'))data=[{machine_id:1,asset_code:'M1',name:'Molino',plant_id:1}];
 else if(path.endsWith('/plantas'))data=[{plant_id:1,name:'Samanga'}];
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
"""

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

            await wait_for("[...document.querySelectorAll('button')].some(b=>b.textContent==='Solicitudes')")
            await click('Solicitudes')
            await wait_for("document.querySelector('.requests-nav')")
            await click('Trabajos disponibles y en curso')
            await wait_for("document.querySelector('.request-workspace .request-detail button')")
            await evaluate("document.querySelector('.request-workspace .request-detail button').click()")
            await wait_for("[...document.querySelectorAll('button')].some(b=>b.textContent==='Terminar trabajo'&&!b.disabled)")
            await click('Terminar trabajo')
            await wait_for("document.querySelector('.request-workspace form textarea')")
            await evaluate("(()=>{const e=document.querySelector('.request-workspace form textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Motor reparado');e.dispatchEvent(new Event('input',{bubbles:true}))})()")
            await click('Entregar trabajo')
            await wait_for("document.querySelector('.request-workspace form [role=alert]')?.textContent.includes('Rechazo de prueba')")
            assert await evaluate("!document.querySelector('.request-fields').disabled")
            assert await evaluate("document.querySelector('.request-workspace form textarea').value==='Motor reparado'")
            assert await evaluate("window.__payload.restored_at===window.__payload.repair_finished_at")
            assert await evaluate("window.__payload.stopped_at==='2026-01-01T08:20:35'")
            await evaluate('window.__reject=false')
            await click('Entregar trabajo')
            await wait_for("!document.querySelector('.request-workspace form')")
            assert await evaluate('window.__errors.length')==0
            print('COMPLETION_UI_OK: fechas coherentes, 422 visible junto al boton, formulario conservado, Guardando liberado y reintento exitoso.')
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
        server.shutdown()


if __name__=='__main__':asyncio.run(run())
