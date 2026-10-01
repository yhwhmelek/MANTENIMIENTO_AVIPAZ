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

FIXTURE = r'''
window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));
const user={id:1,nombre:'Prueba',nombre_completo:'Responsable de prueba',rol:'ADMIN',activo:true};
sessionStorage.setItem('access_token','SIMULADO');sessionStorage.setItem('usuario',JSON.stringify(user));
const activity={id:1,name:'Engrase general de chumaceras',procedure:'Revisar cada apoyo y registrar la lubricación.',kind:'ENGRASE',frequency:{every:1,unit:'MESES'},group:'MECANICO',duration_minutes:60,crew_size:2,factors:{n:2,i:2,c:2},reference:'Manual del fabricante',requires_shutdown:false,active:true,revision:1};
const machine={machine_id:1,asset_code:'M-01',name:'Molino de prueba',plant_name:'Samanga',tower_name:'Torre 7',plant_id:1,tower_id:1,status:'ACTIVA'};
const element={element_id:1,machine_id:1,name:'Eje de transmisión',element_code:'EJE-01',element_type_id:1,active:true};
const plan={id:1,activity_id:1,machine_id:1,element_id:1,first_due:'2026-09-28',start_time:'08:00:00',frequency_override:null,override_reason:'',route:'Lubricación Torre 7',points:[{name:'Apoyo DE',bearing_code:'6205',housing_code:'UCP205',lubricant:'Grasa aprobada',dose:'Según ficha'}],active:true,revision:1,next_due:'2026-09-28'};
window.fetch=async(url,options={})=>{
 const path=new URL(url,location.href).pathname;let data=[];
 if(path.endsWith('/auth/me'))data=user;
 else if(path.endsWith('/maquinas'))data=[machine];
 else if(path.endsWith('/elementos-maquinas'))data=[element];
 else if(path.endsWith('/tipos-elementos'))data=[{element_type_id:1,name:'Eje',specification_type:'NONE',active:true}];
 else if(path.endsWith('/plantas'))data=[{plant_id:1,name:'Samanga'}];
 else if(path.endsWith('/torres'))data=[{tower_id:1,plant_id:1,name:'Torre 7'}];
 else if(path.endsWith('/preventivos/catalogo'))data={activities:[activity],plans:[plan]};
 else if(path.endsWith('/preventivos/proximos'))data=[{plan,activity,due:plan.first_due,scheduled:plan.first_due,skipped:0}];
 else if(path.endsWith('/preventivos/semana')){
  const week=new URL(url,location.href).searchParams.get('week');
  data={week,end:week,closed:false,summary:{programmed:1,executed:0,percent:0},entries:[{key:'schedule-1',request_id:1,status:'PENDIENTE',request_status:'PENDIENTE',moved:false,scheduled:week,completed_at:null,machine:machine.name,machine_id:1,plant:'Samanga',tower:'Torre 7',element:element.name,activity:activity.name,route:plan.route,origin:'MT/02-01',kind:'PREVENTIVO',group:'MECANICO',assignee:'',crew_size:2,minutes:60,human_minutes:0,priority:'MEDIO',notes:'',items:[{key:'1',...plan.points[0],status:'PENDIENTE',notes:''}],participants:[],validated:false,preventive:true}]};
 }
 else if(path.includes('/preventivos/actividades')&&(options.method==='PUT'||options.method==='POST')){window.__savedActivity=JSON.parse(options.body);data={id:1}}
 else if(path.endsWith('/preventivos/publicar'))data={request_ids:[1]};
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
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
            await wait_for("[...document.querySelectorAll('button')].some(b=>b.textContent==='Preventivos')")
            await click('Alertas disponibles')
            await wait_for("document.querySelector('.alerts-center').open")
            assert await evaluate("document.querySelector('.alerts-center').innerText.includes('Mantenimiento')")
            await evaluate("document.querySelector('.alerts-center .request-alert-trigger').click()")
            await wait_for("!document.querySelector('.alerts-center').open")
            await click('Preventivos')
            await wait_for("document.querySelector('.preventive-week-table tbody tr')")
            assert await evaluate("document.body.innerText.includes('Engrase general de chumaceras')")
            await click('Actividades y frecuencias')
            await wait_for("document.body.innerText.includes('Nueva actividad preventiva')")
            await click('Editar')
            await wait_for("document.querySelector('.preventive-editor input')")
            assert await evaluate("document.querySelector('.preventive-editor form').checkValidity()")
            for width, height in [(1440, 1000), (390, 844)]:
                await command('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False},session)
                await evaluate("document.querySelector('.preventive-editor .primary-action').scrollIntoView({block:'center'})")
                await asyncio.sleep(.2)
                point = await evaluate("(()=>{const b=document.querySelector('.preventive-editor .primary-action');const r=b.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,clear:b.contains(document.elementFromPoint(x,y))}})()")
                assert point['clear'], f"Guardar bloqueado a {width}px"
            await command('Input.dispatchMouseEvent',{'type':'mousePressed','x':point['x'],'y':point['y'],'button':'left','clickCount':1},session)
            await command('Input.dispatchMouseEvent',{'type':'mouseReleased','x':point['x'],'y':point['y'],'button':'left','clickCount':1},session)
            await command('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False},session)
            await wait_for("!!window.__savedActivity")
            assert await evaluate("window.__savedActivity.frequency.unit==='MESES'&&!('id' in window.__savedActivity)")
            await wait_for("!document.querySelector('.preventive-editor')")
            await click('Planes por elemento')
            await click('Editar')
            await wait_for("document.querySelector('.preventive-editor form')")
            assert await evaluate("document.querySelector('.preventive-editor form').checkValidity()")
            assert await evaluate("document.body.innerText.includes('Incluir este elemento en el cronograma de engrase')")
            await click('Cerrar')
            await click('Calendario MT/02-03')
            await click('Preparar / publicar preventivos')
            await wait_for("document.querySelector('[aria-label=\"Publicar semana\"]')")
            assert await evaluate("document.querySelector('[aria-label=\"Publicar semana\"] input[type=checkbox]').checked")
            await click('Cerrar')
            await click('Ver trabajo')
            await wait_for("document.body.innerText.includes('Apoyo DE')")
            await click('Cerrar')
            assert await evaluate('window.__errors.length')==0
            screenshot=await command('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False},session)
            path=profile/'preventive-week.png';path.write_bytes(base64.b64decode(screenshot['data']))
            print('UI_SMOKE_OK: calendario, actividad editable, plan por elemento, checkbox de engrase, vista previa y detalle; sin errores JS')
            print('SCREENSHOT',path)
            # El rol técnico conserva la lectura general sin controles administrativos.
            await command('Page.addScriptToEvaluateOnNewDocument',{'source':"user.rol='MECANICO';sessionStorage.setItem('usuario',JSON.stringify(user));"},session)
            await command('Page.reload',session=session)
            await wait_for("[...document.querySelectorAll('button')].some(b=>b.textContent==='Preventivos')")
            await click('Preventivos')
            await wait_for("document.querySelector('.preventive-week-table tbody tr')")
            assert await evaluate("!document.body.innerText.includes('Preparar / publicar preventivos')")
            await click('Actividades y frecuencias')
            assert await evaluate("!document.body.innerText.includes('Nueva actividad preventiva')")
            assert await evaluate('window.__errors.length')==0
            print('TECHNICIAN_UI_OK: lectura general sin acciones administrativas')
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
        server.shutdown()


if __name__=='__main__':asyncio.run(run())
