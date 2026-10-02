# 抓取脚本：固定官方来源，保留原始 HTML，提取正文和出处；不调用模型。
"""Fetch a small, curated official corpus; keep originals and source provenance."""
import concurrent.futures
from datetime import datetime,timezone
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path
import re
import httpx

ROOT=Path(__file__).resolve().parents[1]
# 人工选择的六篇系列 FAQ，不代表完整型号或固件资料库。
SOURCES=[
    ('ap-offline','https://support.omadanetworks.com/au/document/13235/','ap','family'),
    ('wireless-issues','https://support.omadanetworks.com/us/document/13002/','ap','family'),
    ('wifi-connection','https://support.omadanetworks.com/en/document/13171/','ap','family'),
    ('wireless-performance','https://support.omadanetworks.com/us/document/13001/','ap','family'),
    ('poe-troubleshooting','https://support.omadanetworks.com/us/document/12924/','switch','family'),
    ('gateway-adoption','https://support.omadanetworks.com/us/document/13204/','gateway','family'),
]

# 读取 article/title，跳过脚本样式；基础提取不保留复杂表格结构。
class ArticleParser(HTMLParser):
    def __init__(self):
        super().__init__();self.inside=False;self.skip=0;self.parts=[];self.title='';self.in_title=False
    def handle_starttag(self,tag,attrs):
        if tag=='title':self.in_title=True
        if tag=='article':self.inside=True
        if self.inside and tag in ['script','style']:self.skip+=1
        if self.inside and tag in ['p','h1','h2','h3','h4','li','tr','br']:self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag=='title':self.in_title=False
        if tag=='article':self.inside=False
        if self.inside and tag in ['script','style']:self.skip=max(0,self.skip-1)
        if self.inside and tag in ['p','h1','h2','h3','h4','li','tr']:self.parts.append('\n')
    def handle_data(self,data):
        if self.in_title:self.title+=data
        if self.inside and not self.skip:self.parts.append(data)

# 单篇流程：缓存/下载→正文清洗→质量检查→来源元数据。
def fetch(source):
    doc_id,url,kind,scope=source
    raw=ROOT/'data/raw'/f'{doc_id}.html';raw.parent.mkdir(parents=True,exist_ok=True)
    # 缓存存在时不重新下载，刷新资料需先妥善处理旧缓存。
    if not raw.exists():
        r=httpx.get(url,follow_redirects=True,timeout=45);r.raise_for_status();raw.write_text(r.text,encoding='utf-8')
    parser=ArticleParser();parser.feed(raw.read_text(encoding='utf-8'))
    lines=[re.sub(r'\s+',' ',x).strip() for x in ''.join(parser.parts).splitlines() if x.strip()]
    text='\n'.join(x for x in lines if not x.startswith('Knowledgebase') and x not in ['Contents','Please Rate this Document'])
    if len(text)<300:raise ValueError(f'{doc_id}: article extraction too short; inspect source before indexing')  # 正文过短报错，避免把空页或导航当作知识。
    out=ROOT/'data/docs'/f'{doc_id}.txt';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(text,encoding='utf-8')
    title=parser.title.split('|')[0].strip() or text.splitlines()[0].strip()  # 标题缺失时使用正文首行，仍不足则报错。
    if len(title)<5:raise ValueError(f'{doc_id}: missing usable document title')
    return dict(doc_id=doc_id,title=title,source_url=url,source_type='official_faq',device_type=kind,model_scope=scope,version_scope='未限定具体固件版本；仅作系列通用排查参考',retrieved_at=datetime.now(timezone.utc).isoformat(),path=str(out.relative_to(ROOT)).replace('\\','/'),content_hash=hashlib.sha256(text.encode()).hexdigest(),characters=len(text))

# 并发抓取独立资料，成功和失败分别落盘，有错误则非零退出。
if __name__=='__main__':
    manifest=[];errors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        jobs={pool.submit(fetch,s):s[0] for s in SOURCES}
        for job in concurrent.futures.as_completed(jobs):
            try:
                item=job.result();manifest.append(item);print(item['doc_id'],item['characters'],flush=True)
            except Exception as exc: errors.append({'doc_id':jobs[job],'error':str(exc)});print('FAILED',jobs[job],type(exc).__name__,flush=True)
    path=ROOT/'data/source_manifest.json';path.write_text(json.dumps(sorted(manifest,key=lambda x:x['doc_id']),ensure_ascii=False,indent=2),encoding='utf-8')
    (ROOT/'data/fetch_errors.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2),encoding='utf-8')
    if errors: raise SystemExit(1)
