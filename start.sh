#!/bin/bash
# 一键启动公网服务 — learn.shc66.com
# 解决 Clash fake-ip 下 SRV DNS 被 ISP 封锁的问题

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

echo "=== Teaching-Learning 公网启动 ==="
echo ""

# ── 1. 后端 ─────────────────────────────────────────────
echo "[1/5] 后端服务 (port 18920)..."
if lsof -i :18920 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  ✓ 已在运行"
else
  echo "  启动中..."
  cd "$SCRIPT_DIR/backend"
  nohup python3 -m uvicorn app.main:app --host 0.0.0.0 --port 18920 \
    > "$LOG_DIR/backend.log" 2>&1 &
  sleep 3
  lsof -i :18920 -sTCP:LISTEN >/dev/null 2>&1 && echo "  ✓ 已启动" || { echo "  ✗ 失败，查看 logs/backend.log"; exit 1; }
fi

# ── 2. 前端 ─────────────────────────────────────────────
echo "[2/5] 前端服务 (port 13900)..."
if lsof -i :13900 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  ✓ 已在运行"
else
  echo "  启动中..."
  cd "$SCRIPT_DIR/frontend"
  # 确保 standalone 静态文件就位
  cp -r .next/static .next/standalone/.next/static 2>/dev/null || true
  cp -r public .next/standalone/public 2>/dev/null || true
  PORT=13900 nohup node .next/standalone/server.js \
    > "$LOG_DIR/frontend.log" 2>&1 &
  sleep 3
  lsof -i :13900 -sTCP:LISTEN >/dev/null 2>&1 && echo "  ✓ 已启动" || { echo "  ✗ 失败，查看 logs/frontend.log"; exit 1; }
fi

# ── 3. DoH 代理 (绕过 SRV 封锁) ─────────────────────────
echo "[3/5] DoH DNS 代理 (port 53535)..."
if lsof -i UDP:53535 >/dev/null 2>&1; then
  echo "  ✓ 已在运行"
else
  echo "  启动中..."
  nohup python3 /tmp/doh_proxy.py > "$LOG_DIR/doh_proxy.log" 2>&1 &
  sleep 2
  lsof -i UDP:53535 >/dev/null 2>&1 && echo "  ✓ 已启动" || { echo "  ✗ DoH 代理失败"; exit 1; }
fi

# ── 4. pfctl 重定向 DNS（需要 sudo 密码）────────────────
echo "[4/5] DNS 重定向 UDP:53 → 53535（需要输入 sudo 密码）..."
if sudo pfctl -s nat 2>/dev/null | grep -q "53535"; then
  echo "  ✓ 已生效"
else
  echo "rdr pass on lo0 proto udp from any to 127.0.0.1 port 53 -> 127.0.0.1 port 53535" \
    | sudo pfctl -ef - 2>/dev/null && echo "  ✓ 已设置" || echo "  ⚠ pfctl 设置失败，继续尝试..."
fi

# ── 5. Cloudflare Tunnel ─────────────────────────────────
echo "[5/5] Cloudflare Tunnel..."
pkill -f "cloudflared tunnel" 2>/dev/null && sleep 1 || true

nohup cloudflared tunnel --no-autoupdate --protocol http2 run teaching-learning \
  > "$LOG_DIR/cloudflared.log" 2>&1 &

echo "  等待连接..."
for i in $(seq 1 15); do
  sleep 2
  if grep -q "Registered tunnel connection" "$LOG_DIR/cloudflared.log" 2>/dev/null; then
    LOC=$(grep "Registered tunnel connection" "$LOG_DIR/cloudflared.log" | tail -1 \
          | grep -o "location=[^ ]*" | cut -d= -f2)
    echo "  ✓ Tunnel 已连接（节点: ${LOC:-unknown}）"
    break
  fi
  if grep -q "Could not lookup srv\|Initiating shutdown" "$LOG_DIR/cloudflared.log" 2>/dev/null; then
    echo "  ✗ Tunnel 失败："
    tail -3 "$LOG_DIR/cloudflared.log"
    exit 1
  fi
done

echo ""
echo "==============================="
echo "  ✅ 部署完成！"
echo "  🌐 https://learn.shc66.com"
echo "  📋 日志: $LOG_DIR/"
echo "==============================="
