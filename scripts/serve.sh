#!/bin/bash
# Unified start/stop/restart for Teaching-Learning application
# Usage: ./scripts/serve.sh [start|stop|restart|status]

set -e
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="/tmp"
BACKEND_PID="$PID_DIR/tl-backend.pid"
FRONTEND_PID="$PID_DIR/tl-frontend.pid"
TUNNEL_PID="$PID_DIR/tl-tunnel.pid"

kill_pid_file() {
    local pidfile="$1"
    local name="$2"
    if [ -f "$pidfile" ]; then
        local pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null
            echo "  Stopped $name (PID $pid)"
        fi
        rm -f "$pidfile"
    fi
}

do_stop() {
    echo "Stopping services..."
    kill_pid_file "$BACKEND_PID" "backend"
    kill_pid_file "$FRONTEND_PID" "frontend"
    kill_pid_file "$TUNNEL_PID" "tunnel"
    # Kill any lingering processes
    pkill -f "uvicorn app.main" 2>/dev/null || true
    pkill -f "next start" 2>/dev/null || true
    pkill -f "node .next" 2>/dev/null || true
    # Don't kill cloudflared tunnel by default — user may want it running
    sleep 1
    echo "All stopped."
}

do_start() {
    echo "Starting services..."

    # ── Backend ──
    cd "$PROJECT_ROOT/backend"
    nohup uv run uvicorn app.main:app \
        --host 0.0.0.0 --port 8000 --workers 2 \
        > /tmp/tl-backend.log 2>&1 &
    echo $! > "$BACKEND_PID"
    echo "  Backend started (PID $!, 2 workers, port 8000)"

    # ── Frontend ──
    cd "$PROJECT_ROOT/frontend"
    nohup npx next start -p 3000 > /tmp/tl-frontend.log 2>&1 &
    echo $! > "$FRONTEND_PID"
    echo "  Frontend started (PID $!, port 3000)"

    # ── Tunnel (optional) ──
    if command -v cloudflared &>/dev/null && [ -f "$HOME/.cloudflared/config.yml" ]; then
        nohup cloudflared tunnel run teaching-learning > /tmp/tl-tunnel.log 2>&1 &
        echo $! > "$TUNNEL_PID"
        echo "  Tunnel started (PID $!)"
    else
        echo "  Tunnel skipped (cloudflared not configured)"
    fi

    sleep 3
    echo ""
    do_status
}

do_status() {
    echo "Service status:"
    for name_pid in "backend:$BACKEND_PID" "frontend:$FRONTEND_PID" "tunnel:$TUNNEL_PID"; do
        name="${name_pid%%:*}"
        pidfile="${name_pid##*:}"
        if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
            echo "  ✓ $name (PID $(cat "$pidfile"))"
        else
            echo "  ✗ $name (not running)"
        fi
    done
    # Quick health check
    if curl -s -o /dev/null -w "" http://localhost:8000/docs 2>/dev/null; then
        echo "  ✓ Backend API: http://localhost:8000"
    fi
    if curl -s -o /dev/null http://localhost:3000 2>/dev/null; then
        echo "  ✓ Frontend: http://localhost:3000"
    fi
}

case "${1:-start}" in
    start)   do_stop; do_start ;;
    stop)    do_stop ;;
    restart) do_stop; do_start ;;
    status)  do_status ;;
    *)       echo "Usage: $0 {start|stop|restart|status}" ;;
esac
