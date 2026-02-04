#!/bin/bash
#
# Edit Factory - Development Server
# Starts backend (FastAPI) + frontend (Next.js) simultaneously
#
# Usage:
#   ./start-dev.sh          # Start all services + open browser
#   ./start-dev.sh backend  # Start only backend
#   ./start-dev.sh frontend # Start only frontend
#   ./start-dev.sh stop     # Stop all services
#

set -e

# ================================================
# Configuration
# ================================================
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID_FILE="$PROJECT_DIR/.backend.pid"
FRONTEND_PID_FILE="$PROJECT_DIR/.frontend.pid"
VENV_DIR="$PROJECT_DIR/venv_linux"
FRONTEND_DIR="$PROJECT_DIR/frontend"
LOGS_DIR="$PROJECT_DIR/logs"

# ================================================
# Colors
# ================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ================================================
# Functions
# ================================================

print_banner() {
    echo -e "${CYAN}"
    echo "  ================================================"
    echo "       EDIT FACTORY - Development Server"
    echo "  ================================================${NC}"
    echo ""
}

stop_services() {
    echo -e "${YELLOW}[STOP] Stopping services...${NC}"
    local stopped=0

    # Stop backend by PID file
    if [ -f "$BACKEND_PID_FILE" ]; then
        PID=$(cat "$BACKEND_PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" 2>/dev/null || true
            # Kill child processes too (uvicorn workers)
            pkill -P "$PID" 2>/dev/null || true
            echo -e "${GREEN}  Backend stopped (PID: $PID)${NC}"
            stopped=1
        fi
        rm -f "$BACKEND_PID_FILE"
    fi

    # Stop frontend by PID file
    if [ -f "$FRONTEND_PID_FILE" ]; then
        PID=$(cat "$FRONTEND_PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" 2>/dev/null || true
            pkill -P "$PID" 2>/dev/null || true
            echo -e "${GREEN}  Frontend stopped (PID: $PID)${NC}"
            stopped=1
        fi
        rm -f "$FRONTEND_PID_FILE"
    fi

    # Fallback: kill by port
    if command -v lsof &>/dev/null; then
        if lsof -ti:8000 >/dev/null 2>&1; then
            kill $(lsof -ti:8000) 2>/dev/null || true
            echo -e "${GREEN}  Process on port 8000 stopped${NC}"
            stopped=1
        fi
        if lsof -ti:3000 >/dev/null 2>&1; then
            kill $(lsof -ti:3000) 2>/dev/null || true
            echo -e "${GREEN}  Process on port 3000 stopped${NC}"
            stopped=1
        fi
    fi

    if [ $stopped -eq 0 ]; then
        echo -e "${YELLOW}  No active services found.${NC}"
    else
        echo -e "${GREEN}  All services stopped.${NC}"
    fi
    echo ""
}

check_port() {
    local port=$1
    local service=$2

    if command -v lsof &>/dev/null; then
        if lsof -ti:$port >/dev/null 2>&1; then
            local pid=$(lsof -ti:$port | head -1)
            echo -e "${YELLOW}[WARNING] Port $port is in use by PID: $pid${NC}"
            echo -n "  Kill process and continue? (y/n): "
            read -r response
            if [[ "$response" =~ ^[Yy]$ ]]; then
                kill $(lsof -ti:$port) 2>/dev/null || true
                sleep 1
                return 0
            else
                echo -e "${RED}  Aborting $service start.${NC}"
                return 1
            fi
        fi
    fi
    return 0
}

check_prerequisites() {
    local has_error=0

    # Check venv
    if [ ! -f "$VENV_DIR/bin/python" ]; then
        echo -e "${RED}[ERROR] Virtual environment not found at $VENV_DIR${NC}"
        echo ""
        echo "  Setup instructions:"
        echo "    python3 -m venv venv_linux"
        echo "    source venv_linux/bin/activate"
        echo "    pip install -r requirements.txt"
        echo ""
        has_error=1
    fi

    # Check .env
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        echo -e "${RED}[ERROR] .env file not found${NC}"
        echo ""
        echo "  Copy .env.example to .env and configure it:"
        echo "    cp .env.example .env"
        echo ""
        has_error=1
    fi

    if [ $has_error -eq 1 ]; then
        return 1
    fi

    # Check node_modules (auto-install if missing)
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        echo -e "${YELLOW}[SETUP] Installing frontend dependencies...${NC}"
        cd "$FRONTEND_DIR"
        npm install
        cd "$PROJECT_DIR"
    fi

    return 0
}

start_backend() {
    echo -e "${CYAN}[BACKEND] Starting FastAPI server...${NC}"

    # Check port availability
    if ! check_port 8000 "backend"; then
        return 1
    fi

    cd "$PROJECT_DIR"
    "$VENV_DIR/bin/python" run.py > "$LOGS_DIR/backend.log" 2>&1 &
    echo $! > "$BACKEND_PID_FILE"

    echo -e "${GREEN}  Backend started (PID: $(cat $BACKEND_PID_FILE))${NC}"
    echo -e "${GREEN}  API:  http://localhost:8000${NC}"
    echo -e "${GREEN}  Docs: http://localhost:8000/docs${NC}"
    echo -e "  Log:  $LOGS_DIR/backend.log"
    echo ""
}

start_frontend() {
    echo -e "${CYAN}[FRONTEND] Starting Next.js server...${NC}"

    # Check port availability
    if ! check_port 3000 "frontend"; then
        return 1
    fi

    cd "$FRONTEND_DIR"
    npm run dev > "$LOGS_DIR/frontend.log" 2>&1 &
    echo $! > "$FRONTEND_PID_FILE"
    cd "$PROJECT_DIR"

    echo -e "${GREEN}  Frontend started (PID: $(cat $FRONTEND_PID_FILE))${NC}"
    echo -e "${GREEN}  UI:   http://localhost:3000${NC}"
    echo -e "  Log:  $LOGS_DIR/frontend.log"
    echo ""
}

wait_for_services() {
    echo -e "${YELLOW}[WAIT] Waiting for services to be ready...${NC}"

    # Wait for backend (max 30 seconds)
    local backend_ready=0
    for i in $(seq 1 30); do
        if curl -s http://localhost:8000/docs >/dev/null 2>&1; then
            echo -e "${GREEN}  Backend: READY${NC}"
            backend_ready=1
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${RED}  Backend: TIMEOUT (check logs/backend.log)${NC}"
        fi
        sleep 1
    done

    # Wait for frontend (max 30 seconds)
    local frontend_ready=0
    for i in $(seq 1 30); do
        if curl -s http://localhost:3000 >/dev/null 2>&1; then
            echo -e "${GREEN}  Frontend: READY${NC}"
            frontend_ready=1
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${RED}  Frontend: TIMEOUT (check logs/frontend.log)${NC}"
        fi
        sleep 1
    done

    echo ""
}

open_browser() {
    local url="http://localhost:3000"
    echo -e "${CYAN}[BROWSER] Opening $url${NC}"

    # Detect platform and open browser accordingly
    if grep -qEi "(Microsoft|WSL)" /proc/version 2>/dev/null; then
        # WSL: Use Windows cmd.exe to open browser
        cmd.exe /c start "$url" 2>/dev/null || true
    elif command -v xdg-open &>/dev/null; then
        # Linux with xdg-open (most distros)
        xdg-open "$url" 2>/dev/null &
    elif command -v gnome-open &>/dev/null; then
        # Older GNOME
        gnome-open "$url" 2>/dev/null &
    elif command -v open &>/dev/null; then
        # macOS
        open "$url" 2>/dev/null &
    else
        echo -e "${YELLOW}  Could not auto-open browser. Please visit: $url${NC}"
    fi
    echo ""
}

display_info() {
    echo -e "${GREEN}  ================================================${NC}"
    echo -e "${GREEN}       Edit Factory is running!${NC}"
    echo -e "${GREEN}  ================================================${NC}"
    echo ""
    echo -e "  UI:   ${BOLD}http://localhost:3000${NC}"
    echo -e "  API:  ${BOLD}http://localhost:8000${NC}"
    echo -e "  Docs: ${BOLD}http://localhost:8000/docs${NC}"
    echo ""
    echo -e "  Logs:"
    echo "    Backend:  $LOGS_DIR/backend.log"
    echo "    Frontend: $LOGS_DIR/frontend.log"
    echo ""
    echo -e "  Stop all: ${CYAN}./start-dev.sh stop${NC}"
    echo -e "  ================================================"
    echo ""
}

# ================================================
# Main
# ================================================
print_banner

# Ensure logs directory exists
mkdir -p "$LOGS_DIR"

case "${1:-all}" in
    stop)
        stop_services
        ;;
    backend)
        if ! check_prerequisites; then
            exit 1
        fi
        stop_services
        start_backend
        ;;
    frontend)
        if ! check_prerequisites; then
            exit 1
        fi
        stop_services
        start_frontend
        ;;
    all|"")
        if ! check_prerequisites; then
            exit 1
        fi
        stop_services
        start_backend
        start_frontend
        wait_for_services
        open_browser
        display_info
        ;;
    *)
        echo "Usage: $0 [all|backend|frontend|stop]"
        exit 1
        ;;
esac
