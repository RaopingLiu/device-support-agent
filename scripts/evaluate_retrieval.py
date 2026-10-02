# 检索冒烟评估：固定 5 个问题，检查相关文档是否出现在前 5 条中；不是回答准确率评测。
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from app import config,rag

# Small manually specified relevance smoke set, not a general accuracy benchmark.
CASES=[
    ('AP 离线，指示灯不亮，应该检查供电吗？','ap','EAP225',['AP Going Offline']),
    ('无线终端搜索不到 SSID，应该排查什么？','ap','EAP225',['Wireless Issues','Connection']),
    ('无线连接速度慢，干扰较大，如何排查？','ap','EAP225',['wireless performance','Wireless Issues']),
    ('PoE 交换机不能给设备供电，怎么排查？','switch','TL-SG2210P',['PoE']),
    ('网关无法被控制器采用，adopt failed 怎么排查？','gateway','ER605',['Gateway']),
]
report=[]
for query,kind,model,expected in CASES:
    hits=rag.search(query,kind,model)
    match=any(any(word.lower() in h['title'].lower() for word in expected) for h in hits)
    report.append({'query':query,'expected_title_terms':expected,'expected_document_in_top5':match,'hits':[{'title':h['title'],'section':h['section'],'score':h['score'],'source_type':h['source_type']} for h in hits]})
    print(query,match,flush=True)
path=config.RUNTIME/'retrieval-evaluation.json';path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
rag.embedder.close()
print('Relevant-document smoke checks:',sum(x['expected_document_in_top5'] for x in report),'/',len(report),flush=True)
