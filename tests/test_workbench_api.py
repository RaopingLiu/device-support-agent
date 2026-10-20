"""工作台真实数据库接口：页面查询不调用模型，仍遵守会话和场景边界。"""
from fastapi.testclient import TestClient
from app import db, tickets
from app.main import app
from test_business import payload


def test_device_detail_uses_session_scenario(store):
    normal = db.new_session('normal')
    with TestClient(app) as client:
        path = '/api/sessions/{}/devices/S01-AP04'
        offline = client.get(path.format(store)).json()
        online = client.get(path.format(normal)).json()
        assert offline['status']['online_state'] == 'offline'
        assert online['status']['online_state'] == 'online'
        assert offline['status']['is_simulated'] is True
        assert offline['device']['model'] == 'EAP225'
        assert {x['relation'] for x in offline['neighbors']} == {'uplink', 'managed_by'}
        assert client.get('/api/sessions/missing/devices/S01-AP04').status_code == 404
        assert client.get(f'/api/sessions/{store}/devices/FAKE').status_code == 404


def test_device_filters_search_and_pagination(store):
    with TestClient(app) as client:
        path = f'/api/sessions/{store}/devices'
        first = client.get(path, params={'site_id':'S01','device_type':'ap','q':'eap225','limit':5}).json()
        second = client.get(path, params={'site_id':'S01','device_type':'ap','q':'eap225','limit':5,'offset':first['next_offset']}).json()
        assert first['total'] == 9 and len(second['devices']) == 4
        assert not {x['device_id'] for x in first['devices']} & {x['device_id'] for x in second['devices']}
        assert second['next_offset'] is None
        assert client.get(path, params={'q':"' OR 1=1 --"}).json()['total'] == 0
        assert client.get(path, params={'offset':-1}).status_code == 422
        assert client.get(path, params={'limit':51}).status_code == 422


def test_ticket_list_only_includes_confirmed_session_tickets(store):
    other = db.new_session('normal')
    for sid in [store,store,store,other]:
        draft = tickets.prepare(sid,payload())
        tickets.mutate(sid,draft['draft_id'],1,'confirm')
    tickets.prepare(store,payload())
    with TestClient(app) as client:
        path = f'/api/sessions/{store}/tickets'
        first = client.get(path, params={'limit':2}).json()
        second = client.get(path, params={'limit':2,'offset':first['next_offset']}).json()
        assert first['total'] == 3 and len(second['tickets']) == 1
        assert second['next_offset'] is None
        all_tickets = first['tickets'] + second['tickets']
        assert len({x['ticket_id'] for x in all_tickets}) == 3
        assert all(x['session_id'] == store for x in all_tickets)
        tid = all_tickets[0]['ticket_id']
        assert client.get(f'/api/sessions/{other}/tickets/{tid}').status_code == 404
        assert client.get('/api/sessions/missing/tickets').status_code == 404
        assert client.get(path, params={'offset':-1}).status_code == 422
