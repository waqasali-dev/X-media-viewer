@echo off
echo ========================================================
echo Starting X Media Archive
echo Backend:  http://localhost:4000
echo Frontend: http://localhost:3000
echo ========================================================

start "X Archive Backend (Port 4000)" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 2 /nobreak >nul
start "X Archive Frontend (Port 3000)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo Both services launched in separate terminal windows.
