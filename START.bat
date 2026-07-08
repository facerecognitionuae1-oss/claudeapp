@echo off
title UAEICP Employee Intelligence Workspace
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org (LTS version), then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies - first run only, takes a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo Starting server on http://localhost:3001 ...
start "" http://localhost:3001
node server/index.js
pause
