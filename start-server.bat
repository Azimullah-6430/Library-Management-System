@echo off
title Crescent Library Server & Application
echo ========================================================
echo    B.S. Abdur Rahman Crescent Institute of Science and Technology
echo            Central Library Management System (CLMS)
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/4] Checking Node.js installation...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in your PATH. Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [2/4] Verifying dependencies...
if not exist "backend\node_modules" (
    echo Installing backend dependencies...
    cd backend && npm install && cd ..
)

echo [3/4] Ensuring port 5000 is available...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5000 ^| findstr LISTENING 2^>nul') do (
    taskkill /f /pid %%a >nul 2>nul
)

echo [4/4] Starting Crescent Library Server on port 5000...
echo.
echo Application will be available at: http://localhost:5000
echo.
echo (Press Ctrl+C in this window anytime to stop the server)
echo ========================================================
echo.

:: Open browser after 2 seconds in parallel
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5000"

:: Start the server
cd backend
node src/server.js
pause

