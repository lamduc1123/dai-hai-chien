@echo off
chcp 65001 > nul
title ĐẠI HẢI CHIẾN - MÁY CHỦ MULTIPLAYER

echo ==========================================================
echo        ⚓ ĐẠI HẢI CHIẾN: TRANH ĐOẠT 6 CHIẾN KHU
echo              MÁY CHỦ MULTIPLAYER THỜI GIAN THỰC
echo ==========================================================
echo.

cd /d "%~dp0"

echo [1/2] Đang kiểm tra thư viện Node.js...
if not exist "node_modules\" (
    echo Chưa có thư viện, đang tiến hành cài đặt...
    call npm.cmd install
)

echo.
echo [2/2] Đang khởi động máy chủ...
echo.

start "" cmd /c "timeout /t 2 > nul & start http://localhost:3000/screen"

node server.js
pause
