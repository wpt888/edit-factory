@echo off
setlocal EnableDelayedExpansion

:: ================================================
::        EDIT FACTORY - Development Server
:: ================================================
:: Usage:
::   start-dev.bat          - Start all services
::   start-dev.bat stop     - Stop all services
::   start-dev.bat backend  - Start only backend
::   start-dev.bat frontend - Start only frontend
:: ================================================

:: Setup paths
set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "VENV_DIR=%PROJECT_DIR%\venv"
set "FRONTEND_DIR=%PROJECT_DIR%\frontend"
set "LOGS_DIR=%PROJECT_DIR%\logs"
set "BACKEND_PID_FILE=%PROJECT_DIR%\.backend.pid"
set "FRONTEND_PID_FILE=%PROJECT_DIR%\.frontend.pid"

:: Create logs directory
if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"

:: Display banner
echo.
echo   ================================================
echo          EDIT FACTORY - Development Server
echo   ================================================
echo.

:: Handle arguments
if "%1"=="" goto :start_all
if /i "%1"=="all" goto :start_all
if /i "%1"=="stop" goto :stop_services
if /i "%1"=="backend" goto :start_backend_only
if /i "%1"=="frontend" goto :start_frontend_only
echo Usage: %0 [all^|stop^|backend^|frontend]
exit /b 1

:stop_services
echo [STOP] Stopping services...

:: Stop backend by PID file
if exist "%BACKEND_PID_FILE%" (
    set /p BACKEND_PID=<"%BACKEND_PID_FILE%"
    echo   Stopping backend PID: !BACKEND_PID!
    taskkill /F /PID !BACKEND_PID! /T >nul 2>&1
    del "%BACKEND_PID_FILE%" >nul 2>&1
)

:: Stop frontend by PID file
if exist "%FRONTEND_PID_FILE%" (
    set /p FRONTEND_PID=<"%FRONTEND_PID_FILE%"
    echo   Stopping frontend PID: !FRONTEND_PID!
    taskkill /F /PID !FRONTEND_PID! /T >nul 2>&1
    del "%FRONTEND_PID_FILE%" >nul 2>&1
)

:: Fallback: kill by port
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    echo   Killing process on port 8000: %%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    echo   Killing process on port 3000: %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo   Services stopped.
echo.
goto :eof

:check_prerequisites
:: Check venv
if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found at %VENV_DIR%
    echo.
    echo   Setup instructions:
    echo     python -m venv venv
    echo     venv\Scripts\activate
    echo     pip install -r requirements.txt
    echo.
    exit /b 1
)

:: Check .env
if not exist "%PROJECT_DIR%\.env" (
    echo [ERROR] .env file not found
    echo.
    echo   Copy .env.example to .env and configure it:
    echo     copy .env.example .env
    echo.
    exit /b 1
)

:: Check node_modules
if not exist "%FRONTEND_DIR%\node_modules" (
    echo [SETUP] Installing frontend dependencies...
    cd /d "%FRONTEND_DIR%"
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed
        exit /b 1
    )
    cd /d "%PROJECT_DIR%"
)

exit /b 0

:check_port_8000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    echo [WARNING] Port 8000 is in use by PID: %%a
    set /p KILL_8000="Kill process? (y/n): "
    if /i "!KILL_8000!"=="y" (
        taskkill /F /PID %%a >nul 2>&1
        timeout /t 1 /nobreak >nul
    ) else (
        echo   Aborting backend start.
        exit /b 1
    )
)
exit /b 0

:check_port_3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    echo [WARNING] Port 3000 is in use by PID: %%a
    set /p KILL_3000="Kill process? (y/n): "
    if /i "!KILL_3000!"=="y" (
        taskkill /F /PID %%a >nul 2>&1
        timeout /t 1 /nobreak >nul
    ) else (
        echo   Aborting frontend start.
        exit /b 1
    )
)
exit /b 0

:start_backend
echo [BACKEND] Starting FastAPI server...

:: Check port availability
call :check_port_8000
if errorlevel 1 exit /b 1

:: Start backend in background and capture PID
start /B cmd /c "cd /d "%PROJECT_DIR%" && call "%VENV_DIR%\Scripts\activate.bat" && python run.py > "%LOGS_DIR%\backend.log" 2>&1"

:: Wait a moment and get the PID
timeout /t 2 /nobreak >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    echo %%a > "%BACKEND_PID_FILE%"
    echo   Backend started (PID: %%a)
)

echo   API:  http://localhost:8000
echo   Docs: http://localhost:8000/docs
echo   Log:  %LOGS_DIR%\backend.log
echo.
exit /b 0

:start_frontend
echo [FRONTEND] Starting Next.js server...

:: Check port availability
call :check_port_3000
if errorlevel 1 exit /b 1

:: Start frontend in background
start /B cmd /c "cd /d "%FRONTEND_DIR%" && npm run dev > "%LOGS_DIR%\frontend.log" 2>&1"

:: Wait a moment and get the PID
timeout /t 2 /nobreak >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    echo %%a > "%FRONTEND_PID_FILE%"
    echo   Frontend started (PID: %%a)
)

echo   UI:   http://localhost:3000
echo   Log:  %LOGS_DIR%\frontend.log
echo.
exit /b 0

:wait_for_services
echo [WAIT] Waiting for services to be ready...

:: Wait for backend (max 30 seconds)
set BACKEND_READY=0
for /l %%i in (1,1,30) do (
    if !BACKEND_READY!==0 (
        curl -s http://localhost:8000/docs >nul 2>&1
        if !errorlevel!==0 (
            echo   Backend: READY
            set BACKEND_READY=1
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)
if !BACKEND_READY!==0 (
    echo   Backend: TIMEOUT (check logs\backend.log)
)

:: Wait for frontend (max 30 seconds)
set FRONTEND_READY=0
for /l %%i in (1,1,30) do (
    if !FRONTEND_READY!==0 (
        curl -s http://localhost:3000 >nul 2>&1
        if !errorlevel!==0 (
            echo   Frontend: READY
            set FRONTEND_READY=1
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)
if !FRONTEND_READY!==0 (
    echo   Frontend: TIMEOUT (check logs\frontend.log)
)

echo.
exit /b 0

:open_browser
echo [BROWSER] Opening http://localhost:3000
start http://localhost:3000
exit /b 0

:display_info
echo   ================================================
echo          Edit Factory is running!
echo   ================================================
echo.
echo   UI:   http://localhost:3000
echo   API:  http://localhost:8000
echo   Docs: http://localhost:8000/docs
echo.
echo   Logs:
echo     Backend:  %LOGS_DIR%\backend.log
echo     Frontend: %LOGS_DIR%\frontend.log
echo.
echo   Stop all: start-dev.bat stop
echo   ================================================
echo.
exit /b 0

:start_backend_only
call :check_prerequisites
if errorlevel 1 exit /b 1
call :start_backend
goto :eof

:start_frontend_only
call :check_prerequisites
if errorlevel 1 exit /b 1
call :start_frontend
goto :eof

:start_all
call :check_prerequisites
if errorlevel 1 exit /b 1

call :start_backend
call :start_frontend
call :wait_for_services
call :open_browser
call :display_info

endlocal
