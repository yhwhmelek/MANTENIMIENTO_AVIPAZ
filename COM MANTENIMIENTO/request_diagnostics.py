"""Muestra el motivo de rechazos de solicitudes sin registrar cuerpos ni credenciales."""
import logging

from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from starlette.exceptions import HTTPException

logger = logging.getLogger('uvicorn.error')


def register_request_diagnostics(app):
    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        if request.url.path.startswith('/solicitudes-mantenimiento'):
            messages = []
            for error in exc.errors():
                location = '.'.join(str(value) for value in error.get('loc', ()) if value != 'body') or 'formulario'
                messages.append(f"{location}: {error.get('msg', 'Valor no valido')}")
            logger.warning('Solicitud rechazada 422 | %s %s | %s', request.method, request.url.path, ' | '.join(messages))
        return await request_validation_exception_handler(request, exc)

    @app.exception_handler(HTTPException)
    async def business_error(request, exc):
        if exc.status_code == 422 and request.url.path.startswith('/solicitudes-mantenimiento'):
            logger.warning('Solicitud rechazada 422 | %s %s | %s', request.method, request.url.path, exc.detail)
        return await http_exception_handler(request, exc)
