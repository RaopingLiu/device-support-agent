# 完整真实依赖验证：需要后端、模型和 Milvus，会创建演示会话并确认保存本地工单。
"""Explicit live integration checks. Sends only simulated questions to configured model."""
import json
import sys
import time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import httpx
from app import config,rag

def main():
    report={'checks':[]}
    # 保存每项验证输入和结果，并输出通过/失败；报告是运行快照。
    def record(name,passed,details):
        report['checks'].append({'name':name,'passed':bool(passed),'details':details})
        print(name,'PASS' if passed else 'FAIL',flush=True)
        (config.RUNTIME/'live-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    client=httpx.Client(base_url='http://127.0.0.1:8765',timeout=210)
    hits=rag.search('AP offline power supply LED Ethernet troubleshooting','ap','EAP225')
    record('milvus_semantic_search',bool(hits) and any(x['source_type']=='official_faq' for x in hits),[{'title':x['title'],'score':x['score'],'chunk_id':x['chunk_id']} for x in hits])
    record('unknown_model_no_cross_product_evidence',rag.search('reset configuration','ap','UNKNOWN-999')==[],{})
    sid=client.post('/api/sessions',json={'scenario_id':'ap_offline'}).json()['session_id']
    report['session_id']=sid
    # 通过 HTTP 发消息，等待真实后端返回工具轨迹和回答。
    def ask(question):
        t=time.monotonic();r=client.post(f'/api/sessions/{sid}/messages',json={'message':question});r.raise_for_status();data=r.json();data['elapsed_seconds']=round(time.monotonic()-t,2);return data
    result=ask('杭州仓库有哪些 AP？')
    names=[x['tool'] for x in result['trace']]
    record('live_model_sql_only',not result['error'] and 'find_devices' in names and 'search_knowledge' not in names,result)
    result=ask('S01-AP04 在线吗？')
    found=[x for x in result['trace'] if x['tool']=='get_device_status']
    record('live_model_status_tool_return',any(x['result'].get('data',{}).get('online_state')=='offline' for x in found) and not result['error'],result)
    result=ask('这个 AP 离线应该先检查什么？请查资料并给出来源。')
    record('live_model_rag_citations',not result['error'] and bool(result['citations']) and any(x['tool']=='search_knowledge' for x in result['trace']),result)
    result=ask('现场还没有做任何检查，仓储区多个手持终端无法联网。请为杭州仓库整理报障工单草稿，根因待排查。')
    d=result.get('draft')
    record('live_model_prepares_draft',bool(d) and d['state']=='pending',result)
    if d:
        response=client.post(f'/api/sessions/{sid}/drafts/{d["draft_id"]}/confirm',json={'expected_revision':d['revision']});response.raise_for_status();ticket=response.json()
        repeat=client.post(f'/api/sessions/{sid}/drafts/{d["draft_id"]}/confirm',json={'expected_revision':d['revision']}).json()
        fetched=client.get(f'/api/sessions/{sid}/tickets/{ticket["ticket_id"]}').json()
        record('live_confirmation_and_query',ticket['ticket_id']==repeat.get('ticket_id')==fetched.get('ticket_id'),ticket)
        result=ask('查询工单 '+ticket['ticket_id'])
        record('live_model_ticket_query',any(x['tool']=='get_ticket' and x['result']['status']=='ok' for x in result['trace']) and ticket['ticket_id'] in result['reply'],result)
    client.close();rag.embedder.close()
    if not all(x['passed'] for x in report['checks']):raise SystemExit(1)

if __name__=='__main__':main()
