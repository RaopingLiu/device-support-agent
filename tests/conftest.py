# pytest 共用准备：用临时数据库和运行目录，避免测试污染演示数据。
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pytest
from app import config,db

@pytest.fixture
# 把配置替换为 pytest 临时目录，初始化固定模拟数据后返回测试会话。
def store(tmp_path,monkeypatch):
    monkeypatch.setattr(config,'DB_PATH',tmp_path/'business.db')
    monkeypatch.setattr(config,'RUNTIME',tmp_path)
    db.seed()
    return db.new_session('ap_offline')
