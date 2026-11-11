@echo off
title Crescent Library Server & Application
echo ========================================================
echo    B.S. Abdur Rahman Crescent Institute of Science and Technology
echo            Central Library Management System (CLMS)
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/3] Checking if Node.js is installed...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in your PATH. Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [2/3] Checking backend dependencies...
if not exist "backend\node_modules" (
    echo Installing backend dependencies...
    cd backend && npm install && cd ..
)

echo [3/3] Starting Crescent Library Server on port 5000...
echo.
echo Application will be available at: http://localhost:5000
echo Default Admin credentials:
echo   Email    : librarian@crescent.edu.in
echo   Password : Librarian@123
echo.
echo Registered Librarian credentials:
echo   Email    : azim6@gmail.com
echo   Password : azim@2006
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

