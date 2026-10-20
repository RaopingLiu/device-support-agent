# 从当前项目虚拟环境启动后端；可传 -Port 修改端口，默认 8765。
param([int]$Port = 8765, [switch]$BuildFrontend)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot # 切到脚本目录，避免从其他目录运行时导入错误项目。
$projectPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $projectPython)) { throw '缺少项目虚拟环境，请先阅读 README.md 安装步骤。' }
if ($BuildFrontend) {
    & npm.cmd --prefix frontend ci --cache .cache/npm
    if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败。' }
    & npm.cmd --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }
}
if (!(Test-Path -LiteralPath 'frontend/dist/index.html')) { throw '请先运行 .\start.ps1 -BuildFrontend 构建 React 工作台。' }
Write-Host "网域助手：http://127.0.0.1:$Port"
# app.main:app 表示 app/main.py 中的 FastAPI 对象；前台运行，Ctrl+C 停止。
& $projectPython -m uvicorn app.main:app --host 127.0.0.1 --port $Port
