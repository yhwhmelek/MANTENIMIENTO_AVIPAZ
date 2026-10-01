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
FIXTURE = FIXTURE.replace("else if(path.endsWith('/maquinas'))data=[machine];", """else if(/\/maquinas\/\d+\/imagen$/.test(path)||path.includes('/imagenes/')) {
 window.__photoCalls=(window.__photoCalls||[]).concat(path);
 if(path.includes('/maquinas/2/'))return new Response('',{status:404});
 return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="green"/></svg>',{headers:{'Content-Type':'image/svg+xml'}});
 }
 else if(path.endsWith('/solicitudes-mantenimiento'))data=[
 {id:12,status:'PENDIENTE',requested_at:'2026-10-01T08:00:00',request_data:{machine_id:1,machine_name:'Molino',description:'Reparar motor',plant_id:1,image_paths:['first.jpg','second.jpg'],planning:{assignment_type:'MECANICO_ELECTRICO'}}},
 {id:13,status:'PENDIENTE',requested_at:'2026-10-01T08:00:00',request_data:{machine_id:2,machine_name:'Sin foto',description:'Pendiente de validar',plant_id:1,image_path:'legacy.jpg'}},
 {id:14,status:'PENDIENTE',requested_at:'2026-10-01T08:00:00',request_data:{description:'Solicitud de area',plant_id:1}}
 ];
 else if(path.endsWith('/maquinas'))data=[machine,{...machine,machine_id:2,name:'Sin foto'}];""")


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
            for role in ['ADMIN','MECANICO','ELECTRICO']:
                if role != 'ADMIN':
                    await command('Page.addScriptToEvaluateOnNewDocument',{'source':f"user.rol='{role}';sessionStorage.setItem('usuario',JSON.stringify(user));"},session)
                    await command('Page.reload',session=session)
                    await wait_for("document.querySelector('.alerts-center-trigger')")
                await click('Alertas disponibles')
                await wait_for("document.querySelector('.alerts-center').open")
                await wait_for("document.querySelectorAll('.alerts-center .request-alert-work').length")
                expected = 3 if role == 'ADMIN' else 1
                assert await evaluate("document.querySelectorAll('.alerts-center .request-alert-work').length") == expected
                await wait_for("[...document.querySelectorAll('.alerts-center .request-alert-work:first-of-type img')].length || document.querySelectorAll('.alerts-center .request-alert-work img').length>=3")
                await wait_for("[...document.querySelectorAll('.alerts-center .request-alert-work img')].filter(i=>i.complete&&i.naturalWidth>0).length>=3")
                assert await evaluate("document.querySelector('.alerts-center').innerText.includes('Foto de solicitud #12 (2)')")
                if role == 'ADMIN':
                    await evaluate("[...document.querySelectorAll('.request-alert-work')][1].scrollIntoView()")
                    await wait_for("document.querySelector('.alerts-center').innerText.includes('Foto no disponible')")
                    await wait_for("[...document.querySelectorAll('.alerts-center img')].some(i=>i.alt.includes('#13')&&i.naturalWidth>0)")
                await evaluate("document.querySelector('.alerts-center .request-alert-trigger').click()")
                await wait_for("!document.querySelector('.alerts-center').open")
                await wait_for("[...document.querySelectorAll('button')].some(b=>b.textContent==='Generar solicitud'&&!b.disabled)")
                await click('Generar solicitud')
                async def select(label, value):
                    await evaluate(f"(()=>{{const s=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith({json.dumps(label)}))?.querySelector('select');if(!s)throw Error('Missing select');s.value={json.dumps(value)};s.dispatchEvent(new Event('change',{{bubbles:true}}));}})()")
                await select('Planta','1')
                await select('Torre','1')
                await select('M'+chr(225)+'quina (opcional','1')
                await evaluate("document.querySelector('.selected-machine-photo').scrollIntoView()")
                await wait_for("document.querySelector('.selected-machine-photo img')?.naturalWidth>0")
                await select('M'+chr(225)+'quina (opcional','2')
                await wait_for("document.querySelector('.selected-machine-photo').innerText.includes('Foto no disponible')")
                assert await evaluate("!document.querySelector('.selected-machine-photo img')")
                await select('M'+chr(225)+'quina (opcional','')
                await wait_for("!document.querySelector('.selected-machine-photo')")
                assert await evaluate('window.__errors.length') == 0
                print('PHOTOS_UI_OK', role, 'alert photos, multiple attachments, missing photos, machine selection and clearing')
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
        server.shutdown()


if __name__=='__main__':asyncio.run(run())
