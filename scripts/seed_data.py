# 初始化脚本：调用固定模拟模板填数据，然后打印设备相关表数量。
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import db
db.seed()  # 已有设备时跳过，不覆盖旧快照。
with db.connect() as c:
    print({table:c.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in ['sites','devices','device_links','device_status']})
