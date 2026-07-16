@echo off
chcp 65001 >nul
title DCS Control Hub - 开发模式
echo ========================================
echo   DCS Control Hub 开发模式启动器
echo ========================================
echo.
echo 正在启动开发服务器，请稍候...
echo.

cd /d "%~dp0"
npm run dev

echo.
echo 开发服务器已停止。
pause
