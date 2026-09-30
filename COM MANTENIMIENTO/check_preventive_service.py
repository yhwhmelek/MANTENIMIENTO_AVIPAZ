"""Comprueba si la API configurada por el frontend ya sirve el módulo, sin autenticarse."""
import json
from pathlib import Path
from urllib.request import urlopen
from dotenv import dotenv_values

url = dotenv_values(Path(__file__).resolve().parent.parent / '.env').get('VITE_API_URL', 'http://localhost:8000').rstrip('/')
try:
    with urlopen(url+'/openapi.json',timeout=10) as response:
        schema=json.load(response)
    paths=schema.get('paths',{})
    required=['/preventivos/catalogo','/preventivos/publicar','/preventivos/semana','/preventivos/semana.xlsx']
    print('RUNNING_API_PREVENTIVE_READY' if all(p in paths for p in required) else 'RUNNING_API_REQUIRES_RESTART')
except Exception as error:
    print('RUNNING_API_CHECK_FAILED',type(error).__name__,getattr(error,'code',''))
