@echo off
title Coach-C Launcher
echo Starting Coach-C...
echo.

:: Kill anything already on ports 3000 and 8000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " 2^>nul') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " 2^>nul') do taskkill /PID %%a /F >nul 2>&1

timeout /t 1 /nobreak >nul

:: Start backend
start "Coach-C Backend" cmd /k "cd /d C:\Coach-C\backend && python -m uvicorn app.main:app --port 8000"

timeout /t 4 /nobreak >nul

:: Start frontend
start "Coach-C Frontend" cmd /k "cd /d C:\Coach-C\frontend && npm run dev"

timeout /t 15 /nobreak >nul

:: Open browser
start http://localhost:3000

echo Coach-C is running. Close the two server windows to shut down.
