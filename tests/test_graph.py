# 图测试：用明确的假模型稳定触发调用/失败分支，不代表真实模型的能力评测。
from langchain_core.messages import AIMessage,ToolMessage
from app import db
from app.graph import Assistant

# 测试替身：第一次固定要求查状态，收到工具消息后固定返回回答。
class FakeModel:
    seen=[]
    def __init__(self,**kwargs):pass
    def bind_tools(self,tools):return self
    def invoke(self,messages):
        self.seen=messages
        if isinstance(messages[-1],ToolMessage):return AIMessage(content='设备记录已查询，状态为模拟快照。')
        return AIMessage(content='',tool_calls=[{'name':'get_device_status','args':{'device_id':'S01-AP04'},'id':'test-call','type':'tool_call'}])

# 验证程序确实执行工具，并把 SQL 结果交回模型节点。
def test_graph_executes_tool_and_feeds_result_back(store,monkeypatch):
    monkeypatch.setattr('app.graph.ChatOpenAI',FakeModel)
    monkeypatch.setattr('app.graph.config.model_config',lambda:{'api_key':'test','model':'test'})
    agent=Assistant()
    try:
        result=agent.run(store,'S01-AP04 在线吗？')
        assert [x['tool'] for x in result['trace']]==['get_device_status']
        assert result['trace'][0]['result']['data']['online_state']=='offline'
        assert result['reply']=='设备记录已查询，状态为模拟快照。'
    finally:agent.close()

# 模拟模型超时，核对无正式工单产生且错误不泄露服务商细节。
def test_model_failure_does_not_create_ticket(store,monkeypatch):
    class Broken(FakeModel):
        def invoke(self,messages):raise TimeoutError('private provider details')
    monkeypatch.setattr('app.graph.ChatOpenAI',Broken)
    monkeypatch.setattr('app.graph.config.model_config',lambda:{'api_key':'test','model':'test'})
    agent=Assistant()
    try:
        r=agent.run(store,'帮我创建工单')
        assert r['error']['code']=='MODEL_UNAVAILABLE';assert 'private' not in r['reply']
        with db.connect() as c:assert c.execute('SELECT count(*) FROM tickets').fetchone()[0]==0
    finally:agent.close()

# 关闭并重建 Agent，检查工具消息和会话状态仍在检查点中。
def test_checkpoint_survives_recreation(store,monkeypatch):
    monkeypatch.setattr('app.graph.ChatOpenAI',FakeModel)
    monkeypatch.setattr('app.graph.config.model_config',lambda:{'api_key':'test','model':'test'})
    agent=Assistant();agent.run(store,'S01-AP04 在线吗？');agent.close()
    agent=Assistant()
    try:
        state=agent.graph.get_state({'configurable':{'thread_id':store}})
        assert any(isinstance(m,ToolMessage) for m in state.values['messages'])
        assert state.values['session_id']==store
    finally:agent.close()
