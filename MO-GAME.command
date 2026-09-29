#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================================="
echo "       ⚓ ĐẠI HẢI CHIẾN: TRANH ĐOẠT 6 CHIẾN KHU"
echo "             MÁY CHỦ MULTIPLAYER THỜI GIAN THỰC"
echo "=========================================================="
echo ""

if [ ! -d "node_modules" ]; then
    echo "Chưa có thư viện, đang tiến hành cài đặt..."
    npm install
fi

echo "Đang mở trình duyệt..."
sleep 1
open "http://localhost:3000/screen"

node server.js
