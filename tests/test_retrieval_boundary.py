# 检索边界测试：未知型号、索引缺失、依赖失败和无效引用不能伪装成正常证据。
from app import rag
from app.graph import Assistant
from langchain_core.messages import AIMessage,ToolMessage

# 未知型号或类型冲突应在编码前拒绝，不能套用其他产品资料。
def test_unknown_model_does_not_use_other_product_documents(monkeypatch):
    monkeypatch.setattr(rag.embedder,'encode',lambda _: (_ for _ in ()).throw(AssertionError('must not encode')))
    assert rag.search('如何恢复出厂设置','ap','OTHER-VENDOR-999')==[]
    assert rag.search('如何排查','switch','EAP225')==[]

# 索引尚未创建必须报依赖错误，不能当作正常无命中。
def test_missing_index_is_explicit_failure(tmp_path,monkeypatch):
    monkeypatch.setattr(rag,'RUNTIME',tmp_path)
    try:rag.search('AP 掉线','ap','EAP225')
    except rag.DependencyError as exc:assert '尚未完成入库' in str(exc)
    else:raise AssertionError('missing index must not be an empty successful search')

# 制造检索失败和编造引用，检查错误传递及来源 ID 核对。
def test_graph_surfaces_retrieval_failure_and_rejects_fake_citation(store,monkeypatch):
    class Model:
        def __init__(self,**kwargs):pass
        def bind_tools(self,tools):return self
        def invoke(self,messages):
            if isinstance(messages[-1],ToolMessage):return AIMessage(content='资料查询失败。[来源:invented]')
            return AIMessage(content='',tool_calls=[{'name':'search_knowledge','args':{'query':'AP 掉线'},'id':'search','type':'tool_call'}])
    monkeypatch.setattr('app.graph.ChatOpenAI',Model)
    monkeypatch.setattr('app.graph.config.model_config',lambda:{'api_key':'test','model':'test'})
    monkeypatch.setattr(rag,'search',lambda *a,**k:(_ for _ in ()).throw(rag.DependencyError('unavailable')))
    agent=Assistant()
    try:
        r=agent.run(store,'AP 掉线怎么办')
        assert r['trace'][0]['result']['status']=='error'
        assert r['trace'][0]['result']['error']['code']=='DEPENDENCY_UNAVAILABLE'
        assert r['citations']==[] and '来源未通过核对' in r['reply']
    finally:agent.close()
