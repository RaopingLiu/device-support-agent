# 编码进程：使用已有外部环境和本地模型，通过 JSON 行接收文本并返回向量。
"""Read-only use of an existing CPU SentenceTransformer runtime over JSON lines.

The web app launches this child process. No old environment packages are changed.
Stdout is reserved for protocol messages; library output goes to stderr.
"""
import contextlib
import json
import os
import sys

# 禁用模型自动联网下载，只使用本地缓存。
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
# 库日志发往 stderr，避免破坏 stdout 上的 JSON 协议。
with contextlib.redirect_stdout(sys.stderr):
    from sentence_transformers import SentenceTransformer
    model=SentenceTransformer(sys.argv[1],device='cpu')
    model.max_seq_length=256  # 输入按 token 截断；字符长度限制不严格保证标题加正文不超限。
# 一行一批请求，向量顺序与输入文本顺序对应。
for line in sys.stdin:
    try:
        req=json.loads(line)
        # 库日志发往 stderr，避免破坏 stdout 上的 JSON 协议。
        with contextlib.redirect_stdout(sys.stderr):
            vectors=model.encode(req['texts'],normalize_embeddings=True,batch_size=16).tolist()  # 归一化向量，batch_size 控制编码批次大小。
        print(json.dumps({'vectors':vectors}),flush=True)  # flush 立即输出，避免主进程等待缓冲数据。
    except Exception as exc:
        print(json.dumps({'error':type(exc).__name__}),flush=True)
