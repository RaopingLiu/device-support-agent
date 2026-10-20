# HTTP 入口：接收网页请求，协调 Agent 和业务模块，返回结构化结果。
import logging
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from . import config, db, tickets
from .tools import device_search, device_status, device_neighbors

assistant=None
locks={}
locks_guard=threading.Lock()

# 单进程内每会话复用锁，防止聊天和草稿操作同时改同一会话。
def session_lock(sid):
    db.session(sid)
    with locks_guard: return locks.setdefault(sid,threading.Lock())

# 生命周期：启动时初始化数据/Agent，停止时释放检查点和编码进程。
@asynccontextmanager
async def lifespan(app):
    global assistant
    from .graph import Assistant
    db.seed(); assistant=Assistant()
    yield
    assistant.close()
    from .rag import embedder
    embedder.close()

app=FastAPI(title='网域 · 网络运维助手',lifespan=lifespan)
# 给浏览器提供 CSS 和 JavaScript 静态文件。
app.mount('/static',StaticFiles(directory=config.ROOT/'app/static'),name='static')

# 业务异常映射为 HTTP：冲突 409、不存在 404、参数错误 422。
@app.exception_handler(tickets.Conflict)
async def conflict_handler(request,exc): return JSONResponse(status_code=409,content={'detail':str(exc)})
@app.exception_handler(LookupError)
async def missing_handler(request,exc): return JSONResponse(status_code=404,content={'detail':str(exc)})
@app.exception_handler(ValueError)
async def invalid_handler(request,exc): return JSONResponse(status_code=422,content={'detail':str(exc)[:300]})

# 页面与辅助接口：首页、应用存活、自建 SOP 和概览。
@app.get('/')
def index(): return FileResponse(config.ROOT/'app/static/index.html')

@app.get('/health')
# 只检查应用响应，未实时检测模型或 Milvus。
def health(): return {'status':'ok','layer':'application','simulated':True}

@app.get('/api/knowledge/internal-sop')
def internal_sop(): return FileResponse(config.ROOT/'data/docs/internal-sop.md',media_type='text/plain; charset=utf-8')

@app.get('/api/overview')
# 读取资产数与最近索引记录；索引文件存在不证明服务当前在线。
def overview():
    import json
    with db.connect() as c:
        sites=[dict(r) for r in c.execute('SELECT * FROM sites ORDER BY site_id')]
        count=c.execute('SELECT count(*) FROM devices').fetchone()[0]
    index=config.RUNTIME/'index.json'
    knowledge=json.loads(index.read_text(encoding='utf-8')) if index.exists() else {'chunks':0}
    return {'sites':sites,'device_count':count,'scenarios':db.SCENARIOS,'knowledge':{'chunks':knowledge['chunks'],'indexed':index.exists()}}

# 请求体模型由 Pydantic 校验类型、长度和版本范围。
class NewSession(BaseModel): scenario_id: str='ap_offline'
class Message(BaseModel): message: str=Field(min_length=1,max_length=4000)
class Revision(BaseModel): expected_revision: int=Field(ge=1)
class Edit(Revision): payload: tickets.DraftPayload

# 新会话绑定场景；恢复会话接口返回网页历史与最新草稿。
@app.post('/api/sessions')
def create_session(body:NewSession): return {'session_id':db.new_session(body.scenario_id)}

@app.get('/api/sessions/{sid}')
def get_session(sid:str):
    return {**db.session(sid),'messages':db.history(sid),'draft':tickets.current(sid)}

@app.get('/api/sessions/{sid}/devices')
# 设备列表直接查 SQL，无需调用模型。
def devices(sid:str,site_id:str='',device_type:str='',q:str=Query('',max_length=100),
            offset:int=Query(0,ge=0),limit:int=Query(20,ge=1,le=50)):
    db.session(sid)
    return device_search(site_id=site_id,device_type=device_type,q=q,offset=offset,limit=limit)

@app.get('/api/sessions/{sid}/devices/{device_id}')
def device_detail(sid:str,device_id:str):
    session=db.session(sid)
    found=device_search(device_id=device_id)['devices']
    if not found: raise LookupError('设备不存在')
    return {'device':found[0],'status':device_status(session['scenario_id'],device_id),
            'neighbors':device_neighbors(device_id)}

@app.get('/api/sessions/{sid}/tickets')
def ticket_list(sid:str,offset:int=Query(0,ge=0),limit:int=Query(20,ge=1,le=50)):
    return tickets.list_for_session(sid,limit,offset)

@app.post('/api/sessions/{sid}/messages')
# 聊天入口：存用户消息→运行图→存回答→返回网页。
def send(sid:str,body:Message):
    if not body.message.strip(): raise ValueError('消息不能为空')
    lock=session_lock(sid)
    if not lock.acquire(blocking=False): raise HTTPException(409,'此会话正在处理，请稍后再试')  # 忙碌时直接返回冲突，避免排队执行过期操作。
    try:
        db.add_message(sid,'user',{'reply':body.message})
        result=assistant.run(sid,body.message)  # 进入 graph.py 的模型/工具循环。
        db.add_message(sid,'assistant',result)
        return result
    except Exception as exc:
        logging.getLogger(__name__).error('Conversation failed: %s',type(exc).__name__)
        raise HTTPException(503,'流程执行失败，请稍后重试；请查询当前草稿和工单状态') from exc
    finally: lock.release()  # 失败时也释放锁，避免一直忙碌。

# 网页工单按钮绕过模型，直接执行受校验的业务操作。
def draft_action(sid,did,revision,action,payload=None):
    lock=session_lock(sid)
    if not lock.acquire(blocking=False): raise HTTPException(409,'此会话正在处理，请稍后再试')  # 忙碌时直接返回冲突，避免排队执行过期操作。
    try:
        result=tickets.mutate(sid,did,revision,action,payload)
        if action=='confirm':
            db.add_message(sid,'system',{'reply':'工单已保存：'+result['ticket_id'],'ticket':result})
        return result
    finally: lock.release()  # 失败时也释放锁，避免一直忙碌。

# 修改、确认、取消三个接口都携带当前草稿版本。
@app.patch('/api/sessions/{sid}/drafts/{did}')
def edit(sid:str,did:str,body:Edit): return draft_action(sid,did,body.expected_revision,'edit',body.payload.model_dump())
@app.post('/api/sessions/{sid}/drafts/{did}/confirm')
def confirm(sid:str,did:str,body:Revision): return draft_action(sid,did,body.expected_revision,'confirm')
@app.post('/api/sessions/{sid}/drafts/{did}/cancel')
def cancel(sid:str,did:str,body:Revision): return draft_action(sid,did,body.expected_revision,'cancel')
@app.get('/api/sessions/{sid}/tickets/{tid}')
def ticket(sid:str,tid:str):
    db.session(sid)
    return tickets.get(sid,tid)
