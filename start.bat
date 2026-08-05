@echo off
title XAU/USD Trading Analysis
color 0A
echo.
echo  ============================================
echo   XAU/USD Gold Trading Analysis Application
echo  ============================================
echo.

:: ── Check Node.js ──
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)

:: ── Backend deps ──
echo [1/5] Checking backend (Node.js) dependencies...
cd /d "%~dp0backend"
if not exist node_modules (
    echo       Installing...
    npm install --silent
)
echo       OK.

:: ── Frontend deps ──
echo [2/5] Checking frontend (React) dependencies...
cd /d "%~dp0frontend"
if not exist node_modules (
    echo       Installing npm packages (first run takes ~30s)...
    npm install --silent
)
echo       OK.

:: ── MT5 Bridge (optional) ──
echo [3/5] Checking MetaTrader 5 bridge (optional)...
set PY=
where python  >nul 2>&1 && set PY=python
if "%PY%"=="" ( where python3 >nul 2>&1 && set PY=python3 )

if "%PY%"=="" (
    echo       Python not found — MT5 bridge skipped.
    echo       Data source: Yahoo Finance ^(fallback^)
    echo       To enable MT5: install Python from https://python.org
    echo         then run: backend\mt5_bridge\install.bat
) else (
    %PY% -c "import MetaTrader5" >nul 2>&1
    if %errorlevel% equ 0 (
        echo       MetaTrader5 package found — starting bridge...
        start "MT5 Bridge (port 8001)" cmd /k "cd /d %~dp0backend\mt5_bridge && %PY% mt5_server.py"
        timeout /t 3 /nobreak >nul
        echo       MT5 Bridge started on port 8001
    ) else (
        echo       MetaTrader5 package not installed.
        echo       Run backend\mt5_bridge\install.bat to set it up.
        echo       Falling back to Yahoo Finance.
    )
)

:: ── Start backend ──
echo [4/5] Starting Node.js backend on http://localhost:8000 ...
start "XAU Backend (port 8000)" cmd /k "cd /d %~dp0backend && node server.js"
timeout /t 2 /nobreak >nul

:: ── Start frontend ──
echo [5/5] Starting React frontend on http://localhost:5173 ...
start "XAU Frontend (port 5173)" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 4 /nobreak >nul

echo.
echo  ============================================
echo   All services started!
echo.
echo   App         :  http://localhost:5173
echo   Backend API :  http://localhost:8000/api/health
echo   MT5 Bridge  :  http://localhost:8001/health
echo  ============================================
echo.
echo  Press any key to open the app...
pause >nul
start "" "http://localhost:5173"
