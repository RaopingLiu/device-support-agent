"""仅供浏览器回归：真实 HTTP/SQLite，模型响应为明确的测试替身，不接外部模型。"""
import os
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# 每次浏览器测试独立数据库，退出时回收；不改本机演示会话。
(ROOT / '.cache').mkdir(exist_ok=True)
runtime = tempfile.TemporaryDirectory(prefix='browser-tests-', dir=ROOT / '.cache')
os.environ['APP_RUNTIME'] = runtime.name
from app import db, main, tickets
from app.tools import make_tools


class FixtureAssistant:
    def run(self, sid, message):
        trace = []
        if '整理报障' in message:
            draft = tickets.prepare(sid, {
                'site_id':'S01', 'area':'仓储区', 'summary':'仓储区 AP 离线',
                'description':'S01-AP04 离线，多个手持终端无法连接，原因待确认。',
                'impact':'仓储区扫码作业', 'device_ids':['S01-AP04'], 'checks':[],
            })
            reply = '测试替身已整理草稿，请检查后确认。'
            trace.append({'tool':'prepare_ticket_draft','args':{},'result':{'status':'ok','data':draft,'error':None}})
        else:
            tool = {t.name:t for t in make_tools(sid)}['get_device_status']
            result = tool.invoke({'device_id':'S01-AP04'})
            trace.append({'tool':'get_device_status','args':{'device_id':'S01-AP04'},'result':result})
            reply = '测试替身：S01-AP04 的模拟状态为离线，根因仍需核实。'
        draft = tickets.current(sid)
        return {'reply':reply,'draft':draft,'trace':trace,'retrieved':[],'citations':[],
                'stage':'awaiting_confirmation' if draft else 'ready','error':None}

    def close(self): pass


original_lifespan = main.app.router.lifespan_context
@asynccontextmanager
async def lifespan(app):
    async with original_lifespan(app):
        main.assistant.close()
        main.assistant = FixtureAssistant()
        yield

main.app.router.lifespan_context = lifespan
if __name__ == '__main__':
    import uvicorn
    try: uvicorn.run(main.app, host='127.0.0.1', port=8766, log_level='warning')
    finally: runtime.cleanup()
