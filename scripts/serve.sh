#!/bin/bash
# Unified start/stop/restart for Teaching-Learning application
# Usage: ./scripts/serve.sh local          — local mode (direct localhost, no tunnel)
#        ./scripts/serve.sh public         — public mode (tunnel, obscure ports)
#        ./scripts/serve.sh stop           — stop all
#        ./scripts/serve.sh status         — check status

set -e
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="/tmp"
BACKEND_PID="$PID_DIR/tl-backend.pid"
FRONTEND_PID="$PID_DIR/tl-frontend.pid"
TUNNEL_PID="$PID_DIR/tl-tunnel.pid"

# Ports — local uses standard, public uses obscure
LOCAL_BACKEND_PORT=8000
LOCAL_FRONTEND_PORT=3000
PUBLIC_BACKEND_PORT=18920
PUBLIC_FRONTEND_PORT=13900

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
    pkill -f "uvicorn app.main" 2>/dev/null || true
    pkill -f "next start" 2>/dev/null || true
    pkill -f "node .next" 2>/dev/null || true
    pkill -f "cloudflared tunnel run" 2>/dev/null || true
    sleep 1
    echo "All stopped."
}

do_start_local() {
    echo "Starting in LOCAL mode..."
    local bp=$LOCAL_BACKEND_PORT
    local fp=$LOCAL_FRONTEND_PORT

    # Write .env.local for frontend
    cat > "$PROJECT_ROOT/frontend/.env.local" << EOF
NEXT_PUBLIC_REQUIRE_AUTH=false
NEXT_PUBLIC_API_BASE_URL=http://localhost:$bp
EOF

    # Backend
    cd "$PROJECT_ROOT/backend"
    nohup uv run uvicorn app.main:app \
        --host 127.0.0.1 --port $bp --workers 1 \
        > /tmp/tl-backend.log 2>&1 &
    echo $! > "$BACKEND_PID"
    echo "  Backend: http://localhost:$bp (1 worker)"

    # Frontend (rebuild with local env)
    cd "$PROJECT_ROOT/frontend"
    echo "  Building frontend..."
    npx next build --no-lint > /dev/null 2>&1
    nohup npx next start -p $fp > /tmp/tl-frontend.log 2>&1 &
    echo $! > "$FRONTEND_PID"
    echo "  Frontend: http://localhost:$fp"

    sleep 3
    echo ""
    echo "=== LOCAL MODE ==="
    echo "  Open: http://localhost:$fp"
    echo "  Auth: disabled"
}

do_start_public() {
    echo "Starting in PUBLIC mode..."
    local bp=$PUBLIC_BACKEND_PORT
    local fp=$PUBLIC_FRONTEND_PORT

    # Write .env.local for frontend — no API base URL (use same origin via tunnel)
    cat > "$PROJECT_ROOT/frontend/.env.local" << EOF
NEXT_PUBLIC_REQUIRE_AUTH=true
EOF

    # Update tunnel config to use obscure ports
    if [ -f "$HOME/.cloudflared/config.yml" ]; then
        cat > "$HOME/.cloudflared/config.yml" << TUNNEL_EOF
tunnel: ac0474fd-0f9f-4bc6-811e-aedefa885335
credentials-file: $HOME/.cloudflared/ac0474fd-0f9f-4bc6-811e-aedefa885335.json

ingress:
  - hostname: learn.shc66.com
    path: /api/*
    service: http://localhost:$bp
  - hostname: learn.shc66.com
    path: /storage/*
    service: http://localhost:$bp
  - hostname: learn.shc66.com
    service: http://localhost:$fp
  - service: http_status:404
TUNNEL_EOF
    fi

    # Backend
    cd "$PROJECT_ROOT/backend"
    nohup uv run uvicorn app.main:app \
        --host 127.0.0.1 --port $bp --workers 2 \
        > /tmp/tl-backend.log 2>&1 &
    echo $! > "$BACKEND_PID"
    echo "  Backend: port $bp (2 workers, localhost only)"

    # Frontend (rebuild with public env)
    cd "$PROJECT_ROOT/frontend"
    echo "  Building frontend..."
    npx next build --no-lint > /dev/null 2>&1
    nohup npx next start -p $fp > /tmp/tl-frontend.log 2>&1 &
    echo $! > "$FRONTEND_PID"
    echo "  Frontend: port $fp (localhost only)"

    # Tunnel
    if command -v cloudflared &>/dev/null; then
        nohup cloudflared tunnel run teaching-learning > /tmp/tl-tunnel.log 2>&1 &
        echo $! > "$TUNNEL_PID"
        echo "  Tunnel: https://learn.shc66.com"
    fi

    sleep 3
    echo ""
    echo "=== PUBLIC MODE ==="
    echo "  URL: https://learn.shc66.com"
    echo "  Auth: required"
    echo "  Ports: backend=$bp, frontend=$fp (not exposed)"
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
}

case "${1:-}" in
    local)   do_stop; do_start_local ;;
    public)  do_stop; do_start_public ;;
    stop)    do_stop ;;
    status)  do_status ;;
    *)       echo "Usage: $0 {local|public|stop|status}" ;;
esac
