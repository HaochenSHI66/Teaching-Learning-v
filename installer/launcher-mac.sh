#!/usr/bin/env bash
# Mac .app 内启动脚本模板
# 实际使用时由 build-mac.sh 动态写入 Contents/MacOS/ 目录
APP_CONTENTS="$(cd "$(dirname "$0")/.." && pwd)"
APP="$APP_CONTENTS/app"

# 首次运行：初始化 .env 和 storage
if [ ! -f "$APP/.env" ]; then
  cp "$APP/.env.example" "$APP/.env"
  open -e "$APP/.env"  # 用文本编辑器打开
  osascript -e 'display dialog "请在打开的文件中填写 API_KEY，保存后重新双击应用启动。" with title "幻灯片研习台 - 首次配置" buttons {"好"} default button "好"'
  exit 0
fi
mkdir -p "$APP/storage"

# 清理函数
cleanup() { kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null; exit; }
trap cleanup INT TERM

# 启动后端
source "$APP/backend/.venv/bin/activate"
cd "$APP/backend"
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 &
BACKEND_PID=$!

# 等待后端就绪（最多 20 秒）
for i in $(seq 1 20); do
  curl -sf http://127.0.0.1:8000/health &>/dev/null && break
  sleep 1
done

# 启动前端
cd "$APP/frontend"
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 "$APP/runtime/node" server.js &
FRONTEND_PID=$!
sleep 3

# 打开浏览器
open http://localhost:3000

wait
