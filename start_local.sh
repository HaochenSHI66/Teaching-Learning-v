#!/bin/bash
# 一键启动本地开发环境 — http://localhost:3000
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

echo "=== Teaching-Learning 本地启动 ==="

# ── 后端 (port 18920) ────────────────────────────────────
echo "[1/2] 后端服务 (port 18920)..."
if lsof -i :18920 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  ✓ 已在运行"
else
  echo "  启动中..."
  cd "$SCRIPT_DIR/backend"
  nohup python3 -m uvicorn app.main:app --host 0.0.0.0 --port 18920 \
    > "$LOG_DIR/backend.log" 2>&1 &
  sleep 3
  lsof -i :18920 -sTCP:LISTEN >/dev/null 2>&1 \
    && echo "  ✓ 已启动" \
    || { echo "  ✗ 失败，查看 logs/backend.log"; exit 1; }
fi

# ── 前端 (port 3000) ─────────────────────────────────────
echo "[2/2] 前端服务 (port 3000)..."
if lsof -i :3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  ✓ 已在运行"
else
  echo "  启动中..."
  cd "$SCRIPT_DIR/frontend"
  nohup npm run dev \
    > "$LOG_DIR/frontend.log" 2>&1 &
  # 等 Next.js 编译完
  echo "  等待 Next.js 就绪..."
  for i in $(seq 1 20); do
    sleep 2
    if lsof -i :3000 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "  ✓ 已就绪"
      break
    fi
    if [ $i -eq 20 ]; then
      echo "  ✗ 超时，查看 logs/frontend.log"
      exit 1
    fi
  done
fi

echo ""
echo "==============================="
echo "  ✅ 本地服务已启动！"
echo "  🌐 http://localhost:3000"
echo "  📋 日志: $LOG_DIR/"
echo "==============================="
