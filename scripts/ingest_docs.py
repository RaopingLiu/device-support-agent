# 入库脚本：正文切分并保留来源，再交给 rag.ingest 编码和写库。
import hashlib
import json
import re
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from app import rag

# 读取官方来源并加入自建 SOP，不读取设备业务表。
def build_chunks():
    manifest=json.loads((ROOT/'data/source_manifest.json').read_text(encoding='utf-8'))
    manifest.append({'doc_id':'internal-sop','title':'多站点网络报障 SOP（自建演示）','source_url':'/api/knowledge/internal-sop','source_type':'internal_sop','device_type':'general','model_scope':'general','path':'data/docs/internal-sop.md'})
    chunks=[]
    # 各文档独立切分，避免混合来源。
    for doc in manifest:
        content=(ROOT/doc['path']).read_text(encoding='utf-8')
        is_chinese=doc['source_type']=='internal_sop'
        limit=220 if is_chinese else 700  # 按字符计数；根据资料类型区分语言，不是自动语言识别。
        # 按非空行收集段落；当前没有语义切分和 overlap。
        paragraphs=[p.strip() for p in content.split('\n') if p.strip()]
        section='正文';parts=[];buffer=''
        for p in paragraphs:
            # Markdown 二级标题触发分段并更新章节，主要用于 SOP。
            if p.startswith('## '):
                if buffer:parts.append((section,buffer));buffer=''
                section=p.lstrip('# ').strip();continue
            # 拼接会超限时先保存缓冲区，再处理新段。
            if len(buffer)+len(p)>limit and buffer:
                parts.append((section,buffer));buffer=''
            # 长段优先按空格/中文句号切，找不到足够靠后的边界则硬切。
            while len(p)>limit:
                cut=p.rfind(' ',0,limit) if not is_chinese else p.rfind('。',0,limit)
                if cut<limit//2:cut=limit
                parts.append((section,p[:cut]));p=p[cut:].strip()
            buffer=(buffer+'\n'+p).strip()
        if buffer:parts.append((section,buffer))
        # 每片附文档来源、章节和适用范围，便于过滤和追溯。
        for i,(section,text) in enumerate(parts):
            digest=hashlib.sha256((doc['doc_id']+str(i)+text).encode()).hexdigest()[:20]  # 文档、序号、正文相同则 ID 相同；切分顺序改变可能改变 ID。
            chunks.append({k:doc[k] for k in ['doc_id','title','source_url','source_type','device_type','model_scope']}|{'chunk_id':digest,'section':section+f' · 片段{i+1}','text':text,'version_scope':doc.get('version_scope','自建演示规范，不对应厂商固件版本')})
    (ROOT/'data/chunks.json').write_text(json.dumps(chunks,ensure_ascii=False,indent=2),encoding='utf-8')
    return chunks

# 直接运行才入库；导入 build_chunks 不会触发写 Milvus。
if __name__=='__main__':
    chunks=build_chunks();print('Prepared chunks:',len(chunks),flush=True)
    print('Milvus stats:',rag.ingest(chunks),flush=True)
