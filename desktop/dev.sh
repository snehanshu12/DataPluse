#!/bin/bash
# 一键启动 Vite + Electron（HMR 开发模式）
# 用法: ./dev.sh

set -e

PORT=5174
PROJECT="datapulse-desktop"

echo "==> [$PROJECT] 启动开发模式..."

# 清理残留进程
echo "==> 清理残留进程..."
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
pkill -f "electron.*desktop" 2>/dev/null || true
sleep 1

# 启动 Vite 开发服务器
echo "==> 启动 Vite 开发服务器 (:$PORT)..."
npm run dev &
VITE_PID=$!

# 等待 Vite 端口就绪
echo "==> 等待 Vite 启动..."
for i in $(seq 1 30); do
  if lsof -ti:$PORT >/dev/null 2>&1; then
    echo "==> Vite 已就绪 (:$PORT)"
    break
  fi
  sleep 1
done

# 启动 Electron
echo "==> 启动 Electron..."
npm run dev:electron &
ELECTRON_PID=$!

# 等待 Electron 退出
wait $ELECTRON_PID

# 清理 Vite 进程
echo "==> Electron 已退出，清理 Vite 进程..."
kill $VITE_PID 2>/dev/null || true
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

echo "==> [$PROJECT] 已退出"
