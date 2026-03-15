#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="幻灯片研习台"
APP_DIR="$REPO/dist/$APP_NAME.app/Contents/app"
NODE_VERSION="20.18.0"

echo "=== 构建 Mac .dmg 包 ==="

# 1. 检查构建工具
command -v create-dmg &>/dev/null || { brew install create-dmg; }
command -v python3 &>/dev/null || { echo "❌ 需要 Python 3.11+"; exit 1; }
command -v node &>/dev/null || { echo "❌ 需要 Node.js 20+"; exit 1; }

# 2. 清理旧产物
rm -rf "$REPO/dist"
mkdir -p "$APP_DIR/backend" "$APP_DIR/frontend" "$APP_DIR/runtime" "$APP_DIR/storage"

# 3. 构建前端 standalone
echo "→ 构建 Next.js standalone..."
cd "$REPO/frontend"
npm ci --silent
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run build
# 复制 standalone 产物
cp -r .next/standalone/. "$APP_DIR/frontend/"
cp -r .next/static "$APP_DIR/frontend/.next/static"
cp -r public "$APP_DIR/frontend/public"

# 4. 构建后端 venv
echo "→ 构建后端 Python 环境..."
cd "$REPO/backend"
python3 -m venv "$APP_DIR/backend/.venv"
source "$APP_DIR/backend/.venv/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet .
deactivate
cp -r app "$APP_DIR/backend/app"
cp pyproject.toml "$APP_DIR/backend/"

# 5. 下载 Node.js 二进制（根据 CPU 架构选择）
echo "→ 下载 Node.js 二进制..."
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-arm64.tar.gz"
else
  NODE_URL="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-x64.tar.gz"
fi
curl -L "$NODE_URL" | tar xz -C /tmp
cp "/tmp/node-v$NODE_VERSION-darwin-${ARCH}/bin/node" "$APP_DIR/runtime/node"
chmod +x "$APP_DIR/runtime/node"

# 6. 复制 .env.example
cp "$REPO/.env.example" "$APP_DIR/.env.example"

# 7. 创建启动脚本
mkdir -p "$REPO/dist/$APP_NAME.app/Contents/MacOS"
cat > "$REPO/dist/$APP_NAME.app/Contents/MacOS/$APP_NAME" << 'LAUNCHER'
#!/usr/bin/env bash
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

# 停止 LaunchAgent（防止 KeepAlive 进程抢占端口）
stop_launch_agents() {
  local uid
  uid=$(id -u)
  for label in com.teachinglearning.backend com.teachinglearning.frontend; do
    /bin/launchctl bootout "gui/$uid/$label" 2>/dev/null || true
  done
  sleep 1
}

# 智能释放端口：杀掉仍占用端口的进程（兜底）
free_port() {
  local port=$1
  local pids
  pids=$(lsof -ti TCP:"$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "[startup] 端口 $port 仍被占用，强制释放..." >&2
    echo "$pids" | xargs kill -9 2>/dev/null
    sleep 0.5
  fi
}

# 清理函数
cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  exit
}
trap cleanup INT TERM

# 1. 先停掉 LaunchAgent（有 KeepAlive 会抢端口）
stop_launch_agents
# 2. 再兜底清端口
free_port 8000
free_port 3000

# 启动后端
source "$APP/backend/.venv/bin/activate"
cd "$APP/backend"
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 &
BACKEND_PID=$!

# 等待后端就绪（最多 30 秒）
for i in $(seq 1 30); do
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
LAUNCHER
chmod +x "$REPO/dist/$APP_NAME.app/Contents/MacOS/$APP_NAME"

# 8. 创建 Info.plist
cat > "$REPO/dist/$APP_NAME.app/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>       <string>幻灯片研习台</string>
  <key>CFBundleIdentifier</key> <string>com.learningtool.app</string>
  <key>CFBundleVersion</key>    <string>1.0.0</string>
  <key>CFBundleExecutable</key> <string>幻灯片研习台</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# 9. 打包成 .dmg
echo "→ 创建 .dmg..."
create-dmg \
  --volname "$APP_NAME" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 128 \
  --app-drop-link 450 185 \
  "$REPO/dist/$APP_NAME.dmg" \
  "$REPO/dist/$APP_NAME.app"

echo ""
echo "✅ 构建完成: dist/$APP_NAME.dmg"
echo "   大小: $(du -sh "$REPO/dist/$APP_NAME.dmg" | cut -f1)"
