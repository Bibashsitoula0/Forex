@echo off
title MT5 Bridge Setup
echo.
echo  ==========================================
echo   MetaTrader 5 Bridge — Python Setup
echo  ==========================================
echo.

:: Find Python
where python >nul 2>&1
if %errorlevel% equ 0 ( set PY=python ) else (
    where python3 >nul 2>&1
    if %errorlevel% equ 0 ( set PY=python3 ) else (
        echo [ERROR] Python not found!
        echo.
        echo  Please install Python 3.9+ from https://python.org
        echo  Make sure to check "Add Python to PATH" during install.
        echo.
        pause
        exit /b 1
    )
)

echo [1/2] Python found:
%PY% --version
echo.

echo [2/2] Installing MetaTrader5 + Flask...
%PY% -m pip install MetaTrader5 flask --upgrade
if %errorlevel% neq 0 (
    echo [ERROR] pip install failed.
    pause
    exit /b 1
)

echo.
echo  ==========================================
echo   Installation complete!
echo.
echo   BEFORE starting the bridge:
echo     1. Open MetaTrader 5
echo     2. Log in to your broker account
echo     3. Make sure XAUUSD is in Market Watch
echo.
echo   Then run:  python mt5_server.py
echo  ==========================================
echo.
pause
