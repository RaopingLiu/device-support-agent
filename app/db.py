# SQL 数据层：连接、建表、模拟数据、网页会话与消息，不调用模型。
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from . import config

# 时间统一保存为带时区的 UTC。
def now():
    return datetime.now(timezone.utc).isoformat()

# 会话/工单使用随机标识；设备编号在 seed 中按固定规则生成。
def uid(prefix):
    return prefix + uuid.uuid4().hex[:12].upper()

# 字典和列表转 JSON 文本，中文保持可读。
def dump(value):
    return json.dumps(value, ensure_ascii=False)

# with 管理连接：正常完成提交，异常回滚，最终关闭连接。
@contextmanager
def connect():
    conn = sqlite3.connect(config.DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')  # 每个连接都启用外键检查，防止关联不存在的记录。
    try:
        yield conn
        conn.commit()  # with 中全部操作正常结束才提交。
    except Exception:
        conn.rollback()  # 撤销本次事务尚未提交的改动。
        raise
    finally:
        conn.close()

# 只创建表结构；设备、网页会话与工单共用 business.db，但分表保存。
def init_db():
    with connect() as c:
        # SQL 分三组：设备/状态/关系；会话/消息；草稿/工单/关联设备。
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS sites(site_id TEXT PRIMARY KEY,name TEXT,city TEXT,site_type TEXT);
        CREATE TABLE IF NOT EXISTS devices(device_id TEXT PRIMARY KEY,site_id TEXT REFERENCES sites,
          area TEXT,name TEXT,device_type TEXT,vendor TEXT,model TEXT,firmware_version TEXT);
        CREATE INDEX IF NOT EXISTS device_location ON devices(site_id,area,device_type);
        CREATE TABLE IF NOT EXISTS device_links(link_id TEXT PRIMARY KEY,src_device_id TEXT REFERENCES devices,
          src_port TEXT,dst_device_id TEXT REFERENCES devices,dst_port TEXT,relation TEXT);
        CREATE TABLE IF NOT EXISTS device_status(scenario_id TEXT,device_id TEXT REFERENCES devices,
          online_state TEXT,observed_at TEXT,metrics_json TEXT,alarms_json TEXT,PRIMARY KEY(scenario_id,device_id));
        CREATE TABLE IF NOT EXISTS sessions(session_id TEXT PRIMARY KEY,scenario_id TEXT,created_at TEXT);
        CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT REFERENCES sessions,
          role TEXT,payload_json TEXT,created_at TEXT);
        CREATE TABLE IF NOT EXISTS ticket_drafts(draft_id TEXT PRIMARY KEY,session_id TEXT REFERENCES sessions,
          revision INTEGER,payload_json TEXT,state TEXT,created_at TEXT,updated_at TEXT);
        CREATE TABLE IF NOT EXISTS tickets(ticket_id TEXT PRIMARY KEY,draft_id TEXT UNIQUE REFERENCES ticket_drafts,
          draft_revision INTEGER,session_id TEXT REFERENCES sessions,payload_json TEXT,status TEXT,created_at TEXT);
        CREATE TABLE IF NOT EXISTS ticket_devices(ticket_id TEXT REFERENCES tickets,device_id TEXT REFERENCES devices,
          PRIMARY KEY(ticket_id,device_id));
        ''')

# 固定演示案例；同一设备在不同场景下可有不同状态。
SCENARIOS = {
    'normal': '设备记录正常 · 仍可能需要补充终端证据',
    'ap_offline': '杭州仓库 · 仓储区 AP 离线',
    'uplink_down': '杭州仓库 · 仓储交换机上联异常',
    'wan_down': '杭州仓库 · 出口连接异常',
}

# 首次按模板生成 10 站点，每站点 1 网关、1 控制器、3 交换机、9 AP。
def seed():
    init_db()
    cities = ['杭州','上海','北京','深圳','南京','苏州','成都','武汉','西安','广州']
    with connect() as c:
        # 已有任意设备就跳过；此函数不是重置或数据库迁移程序。
        if c.execute('SELECT count(*) FROM devices').fetchone()[0]:
            return
        observed = now()
        # 站点、设备、区域和关系按固定规则生成，便于重复验证。
        for i, city in enumerate(cities, 1):
            sid = f'S{i:02d}'
            name = city + ('仓库' if i == 1 else '分公司')
            c.execute('INSERT INTO sites VALUES(?,?,?,?)', (sid,name,city,'warehouse' if i==1 else 'office'))
            devices = [(f'{sid}-GW01','机房','gateway','ER605'),(f'{sid}-AC01','机房','controller','OC200')]
            devices += [(f'{sid}-SW{j:02d}', ['办公区','仓储区','会议区'][j-1], 'switch','TL-SG2210P') for j in range(1,4)]
            devices += [(f'{sid}-AP{j:02d}', ['办公区','仓储区','会议区'][(j-1)//3], 'ap','EAP225') for j in range(1,10)]
            for did, area, kind, model in devices:
                c.execute('INSERT INTO devices VALUES(?,?,?,?,?,?,?,?)', (did,sid,area,did,kind,'TP-Link',model,'未采集'))
                # 每台设备保存四份预设快照；没有轮询真实设备或持续更新。
                for scenario in SCENARIOS:
                    online, metrics, alarms = 'online', {}, []
                    if kind=='ap': metrics={'associated_clients':12,'uplink':'up'}
                    if kind=='switch': metrics={'uplink':'up','poe':'on'}
                    if kind=='gateway': metrics={'wan_link':'up','wan_address_assigned':True}
                    # 只注入已知离线现象，不直接断言供电或硬件损坏。
                    if scenario=='ap_offline' and did=='S01-AP04':
                        online, alarms = 'offline', ['模拟记录：设备心跳缺失；断电或链路原因尚未确认']
                        metrics={'associated_clients':None,'uplink':'unknown'}
                    if scenario=='uplink_down' and did=='S01-SW02':
                        metrics['uplink']='down'; alarms=['模拟记录：上联端口 link down']
                    # 管理不可达记为 unknown，不把未知当作正常。
                    if scenario=='uplink_down' and did in ['S01-AP04','S01-AP05','S01-AP06']:
                        online='unknown'; alarms=['模拟记录：管理不可达，不能据此确定 AP 硬件故障']
                        metrics={'associated_clients':None,'uplink':'unknown'}
                    if scenario=='wan_down' and did=='S01-GW01':
                        metrics={'wan_link':'down','wan_address_assigned':False}; alarms=['模拟记录：WAN 物理链路 down']
                    c.execute('INSERT INTO device_status VALUES(?,?,?,?,?,?)',(scenario,did,online,observed,dump(metrics),dump(alarms)))
            # 先建立交换机到网关的上联，再建立 AP 上联及逻辑管理关系。
            for j in range(1,4):
                c.execute('INSERT INTO device_links VALUES(?,?,?,?,?,?)',(f'{sid}-L-SW{j}',f'{sid}-SW{j:02d}','uplink',f'{sid}-GW01',f'LAN{j}','uplink'))
            for j in range(1,10):
                sw=(j-1)//3+1
                c.execute('INSERT INTO device_links VALUES(?,?,?,?,?,?)',(f'{sid}-L-AP{j}',f'{sid}-AP{j:02d}','eth0',f'{sid}-SW{sw:02d}',f'port{(j-1)%3+1}','uplink'))
                c.execute('INSERT INTO device_links VALUES(?,?,?,?,?,?)',(f'{sid}-M-AP{j}',f'{sid}-AP{j:02d}',None,f'{sid}-AC01',None,'managed_by'))

# 会话绑定一个演示场景，新建会话时选择生效。
def new_session(scenario):
    if scenario not in SCENARIOS: raise ValueError('未知模拟案例')
    sid=uid('CHAT-')
    with connect() as c: c.execute('INSERT INTO sessions VALUES(?,?,?)',(sid,scenario,now()))
    return sid

# 先验证会话存在，避免误用其他会话数据。
def session(sid):
    with connect() as c:
        row=c.execute('SELECT * FROM sessions WHERE session_id=?',(sid,)).fetchone()
        if not row: raise LookupError('会话不存在')
        return dict(row)

# 网页历史存这里；模型与工具的图状态另存 checkpoints.db。
def add_message(sid, role, payload):
    with connect() as c: c.execute('INSERT INTO messages(session_id,role,payload_json,created_at) VALUES(?,?,?,?)',(sid,role,dump(payload),now()))

# 按写入顺序恢复网页消息，供刷新页面使用。
def history(sid):
    session(sid)
    with connect() as c:
        return [{'role':r['role'],**json.loads(r['payload_json'])} for r in c.execute('SELECT * FROM messages WHERE session_id=? ORDER BY id',(sid,))]
