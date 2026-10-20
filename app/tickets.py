# 工单业务：模型整理草稿，用户通过网页确认后才创建正式记录。
import json
from pydantic import BaseModel, Field
from . import db

# Pydantic 校验字段和长度；站点设备事实由 validate 查询数据库核对。
class DraftPayload(BaseModel):
    site_id: str = Field(min_length=1,max_length=50)
    area: str = Field(default='',max_length=100)
    summary: str = Field(min_length=3,max_length=120)
    description: str = Field(min_length=5,max_length=3000)
    impact: str = Field(default='待确认',max_length=300)
    device_ids: list[str] = Field(default_factory=list,max_length=20)
    checks: list[str] = Field(default_factory=list,max_length=20)

# 业务冲突，例如旧版本提交；main.py 将其转为 HTTP 409。
class Conflict(ValueError): pass

# 检查站点存在、设备属于该站点，防止跨站点串单。
def validate(c, payload):
    data=DraftPayload.model_validate(payload).model_dump()
    if not c.execute('SELECT 1 FROM sites WHERE site_id=?',(data['site_id'],)).fetchone():
        raise ValueError('站点不存在，请先查询并确认站点')
    data['device_ids']=list(dict.fromkeys(data['device_ids']))  # 保持顺序去重，避免重复设备关联。
    for did in data['device_ids']:
        if not c.execute('SELECT 1 FROM devices WHERE device_id=? AND site_id=?',(did,data['site_id'])).fetchone():
            raise ValueError('关联设备不存在或不属于当前站点')
    return data

# 数据库行转字典，并把 JSON 正文还原成对象。
def unpack(row):
    if not row: return None
    r=dict(row); r['payload']=json.loads(r.pop('payload_json')); return r

# 只返回本会话最新 pending 草稿；已取消/提交的不再可确认。
def current(sid):
    with db.connect() as c:
        return unpack(c.execute("SELECT * FROM ticket_drafts WHERE session_id=? AND state='pending' ORDER BY created_at DESC LIMIT 1",(sid,)).fetchone())

# 新草稿从版本 1 开始，并使此前待确认草稿失效。
def prepare(sid,payload):
    with db.connect() as c:
        c.execute('BEGIN IMMEDIATE')  # 提前取得写事务协调竞争写入，异常由 db.connect 回滚。
        data=validate(c,payload)
        # 让旧 pending 草稿失效，旧页面按钮不能提交已被替换的报障目标。
        c.execute("UPDATE ticket_drafts SET state='cancelled',updated_at=? WHERE session_id=? AND state='pending'",(db.now(),sid))
        did=db.uid('D-'); timestamp=db.now()
        c.execute('INSERT INTO ticket_drafts VALUES(?,?,?,?,?,?,?)',(did,sid,1,db.dump(data),'pending',timestamp,timestamp))
        return unpack(c.execute('SELECT * FROM ticket_drafts WHERE draft_id=?',(did,)).fetchone())

# 修改/取消/确认统一入口：同一事务内核对归属、版本与状态再写入。
def mutate(sid,did,revision,action,payload=None):
    with db.connect() as c:
        c.execute('BEGIN IMMEDIATE')  # 提前取得写事务协调竞争写入，异常由 db.connect 回滚。
        row=c.execute('SELECT * FROM ticket_drafts WHERE draft_id=? AND session_id=?',(did,sid)).fetchone()
        if not row: raise LookupError('草稿不存在')
        # 乐观并发控制：旧页面不能确认已被修改的新草稿。
        if row['revision'] != revision: raise Conflict('草稿已更新，请刷新后确认当前版本')
        # 幂等确认：同版本重复提交返回原工单；数据库 UNIQUE 约束额外防重。
        if action=='confirm' and row['state']=='submitted':
            return unpack(c.execute('SELECT * FROM tickets WHERE draft_id=?',(did,)).fetchone())
        if row['state']!='pending': raise Conflict('草稿已取消或提交，不能再次修改或确认')
        if action=='cancel':
            c.execute("UPDATE ticket_drafts SET state='cancelled',updated_at=? WHERE draft_id=?",(db.now(),did))
        elif action=='edit':
            data=validate(c,payload)
            c.execute('UPDATE ticket_drafts SET payload_json=?,revision=revision+1,updated_at=? WHERE draft_id=?',(db.dump(data),db.now(),did))  # 保存修改递增版本，让旧确认请求失效。
        # 正式工单、设备关联和草稿状态一起提交；中途失败全部回滚。
        elif action=='confirm':
            data=validate(c,json.loads(row['payload_json']))
            tid=db.uid('T-')
            c.execute('INSERT INTO tickets VALUES(?,?,?,?,?,?,?)',(tid,did,revision,sid,db.dump(data),'open',db.now()))
            for device in data['device_ids']: c.execute('INSERT INTO ticket_devices VALUES(?,?)',(tid,device))
            c.execute("UPDATE ticket_drafts SET state='submitted',updated_at=? WHERE draft_id=?",(db.now(),did))
            return unpack(c.execute('SELECT * FROM tickets WHERE ticket_id=?',(tid,)).fetchone())
        else: raise ValueError('未知草稿操作')
        return unpack(c.execute('SELECT * FROM ticket_drafts WHERE draft_id=?',(did,)).fetchone())

# 查询时同时限定会话，避免读取其他会话工单。
def get(sid,tid):
    with db.connect() as c:
        row=c.execute('SELECT * FROM tickets WHERE ticket_id=? AND session_id=?',(tid,sid)).fetchone()
        if not row: raise LookupError('当前会话中没有该工单')
        return unpack(row)

# 工作台分页列表仅返回当前会话的正式工单。
def list_for_session(sid,limit=20,offset=0):
    db.session(sid)
    with db.connect() as c:
        total=c.execute('SELECT count(*) FROM tickets WHERE session_id=?',(sid,)).fetchone()[0]
        rows=c.execute('SELECT * FROM tickets WHERE session_id=? ORDER BY created_at DESC,ticket_id DESC LIMIT ? OFFSET ?',(sid,limit,offset)).fetchall()
    return {'tickets':[unpack(row) for row in rows],'total':total,
            'next_offset':offset+limit if offset+limit<total else None}

# 提供最近 5 份真实工单摘要，帮助模型理解“刚创建的工单”。
def recent(sid):
    with db.connect() as c:
        rows=c.execute('SELECT * FROM tickets WHERE session_id=? ORDER BY created_at DESC LIMIT 5',(sid,)).fetchall()
        return [{'ticket_id':r['ticket_id'],'summary':json.loads(r['payload_json'])['summary'],'status':r['status']} for r in rows]
