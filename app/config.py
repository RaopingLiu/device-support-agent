# 配置入口：集中加载路径、模型连接与运行参数。
import os
from pathlib import Path
from dotenv import dotenv_values, load_dotenv

# 按源码位置确定项目根目录，避免启动工作目录影响文件定位。
ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')  # 默认不覆盖进程已有同名环境变量。
# 运行目录可配置，测试时可切换到临时目录隔离业务数据。
RUNTIME = Path(os.getenv('APP_RUNTIME', str(ROOT / 'data/runtime')))
RUNTIME.mkdir(parents=True, exist_ok=True)
DB_PATH = RUNTIME / 'business.db'

# 环境变量优先，缺失字段才从已有配置文件只读继承，不修改旧项目。
def model_config():
    source = os.getenv('CREDENTIALS_FILE', '')
    inherited = dotenv_values(source) if source else {}
    return {
        'api_key': os.getenv('OPENAI_API_KEY') or inherited.get('OPENAI_API_KEY', ''),
        'base_url': os.getenv('OPENAI_API_BASE') or inherited.get('OPENAI_API_BASE'),
        'model': os.getenv('MODEL_NAME') or inherited.get('MODEL_NAME', 'gpt-5.5'),
    }
