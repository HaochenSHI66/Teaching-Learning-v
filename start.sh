#!/bin/bash
# Teaching-Learning 一键启动脚本
cd "$(dirname "$0")"

echo "🔄 停止旧服务..."
while lsof -i :3000 -t 2>/dev/null | head -1 | grep -q .; do
    lsof -i :3000 -t 2>/dev/null | xargs kill -9 2>/dev/null; sleep 0.5
done
while lsof -i :8000 -t 2>/dev/null | head -1 | grep -q .; do
    lsof -i :8000 -t 2>/dev/null | xargs kill -9 2>/dev/null; sleep 0.5
done

echo "🚀 启动后端..."
cd backend
nohup python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > /tmp/backend.log 2>&1 &
cd ..

echo "🚀 启动前端..."
cd frontend
cp scripts/fix-node-localstorage.js /tmp/fix-node-localstorage.js
NODE_OPTIONS='--require /tmp/fix-node-localstorage.js' nohup npx next dev --port 3000 --hostname 127.0.0.1 > /tmp/nextdev.log 2>&1 &
cd ..

sleep 6
B=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health)
F=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/)
echo "后端: $B | 前端: $F"
[ "$B" = "200" ] && [ "$F" = "200" ] && echo "✅ 就绪" || echo "❌ 异常"
