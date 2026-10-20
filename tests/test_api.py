# 接口测试：验证草稿/工单的 HTTP 流程和重建应用后的数据读取。
from fastapi.testclient import TestClient
from app import db,tickets
from app.main import app
from test_business import payload

# 模拟浏览器调用接口，核对编辑、确认、查询和应用重建后读取。
def test_api_draft_workflow_and_restart(store):
    d=tickets.prepare(store,payload())
    with TestClient(app) as client:
        assert client.get('/legacy').status_code==200
        assert client.get('/api/overview').json()['device_count']==140
        path=f'/api/sessions/{store}/drafts/{d["draft_id"]}'
        r=client.post(path+'/confirm',json={'expected_revision':2});assert r.status_code==409
        r=client.post(path+'/confirm',json={'expected_revision':1});assert r.status_code==200
        tid=r.json()['ticket_id']
        assert client.post(path+'/confirm',json={'expected_revision':1}).json()['ticket_id']==tid
    with TestClient(app) as client:
        assert client.get(f'/api/sessions/{store}/tickets/{tid}').json()['payload']['summary']=='仓储区无线掉线'
        assert client.get(f'/api/sessions/{store}').json()['draft'] is None
