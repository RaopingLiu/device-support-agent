"""历史索引查询与旧会话恢复：使用临时数据库，不访问模型服务。"""
from fastapi.testclient import TestClient
from app import db, tickets
from app.main import app
from test_business import payload


def test_history_searches_full_conversation_and_restores_saved_data(store):
    evidence={'chunk_id':'example-1','text':'检查上联端口','title':'排障示例','source_url':'https://example.com/guide','section':'上联','source_type':'internal'}
    db.add_message(store,'user',{'reply':'杭州仓库网络异常'})
    db.add_message(store,'assistant',{'reply':'请检查 S01-AP04 上联端口。','citations':[evidence],'trace':[{'tool':'get_device_status'}]})
    db.add_message(store,'user',{'reply':'重新插好网线后恢复了，后续观察。'})
    draft=tickets.prepare(store,payload())
    draft=tickets.mutate(store,draft['draft_id'],1,'edit',{**payload(),'impact':'仓库扫码作业'})
    other=db.new_session('normal')
    db.add_message(other,'user',{'reply':'检查办公区设备'})
    with TestClient(app) as client:
        result=client.get('/api/sessions',params={'q':'s01-ap04'}).json()
        assert result['total']==1
        item=result['sessions'][0]
        assert item['session_id']==store and item['title']=='杭州仓库网络异常'
        assert item['preview']=='重新插好网线后恢复了，后续观察。'
        assert item['message_count']==3 and item['has_draft'] is True
        assert item['ticket_count']==0 and 'messages' not in item
        restored=client.get(f'/api/sessions/{store}').json()
        assert restored['scenario_id']=='ap_offline'
        assert restored['messages'][1]['citations']==[evidence]
        assert restored['messages'][1]['trace']==[{'tool':'get_device_status'}]
        assert restored['draft']==draft
        assert client.get(f'/api/sessions/{other}').json()['draft'] is None
        assert client.get('/api/sessions',params={'q':"' OR 1=1 --"}).json()['total']==0
        assert client.get('/api/sessions',params={'q':'不存在'}).json()['sessions']==[]
        for params in [{'offset':-1},{'limit':0},{'limit':51},{'q':'x'*201}]:
            assert client.get('/api/sessions',params=params).status_code==422


def test_history_sorting_pagination_and_existing_empty_sessions(store):
    other=db.new_session('normal')
    empty=db.new_session('wan_down')
    db.add_message(store,'user',{'reply':'AP 离线'})
    db.add_message(other,'user',{'reply':'出口异常'})
    draft=tickets.prepare(store,payload())
    ticket=tickets.mutate(store,draft['draft_id'],1,'confirm')
    with db.connect() as c:
        c.execute("UPDATE sessions SET created_at='2026-01-01T00:00:00+00:00'")
        c.execute("UPDATE messages SET created_at='2026-01-02T00:00:00+00:00'")
        c.execute("UPDATE ticket_drafts SET updated_at='2026-01-03T00:00:00+00:00'")
        c.execute("UPDATE tickets SET created_at='2026-01-04T00:00:00+00:00'")
    # 重复初始化应保留此前的会话、消息和工单。
    db.init_db()
    with TestClient(app) as client:
        first=client.get('/api/sessions',params={'limit':2}).json()
        second=client.get('/api/sessions',params={'limit':2,'offset':first['next_offset']}).json()
        assert first['total']==3 and second['next_offset'] is None
        assert [r['session_id'] for r in first['sessions']+second['sessions']]==[store,other,empty]
        saved=first['sessions'][0]
        assert saved['ticket_count']==1 and saved['has_draft'] is False
        assert saved['updated_at']=='2026-01-04T00:00:00+00:00'
        blank=second['sessions'][0]
        assert blank['title']=='新会话' and blank['preview']=='' and blank['message_count']==0
        assert client.get(f'/api/sessions/{store}/tickets').json()['tickets'][0]['ticket_id']==ticket['ticket_id']
        assert client.get('/api/sessions',params={'offset':100}).json()['sessions']==[]


def test_continue_old_session_restores_its_model_context_after_restart(store,monkeypatch):
    from langchain_core.messages import AIMessage, HumanMessage
    from app.graph import Assistant

    observed=[]
    class RecordingModel:
        def __init__(self,**kwargs): pass
        def bind_tools(self,tools): return self
        def invoke(self,messages):
            observed.append([m.content for m in messages if isinstance(m,HumanMessage)])
            return AIMessage(content='测试替身回复')

    monkeypatch.setattr('app.graph.ChatOpenAI',RecordingModel)
    monkeypatch.setattr('app.graph.config.model_config',lambda:{'api_key':'test','model':'test'})
    other=db.new_session('normal')
    agent=Assistant()
    try:
        agent.run(store,'上次排查的是仓储区 AP')
        agent.run(other,'另一个会话在检查出口网关')
    finally:
        agent.close()
    agent=Assistant()
    try:
        agent.run(store,'继续上次的 AP 排查')
        assert observed[-1]==['上次排查的是仓储区 AP','继续上次的 AP 排查']
    finally:
        agent.close()
