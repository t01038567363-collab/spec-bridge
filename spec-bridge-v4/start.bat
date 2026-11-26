@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 가 필요합니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=3000
start "" "http://localhost:%PORT%/"
echo 스펙 브릿지 서버를 시작합니다. 종료하려면 이 창을 닫으세요.
node server.js
pause
