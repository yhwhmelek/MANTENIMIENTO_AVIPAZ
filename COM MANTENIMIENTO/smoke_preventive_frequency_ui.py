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
const generalActivity={...activity,id:2,scope:'GENERAL',name:'Engrase general por horas',frequency:{every:500,unit:'HORAS'}};
const generalPlan={...plan,id:2,activity_id:2,scope:'GENERAL',machine_id:null,machine_ids:[1],element_id:null,points:[]};
window.fetch=async(url,options={})=>{
 const path=new URL(url,location.href).pathname;
 if(path.endsWith('/preventivos/catalogo'))return new Response(JSON.stringify({activities:[activity,generalActivity],plans:[plan,generalPlan]}),{headers:{'Content-Type':'application/json'}});
 const result=await baseFetch(url,options);
 if(path.includes('/preventivos/actividades')&&options.method==='PUT')Object.assign(activity,JSON.parse(options.body));
 return result;
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
            await click('Actividades y frecuencias')
            await click('Nueva actividad preventiva')
            await wait_for("document.querySelector('.preventive-frequency select')")
            assert await evaluate("[...document.querySelector('.preventive-frequency select').options].map(o=>o.value).join(',')") == 'SEMANAS,HORAS'
            assert await evaluate("document.querySelector('.preventive-frequency select').value") == 'SEMANAS'
            await click('Cerrar')
            await click('Editar')
            await wait_for("document.querySelector('.preventive-frequency select')")
            assert await evaluate("document.querySelector('.preventive-frequency select').value") == 'MESES'
            await evaluate("(()=>{const s=document.querySelector('.preventive-frequency select');s.value='HORAS';s.dispatchEvent(new Event('change',{bubbles:true}))})()")
            await evaluate("(()=>{const i=document.querySelector('.preventive-frequency input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'2500');i.dispatchEvent(new Event('input',{bubbles:true}))})()")
            await evaluate("(()=>{const inputs=document.querySelectorAll('.preventive-frequency input');for(const [index,value] of [[1,'50'],[2,'10']]){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[index],value);inputs[index].dispatchEvent(new Event('input',{bubbles:true}))}})()")
            assert await evaluate("document.querySelector('.preventive-editor form').checkValidity()")
            assert await evaluate("document.querySelector('.preventive-editor').innerText.includes('Los avisos se calculan')")
            await click('Guardar')
            await wait_for("!!window.__savedActivity&&!document.querySelector('.preventive-editor')")
            assert await evaluate("window.__savedActivity.frequency.unit==='HORAS'&&window.__savedActivity.frequency.every===2500&&window.__savedActivity.frequency.first_hours===50&&window.__savedActivity.frequency.advance_hours===10&&window.__savedActivity.duration_minutes===60")
            await click('Planes de mantenimiento')
            await wait_for("document.querySelector('.general-preventive-plans')")
            assert await evaluate("document.querySelector('.general-preventive-plans').innerText.includes('Primer cambio: 500 h')")
            assert await evaluate("document.querySelector('.general-preventive-plans').innerText.includes('Consultar Hor\u00f3metros y avisos')")
            await evaluate("document.querySelector('.general-preventive-plans tbody button').click()")
            await wait_for("document.querySelector('.general-plan-editor')")
            assert await evaluate("document.querySelector('.general-plan-editor').innerText.includes('Fecha de referencia del plan')")
            await click('Cancelar')
            await click('Editar')
            await wait_for("document.querySelector('.preventive-editor')")
            assert await evaluate("document.querySelector('.preventive-editor').innerText.includes('Primer cambio: 50 h')")
            assert await evaluate("document.querySelector('.preventive-editor').innerText.includes('Fecha de referencia del plan')")
            await click('Cerrar')
            await click('Calendario MT/02-03')
            assert await evaluate("document.querySelector('.preventive-module').innerText.includes('2 plan(es) por horas de funcionamiento')")
            assert await evaluate('window.__errors.length') == 0
            print('FREQUENCY_UI_OK: weeks/hours choices, legacy record, 2500 hours saved, duration preserved, first change and advance hours saved, specific and general plans')
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
        server.shutdown()


if __name__=='__main__':asyncio.run(run())
