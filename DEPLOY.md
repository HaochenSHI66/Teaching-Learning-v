# 公网部署方案 — learn.shc66.com

## 架构概览

```
浏览器
  └─► Cloudflare Tunnel (HTTPS)
         ├─► /api/*     → localhost:18920  (FastAPI 后端)
         ├─► /storage/* → localhost:18920  (静态文件)
         └─► /*         → localhost:13900  (Next.js 前端)
```

- Cloudflare 负责 HTTPS/TLS，本机只需 HTTP
- 前后端作为本地进程运行，无 Docker
- 日志统一写入 `logs/`

---

## 一键启动

```bash
bash start.sh
```

启动顺序：后端 → 前端 → DoH 代理 → Cloudflare Tunnel

---

## 各服务说明

### 后端（port 18920）
- 运行命令：`uvicorn app.main:app --host 0.0.0.0 --port 18920`
- 配置：`backend/.env`（LLM API Key、数据库路径等）
- 数据库：SQLite（`backend/teaching_learning.db`）或 PostgreSQL

### 前端（port 13900）
- 运行命令：`PORT=13900 node .next/standalone/server.js`
- 需要先构建（见下方"重新构建"）
- 静态文件需复制到 standalone 目录

### Cloudflare Tunnel
- 配置文件：`~/.cloudflared/config.yml`
- 隧道名：`teaching-learning`
- 路由规则已配置好，无需修改

---

## 重新构建前端

代码有改动时需重新构建：

```bash
cd frontend
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
```

然后重启前端进程：

```bash
pkill -f "standalone/server.js" 2>/dev/null || true
PORT=13900 nohup node .next/standalone/server.js > ../logs/frontend.log 2>&1 &
```

---

## 重要配置项

### `frontend/.env.local`
```
NEXT_PUBLIC_REQUIRE_AUTH=true
# 不设置 NEXT_PUBLIC_API_BASE_URL
# 代码自动检测：外部访问用相对路径 /api/...，本地访问用 http://127.0.0.1:18920
```

### `backend/.env`
```
VISION_API_KEY=...
VISION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VISION_MODEL=qwen3-vl-flash

TEXT_API_KEY=...
TEXT_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
TEXT_MODEL=qwen-plus-latest

BASE_URL=...
MODEL=qwen-turbo-latest
API_KEY=...

CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,https://learn.shc66.com
```

### `~/.cloudflared/config.yml`（已配置，勿随意修改）
```yaml
tunnel: ac0474fd-0f9f-4bc6-811e-aedefa885335
credentials-file: ~/.cloudflared/ac0474fd-...json

ingress:
  - hostname: learn.shc66.com
    path: /api/*
    service: http://localhost:18920
  - hostname: learn.shc66.com
    path: /storage/*
    service: http://localhost:18920
  - hostname: learn.shc66.com
    service: http://localhost:13900
  - service: http_status:404
```

---

## 常用运维命令

```bash
# 查看日志
tail -f logs/frontend.log
tail -f logs/backend.log
tail -f logs/cloudflared.log

# 检查端口
lsof -i :13900 -sTCP:LISTEN
lsof -i :18920 -sTCP:LISTEN

# 停止所有服务
pkill -f "standalone/server.js"
pkill -f "uvicorn app.main"
pkill -f "cloudflared tunnel"

# 重启全部
bash start.sh
```

---

## next.config.ts 关键配置

```ts
output: "standalone"  // 必须，用于生成 .next/standalone/server.js
```

---

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| `Application error: client-side exception` | 旧构建版本未重启 | 重新构建并重启前端 |
| API 请求 404 | 前端拦截了 /api/* | 确认 Cloudflare Tunnel 路由配置正确 |
| Tunnel 连接失败 | DoH 代理或 DNS 问题 | 查看 `logs/cloudflared.log` |
| 前端启动失败 | standalone 静态文件未复制 | 执行 `cp -r .next/static .next/standalone/.next/static` |
