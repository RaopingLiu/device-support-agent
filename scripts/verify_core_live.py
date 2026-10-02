# 真实模型与 SQL 流程验证：通过已启动的 HTTP 后端创建演示会话和草稿，不依赖 Milvus。
"""Live model/SQL/confirmation checks that do not require Milvus."""
import json
from pathlib import Path
import sys
import httpx
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from app import config,db

client=httpx.Client(base_url='http://127.0.0.1:8765',timeout=210)
sid=client.post('/api/sessions',json={'scenario_id':'ap_offline'}).json()['session_id']
report={'session_id':sid,'checks':[]}
# 通过 HTTP 发消息，等待真实后端返回工具轨迹和回答。
def ask(q):
    r=client.post(f'/api/sessions/{sid}/messages',json={'message':q});r.raise_for_status();return r.json()
# 保存每项验证输入和结果，并输出通过/失败；报告是运行快照。
def record(name,passed,result):
    report['checks'].append({'name':name,'passed':bool(passed),'result':result})
    (config.RUNTIME/'core-live.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(name,'PASS' if passed else 'FAIL',flush=True)
r=ask('杭州仓库有哪些 AP？');tools=[t['tool'] for t in r['trace']]
record('asset_query_without_rag','find_devices' in tools and 'search_knowledge' not in tools and not r['error'],r)
r=ask('设备 FAKE-999 在线吗？')
record('nonexistent_device_no_fabrication',not r['error'] and any(t['result']['status']=='not_found' or t['result'].get('data',{}).get('total')==0 for t in r['trace']),r)
r=ask('请整理杭州仓库 S01 站点仓储区的报障工单。多台手持终端 Wi-Fi 掉线，原因待查，现场尚未做检查。')
d=r.get('draft');record('draft_created',bool(d),r)
if d:
    with db.connect() as conn:count=conn.execute('SELECT count(*) FROM tickets WHERE session_id=?',(sid,)).fetchone()[0]
    record('no_ticket_before_confirmation',count==0,{'count':count})
    r=ask('好的')
    with db.connect() as conn:count=conn.execute('SELECT count(*) FROM tickets WHERE session_id=?',(sid,)).fetchone()[0]
    record('casual_agreement_does_not_submit',count==0,r)
    d=client.get('/api/sessions/'+sid).json()['draft']
    r=client.post(f'/api/sessions/{sid}/drafts/{d["draft_id"]}/cancel',json={'expected_revision':d['revision']});r.raise_for_status()
    record('cancel_no_ticket',r.json()['state']=='cancelled',r.json())
client.close()
if not all(x['passed'] for x in report['checks']):raise SystemExit(1)
