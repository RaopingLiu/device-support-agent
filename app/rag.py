# RAG 层：子进程编码文本，Milvus 保存向量、正文、元数据；设备状态仍查 SQL。
import atexit
import hashlib
import json
import os
import queue
import subprocess
import threading
from .config import ROOT, RUNTIME

# 区分依赖故障与正常零结果，不能把失败说成没有资料。
class DependencyError(RuntimeError): pass

# 复用编码进程避免重复加载模型，以 JSON 行协议交换文本和向量。
class Embedder:
    def __init__(self):
        self.process=None
        self.lock=threading.Lock()
        self.outputs=queue.Queue()
        atexit.register(self.close)

    # 终止并回收子进程，避免继续占用内存。
    def close(self):
        if self.process:
            self.process.terminate()
            try: self.process.wait(timeout=3)
            except subprocess.TimeoutExpired: self.process.kill()
            self.process=None

    # 串行处理完整请求与响应，避免不同输入的向量错配。
    def encode(self,texts):
        with self.lock:  # 同一编码进程一次处理一批输入和输出。
            # 首次或进程退出时，用配置的外部解释器和本地模型重新启动。
            if self.process is None or self.process.poll() is not None:
                self.outputs=queue.Queue()
                python=os.environ.get('EMBEDDING_PYTHON','')
                model=os.environ.get('EMBEDDING_MODEL','')
                if not python or not model: raise DependencyError('Embedding 尚未配置')
                log=open(RUNTIME/'embedding.log','a',encoding='utf-8')
                try:
                    self.process=subprocess.Popen([python,str(ROOT/'scripts/embedding_worker.py'),model],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                finally: log.close()
                process, outputs=self.process,self.outputs
                # 后台读 stdout 放入队列，主调用可限时等待。
                def read():
                    for line in process.stdout: outputs.put(line)
                    outputs.put(None)
                threading.Thread(target=read,daemon=True).start()
            try:
                self.process.stdin.write(json.dumps({'texts':texts},ensure_ascii=False)+'\n'); self.process.stdin.flush()
                line=self.outputs.get(timeout=120)  # 结果超时会清理子进程并明确报错。
                if not line: raise DependencyError('Embedding 子进程退出，请检查本地日志')
                result=json.loads(line)
                if 'error' in result: raise DependencyError('Embedding 编码失败：'+result['error'])
                return result['vectors']
            except (queue.Empty,BrokenPipeError) as exc:
                self.close()
                raise DependencyError('Embedding 超时或进程不可用') from exc

embedder=Embedder()

# 连接 Milvus 网络服务，不是读取 SQLite 文件。
def client():
    from pymilvus import MilvusClient
    return MilvusClient(uri=os.getenv('MILVUS_URI','http://127.0.0.1:19530'),timeout=8)

# 本项目专用集合名，入库同步只操作该集合。
def collection(): return os.getenv('MILVUS_COLLECTION','network_knowledge_v1')

# 离线准备：编码→同步集合→核对可见 ID→记录入库信息。
def ingest(chunks):
    vectors=embedder.encode([x['title']+'\n'+x['text'] for x in chunks])  # 标题与正文一起编码，需注意模型 token 截断上限。
    c=client(); name=collection()
    # 首次建集合；已有集合不自动改变向量维度。
    if not c.has_collection(name):
        c.create_collection(collection_name=name,dimension=len(vectors[0]),primary_field_name='id',id_type='string',max_length=64,vector_field_name='vector',metric_type='COSINE',consistency_level='Strong')
    records=[dict(x,id=x['chunk_id'],vector=v) for x,v in zip(chunks,vectors)]  # 同记录通过 ID 关联向量、正文与来源元数据。
    # 更新或新增当前片段，再移除本次语料不再包含的旧片段。
    old=c.query(collection_name=name,filter='id != ""',output_fields=['id'],limit=16384)
    current={x['id'] for x in records}
    obsolete=[x['id'] for x in old if x['id'] not in current]
    for i in range(0,len(records),32): c.upsert(collection_name=name,data=records[i:i+32])  # 分批 upsert，同 ID 更新已有记录。
    if obsolete: c.delete(collection_name=name,ids=obsolete)
    c.flush(collection_name=name)
    stats=c.get_collection_stats(collection_name=name)
    # 用实际可查询 ID 核对；存储统计可能暂时包含 upsert 旧版本。
    visible=c.query(collection_name=name,filter='id != ""',output_fields=['id'],limit=16384)
    actual={x['id'] for x in visible};c.close()
    if actual!=current:raise DependencyError('入库后可查询片段集合与预期不一致')
    report={'collection':name,'chunks':len(actual),'embedding_model':os.getenv('EMBEDDING_MODEL'),'dimension':len(vectors[0]),'storage_stats':stats}
    (RUNTIME/'index.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return {'verified_visible_chunks':len(actual),'storage_stats':stats}

# 在线检索：先校验产品范围与索引配置，再编码问题、过滤并搜索。
def search(query,device_type='',model='',top_k=5):
    if not query.strip(): raise ValueError('检索问题不能为空')
    # 白名单界定演示范围，不代表覆盖每个固件版本。
    supported={'EAP225':'ap','TL-SG2210P':'switch','ER605':'gateway','OC200':'controller'}
    if model and model.upper() not in supported:
        return []  # 未知产品不套用 Omada 系列文档作为依据。
    if model:
        model=model.upper()
        actual_type=supported[model]
        if device_type and device_type!=actual_type:return []
        device_type=actual_type
    index=RUNTIME/'index.json'
    if not index.exists(): raise DependencyError('知识库尚未完成入库')
    meta=json.loads(index.read_text(encoding='utf-8'))
    # 入库和查询必须使用相同向量空间；换模型需重建适配集合。
    if meta['embedding_model']!=os.getenv('EMBEDDING_MODEL'):
        raise DependencyError('Embedding 配置已变化，请重新构建知识库')
    vector=embedder.encode([query])[0]  # 问题也编码，才能与文档向量比较。
    c=client()
    # 型号/类型元数据过滤；family/general 不代表精确固件依据。
    clauses=[]
    if device_type: clauses.append('(device_type == '+json.dumps(device_type)+' or device_type == "general")')
    if model: clauses.append('(model_scope == '+json.dumps(model)+' or model_scope == "family" or model_scope == "general")')
    # 最多取 5 条；当前无重排序、混合检索或校准过的分数阈值。
    result=c.search(collection_name=collection(),data=[vector],filter=' and '.join(clauses),limit=max(1,min(top_k,5)),output_fields=['chunk_id','text','title','source_url','section','source_type','device_type','model_scope','version_scope'],search_params={'metric_type':'COSINE','params':{}})
    c.close()
    return [dict(hit['entity'],score=round(hit['distance'],4)) for hit in result[0]]
