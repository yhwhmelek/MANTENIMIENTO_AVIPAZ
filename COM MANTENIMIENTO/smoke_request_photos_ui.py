import asyncio
import smoke_preventive_ui as smoke

smoke.FIXTURE = smoke.FIXTURE.replace("else if(path.endsWith('/maquinas'))", """else if(path.endsWith('/solicitudes-mantenimiento'))data=[{id:12,status:'PENDIENTE',assigned_to:1,requested_by:1,request_data:{machine_id:1,machine_name:'Molino',description:'Reparar motor',plant_id:1,planning:{assignment_type:'USER',assigned_user_id:1,responsible_role:'ELECTRICO'}}}];
 else if(path.endsWith('/maquinas'))""")
asyncio.run(smoke.run())
