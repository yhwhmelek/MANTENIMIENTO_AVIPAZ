import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.requests import Request

from request_diagnostics import register_request_diagnostics


class DiagnosticTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.app = FastAPI()
        register_request_diagnostics(self.app)
        self.request = Request({'type': 'http', 'method': 'POST', 'path': '/solicitudes-mantenimiento/3/completar', 'headers': [], 'query_string': b''})

    async def test_validation_logs_reason_not_form(self):
        error = RequestValidationError([{'loc': ('body','repair_finished_at'), 'msg': 'Fecha no valida', 'type': 'datetime_parsing', 'input': 'dato-privado'}], body={'token':'secreto'})
        with patch('request_diagnostics.logger.warning') as log:
            response = await self.app.exception_handlers[RequestValidationError](self.request, error)
        self.assertEqual(response.status_code, 422)
        self.assertIn('repair_finished_at: Fecha no valida', str(log.call_args))
        self.assertNotIn('dato-privado', str(log.call_args))
        self.assertNotIn('secreto', str(log.call_args))

    async def test_business_reason_preserved(self):
        with patch('request_diagnostics.logger.warning') as log:
            response = await self.app.exception_handlers[HTTPException](self.request, HTTPException(422,'El consumo debe ser posterior al corte del saldo inicial'))
        self.assertEqual(response.status_code, 422)
        self.assertIn('posterior al corte', str(log.call_args))

    async def test_other_status_not_logged_as_validation(self):
        with patch('request_diagnostics.logger.warning') as log:
            response = await self.app.exception_handlers[HTTPException](self.request, HTTPException(403,'Sin permiso'))
        self.assertEqual(response.status_code, 403)
        log.assert_not_called()
