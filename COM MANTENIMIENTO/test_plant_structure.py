from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
import pyodbc
import main
from plant_structure import PlantWrite, TowerWrite, register_plant_structure


class PlantStructureTests(unittest.TestCase):
    def setUp(self):
        self.connection=MagicMock();self.cursor=self.connection.cursor.return_value
        self.app=FastAPI();self.active=lambda:1;self.admin=lambda:9
        register_plant_structure(self.app,lambda:self.connection,self.active,self.admin)

    def endpoint(self,path,method):
        return next(r.endpoint for r in self.app.routes if r.path==path and method in r.methods)

    def test_permissions(self):
        for r in self.app.routes:
            if hasattr(r,'dependant'):
                self.assertIn(self.active if 'GET' in r.methods else self.admin,[d.call for d in r.dependant.dependencies])

    def test_names_and_identifiers(self):
        self.assertEqual(PlantWrite(name='  Samanga  ').name,'Samanga')
        with self.assertRaises(ValidationError):PlantWrite(name=' ')
        with self.assertRaises(ValidationError):TowerWrite(name='Torre 1',plant_id=0)
        self.assertIsNone(main.MachineWrite(asset_code='M1',name='Molino').tower_id)

    def test_tower_requires_existing_plant(self):
        self.cursor.execute.return_value.fetchone.return_value=None
        with self.assertRaises(HTTPException) as err:
            self.endpoint('/torres','POST')(TowerWrite(name='Torre 5',plant_id=1),usuario_id=9)
        self.assertEqual(err.exception.status_code,422)
        self.connection.commit.assert_not_called()
        self.connection.rollback.assert_called_once()

    def test_create_tower_keeps_selected_parent(self):
        self.cursor.execute.return_value.fetchone.side_effect=[(2,),(5,)]
        result=self.endpoint('/torres','POST')(TowerWrite(name='Torre 1',plant_id=2),usuario_id=9)
        self.assertEqual(result,{'tower_id':5,'plant_id':2,'name':'Torre 1'})
        self.connection.commit.assert_called_once()

    def test_cannot_move_tower_to_other_plant(self):
        self.cursor.execute.return_value.fetchone.return_value=(1,)
        with self.assertRaises(HTTPException) as err:
            self.endpoint('/torres/{tower_id}','PUT')(5,TowerWrite(name='Torre 5',plant_id=2),usuario_id=9)
        self.assertEqual(err.exception.status_code,422)
        self.connection.commit.assert_not_called()

    def test_delete_used_tower_reports_conflict(self):
        self.cursor.execute.side_effect=pyodbc.IntegrityError('FK_Machines_Tower')
        with self.assertRaises(HTTPException) as err:self.endpoint('/torres/{tower_id}','DELETE')(5,usuario_id=9)
        self.assertEqual(err.exception.status_code,409)
        self.connection.rollback.assert_called_once()

    def test_machine_rejects_unknown_tower_before_insert(self):
        self.cursor.execute.return_value.fetchone.side_effect=[None,None]
        with patch.object(main,'obtener_conexion',return_value=self.connection),self.assertRaises(HTTPException) as err:
            main.crear_maquina(main.MachineWrite(asset_code='M1',name='Molino',tower_id=99),usuario_id=9)
        self.assertEqual(err.exception.status_code,422)
        self.assertFalse(any('INSERT INTO' in c.args[0] for c in self.cursor.execute.call_args_list))

    def test_edit_preserves_assignment_when_old_client_omits_field(self):
        for payload,expect_assignment in [({},False),({'tower_id':None},True),({'tower_id':5},True)]:
            with self.subTest(payload=payload):
                self.cursor.reset_mock()
                self.cursor.execute.return_value.fetchone.side_effect=[SimpleNamespace(MachineImagePath=None),None]+([(5,)] if payload.get('tower_id') else [])+[('record',)]
                with patch.object(main,'obtener_conexion',return_value=self.connection),patch.object(main,'machine_record',return_value={'machine_id':1}):
                    main.actualizar_maquina(1,main.MachineWrite(asset_code='M1',name='Molino',**payload),usuario_id=9)
                update=next(c.args for c in self.cursor.execute.call_args_list if c.args[0].startswith('UPDATE dbo.Machines'))
                self.assertEqual('TowerId = ?' in update[0],expect_assignment)
                if expect_assignment:self.assertEqual(update[1],payload['tower_id'])


if __name__=='__main__':unittest.main()
