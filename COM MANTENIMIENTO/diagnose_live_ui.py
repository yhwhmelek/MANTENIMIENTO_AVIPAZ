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
            events=[]
            seq=0
            async def command(method,params=None,session=None):
                nonlocal seq
                seq+=1; ident=seq
                payload={'id':ident,'method':method,'params':params or {}}
                if session:payload['sessionId']=session
                await ws.send(json.dumps(payload))
                while True:
                    result=json.loads(await asyncio.wait_for(ws.recv(),15))
                    if result.get('method') in ['Network.responseReceived','Network.loadingFailed','Runtime.exceptionThrown']: events.append(result)
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
            await command('Network.enable',session=session)
            await command('Runtime.enable',session=session)
            import sys
            if '--simulate' in sys.argv:
                from smoke_preventive_ui import FIXTURE
                fixture = FIXTURE.replace("else if(path.endsWith('/maquinas'))", "else if(path.endsWith('/solicitudes-mantenimiento'))data=[{id:12,requested_at:'2026-10-01T08:00:00',status:'PENDIENTE',assigned_to:1,requested_by:1,request_data:{machine_id:1,machine_name:'Molino',description:'Reparar motor',plant_id:1,planning:{assignment_type:'USER',assigned_user_id:1,responsible_role:'ELECTRICO'}}}];else if(path.endsWith('/maquinas'))")
                await command('Page.addScriptToEvaluateOnNewDocument',{'source':fixture},session)
            await command('Page.navigate',{'url':'https://mantenimientoavipaz.guemultech.com/'},session)
            await asyncio.sleep(5)
            print('PAGE',await evaluate("JSON.stringify({url:location.href,title:document.title,text:document.body.innerText.slice(0,3000),scripts:[...document.scripts].map(s=>s.src)})"))
            for event in events:
                data=event.get('params',{})
                if event['method']=='Network.responseReceived':
                    r=data['response']
                    if r['status']>=400: print('RESPONSE',r['status'],r['url'],r.get('mimeType'))
                else: print('ERROR',json.dumps(data,ensure_ascii=True))
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
        server.shutdown()


if __name__=='__main__':asyncio.run(run())
