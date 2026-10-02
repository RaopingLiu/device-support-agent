# 工具层：Python 执行真实操作，LangChain 包装函数签名和说明供模型选择。
import json
from langchain_core.tools import StructuredTool
from . import db, tickets, rag

# 统一结果形状，区分成功、未找到和执行错误。
def ok(data): return {'status':'ok','data':data,'error':None}
def failure(code,message): return {'status':'error','data':None,'error':{'code':code,'message':message}}

# 资产查询共用函数：字段白名单、参数绑定、分页，不允许模型自由生成 SQL。
def device_search(site_id='',area='',device_type='',device_id='',limit=20,offset=0):
    clauses=[]; args=[]
    for field,value in [('site_id',site_id),('area',area),('device_type',device_type),('device_id',device_id)]:
        if value: clauses.append(field+'=?'); args.append(value)  # 用户值通过占位符绑定，不拼成 SQL。
    where=' WHERE '+' AND '.join(clauses) if clauses else ''
    # 限制返回量，避免设备列表撑满上下文。
    limit=max(1,min(int(limit),50)); offset=max(0,int(offset))
    with db.connect() as c:
        total=c.execute('SELECT count(*) FROM devices'+where,args).fetchone()[0]
        rows=c.execute('SELECT * FROM devices'+where+' ORDER BY device_id LIMIT ? OFFSET ?',args+[limit,offset]).fetchall()
    return {'devices':[dict(r) for r in rows],'total':total,'next_offset':offset+limit if offset+limit<total else None}

# 服务端按会话构建工具，场景通过闭包注入，不让模型自行指定。
def make_tools(sid):
    scenario=db.session(sid)['scenario_id']  # 可信服务端状态，工具参数不暴露场景 ID。

    # 把城市或站点名映射为站点 ID，多匹配时需要澄清。
    def find_sites(name_or_city: str = '') -> dict:
        """查询站点 ID、名称与城市。多个匹配时让用户选择，不自动猜测站点。"""
        with db.connect() as c:
            rows=c.execute('SELECT * FROM sites WHERE instr(name,?)>0 OR instr(city,?)>0 ORDER BY site_id',(name_or_city,name_or_city)).fetchall()
        return ok([dict(r) for r in rows])

    # 设备事实查 SQL，不用向量相似度猜测编号和型号。
    def find_devices(site_id: str = '', area: str = '', device_type: str = '', device_id: str = '', limit: int = 20, offset: int = 0) -> dict:
        """精确查询设备资产。类型为 ap/switch/gateway/controller；area 为办公区/仓储区/会议区/机房。返回型号，不查询知识库。分页最多50条。"""
        return ok(device_search(site_id,area,device_type,device_id,limit,offset))

    # 查当前案例的带时间快照，未找到记录不等于网络或数据库失败。
    def get_device_status(device_id: str) -> dict:
        """查询本会话模拟案例下的设备状态快照。online 不证明历史无故障；必须说明时间与模拟属性。"""
        with db.connect() as c:
            row=c.execute('SELECT * FROM device_status WHERE scenario_id=? AND device_id=?',(scenario,device_id)).fetchone()
        if not row: return {'status':'not_found','data':None,'error':{'code':'DEVICE_NOT_FOUND','message':'设备不存在或无状态记录'}}
        data=dict(row); data['metrics']=json.loads(data.pop('metrics_json')); data['alarms']=json.loads(data.pop('alarms_json')); data['is_simulated']=True
        return ok(data)

    # 只返回一跳关系；物理上联与控制器管理关系分开标记。
    def get_device_neighbors(device_id: str, relation: str = '') -> dict:
        """查询一跳设备关系与端口。relation 可为 uplink 或 managed_by；区分物理上联和控制器管理。"""
        with db.connect() as c:
            if not c.execute('SELECT 1 FROM devices WHERE device_id=?',(device_id,)).fetchone():
                return {'status':'not_found','data':None,'error':{'code':'DEVICE_NOT_FOUND','message':'设备不存在'}}
            rows=c.execute('SELECT * FROM device_links WHERE (src_device_id=? OR dst_device_id=?) AND (?="" OR relation=?)',(device_id,device_id,relation,relation)).fetchall()
        return ok([dict(r) for r in rows])

    # RAG 入口只查资料；底层编码和向量搜索交给 rag.py。
    def search_knowledge(query: str, device_type: str = '', model: str = '', top_k: int = 5) -> dict:
        """仅检索手册、故障指南与内部 SOP，不查设备状态。已知型号请提供；通用概念通常不必检索。返回片段可能不足以回答，不能编造。"""
        return ok(rag.search(query,device_type,model,top_k))

    # 只生成草稿；正式提交不在模型工具列表中。
    def prepare_ticket_draft(site_id: str, summary: str, description: str, area: str = '', impact: str = '待确认', device_ids: list[str] = [], checks: list[str] = []) -> dict:
        """仅在用户明确要求报障/工单时整理草稿。不会创建正式工单。checks 仅记录用户确认做过的检查，不能把建议当作已执行。"""
        return ok(tickets.prepare(sid,{'site_id':site_id,'summary':summary,'description':description,'area':area,'impact':impact,'device_ids':device_ids,'checks':checks}))

    # 查询限定当前会话；会话隔离不等同生产身份认证。
    def get_ticket(ticket_id: str) -> dict:
        """查询当前会话已保存的正式工单。只有数据库返回记录才能说创建成功。"""
        return ok(tickets.get(sid,ticket_id))

    # 由函数名、类型标注和 docstring 生成声明与参数校验；这行不执行工具。
    return [StructuredTool.from_function(f) for f in [find_sites,find_devices,get_device_status,get_device_neighbors,search_knowledge,prepare_ticket_draft,get_ticket]]
