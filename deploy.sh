#!/usr/bin/env bash
# ============================================================
# Teaching-Learning — Server Deployment Script
# Run this on a fresh Ubuntu 22.04/24.04 cloud server
# ============================================================
set -euo pipefail

# ── Color output ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Check if running as root or with sudo ──
if [ "$EUID" -ne 0 ]; then
  error "Please run with sudo:  sudo bash deploy.sh"
fi

echo ""
echo "=========================================="
echo "  Teaching-Learning Deployment"
echo "=========================================="
echo ""

# ── Step 1: Collect configuration ──
read -rp "Enter your domain name (e.g. learn.example.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
  error "Domain is required"
fi

# Generate secrets
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)

info "Domain:   $DOMAIN"
info "Secrets:  auto-generated"
echo ""

# ── Step 2: Install Docker (if not installed) ──
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  info "Docker installed"
else
  info "Docker already installed"
fi

if ! docker compose version &>/dev/null; then
  error "docker compose plugin not found. Please install Docker Compose V2."
fi

# ── Step 3: Configure firewall ──
if command -v ufw &>/dev/null; then
  info "Configuring firewall (ufw)..."
  ufw allow 22/tcp   # SSH
  ufw allow 80/tcp   # HTTP
  ufw allow 443/tcp  # HTTPS
  ufw --force enable
  info "Firewall configured: 22, 80, 443 open"
fi

# ── Step 4: Set up project directory ──
PROJECT_DIR="/opt/teaching-learning"
if [ -d "$PROJECT_DIR" ]; then
  warn "$PROJECT_DIR already exists, updating..."
  cd "$PROJECT_DIR"
  git pull || warn "Git pull failed, continuing with existing files"
else
  info "Cloning project..."
  read -rp "Enter your GitHub repo URL (e.g. https://github.com/user/Teaching-Learning-.git): " REPO_URL
  git clone "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

# ── Step 5: Write production .env ──
info "Writing production .env..."
cat > .env << EOF
# === Production Environment ===
# Domain
DOMAIN=${DOMAIN}

# Database
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# Auth
JWT_SECRET=${JWT_SECRET}

# CORS
CORS_ORIGINS=https://${DOMAIN}
EOF

# Copy backend LLM config if not present
if [ ! -f backend/.env ]; then
  warn "backend/.env not found!"
  warn "You need to create backend/.env with your LLM API keys."
  warn "Example:"
  echo ""
  echo "  VISION_API_KEY=your-key"
  echo "  VISION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1"
  echo "  VISION_MODEL=qwen3-vl-flash"
  echo "  TEXT_API_KEY=your-key"
  echo "  TEXT_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1"
  echo "  TEXT_MODEL=qwen3.5-plus"
  echo "  API_KEY=your-key"
  echo "  BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1"
  echo "  MODEL=qwen3-vl-flash"
  echo ""
  read -rp "Press Enter after creating backend/.env, or Ctrl+C to abort..."
fi

info ".env configured"

# ── Step 6: Build and start services ──
info "Building and starting services (this may take a few minutes)..."
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d

# ── Step 7: Wait for health check ──
info "Waiting for services to be ready..."
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T backend curl -sf http://localhost:8000/health &>/dev/null; then
    break
  fi
  sleep 2
done

# ── Step 8: Verify ──
echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
info "Your site: https://${DOMAIN}"
info "Project dir: ${PROJECT_DIR}"
echo ""
echo "Useful commands:"
echo "  cd ${PROJECT_DIR}"
echo "  docker compose -f docker-compose.prod.yml logs -f        # View logs"
echo "  docker compose -f docker-compose.prod.yml restart        # Restart"
echo "  docker compose -f docker-compose.prod.yml down           # Stop"
echo "  docker compose -f docker-compose.prod.yml up -d --build  # Rebuild & start"
echo ""
echo "Database backup:"
echo "  docker compose -f docker-compose.prod.yml exec postgres pg_dump -U teaching teaching_learning > backup.sql"
echo ""
warn "IMPORTANT: Make sure your domain DNS A record points to this server's IP!"
warn "Caddy will auto-obtain HTTPS certificate once DNS is ready."
echo ""
