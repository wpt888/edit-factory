#!/bin/bash
#
# Edit Factory - Local Deploy
# Porneste backend (FastAPI) + frontend (Next.js) simultan
#
# Folosire:
#   ./deploy-local.sh          # porneste tot
#   ./deploy-local.sh backend  # doar backend
#   ./deploy-local.sh frontend # doar frontend
#   ./deploy-local.sh stop     # opreste tot
#

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID_FILE="$PROJECT_DIR/.backend.pid"
FRONTEND_PID_FILE="$PROJECT_DIR/.frontend.pid"
VENV_DIR="$PROJECT_DIR/venv_linux"
FRONTEND_DIR="$PROJECT_DIR/frontend"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_banner() {
    echo -e "${CYAN}"
    echo "  ================================================"
    echo "           EDIT FACTORY - Local Deploy"
    echo "  ================================================${NC}"
    echo ""
}

stop_services() {
    echo -e "${YELLOW}Oprire servicii...${NC}"
    local stopped=0

    if [ -f "$BACKEND_PID_FILE" ]; then
        PID=$(cat "$BACKEND_PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" 2>/dev/null
            # Kill child processes too (uvicorn workers)
            pkill -P "$PID" 2>/dev/null || true
            echo -e "${GREEN}  Backend oprit (PID: $PID)${NC}"
            stopped=1
        fi
        rm -f "$BACKEND_PID_FILE"
    fi

    if [ -f "$FRONTEND_PID_FILE" ]; then
        PID=$(cat "$FRONTEND_PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" 2>/dev/null
            pkill -P "$PID" 2>/dev/null || true
            echo -e "${GREEN}  Frontend oprit (PID: $PID)${NC}"
            stopped=1
        fi
        rm -f "$FRONTEND_PID_FILE"
    fi

    # Fallback: kill by port
    if lsof -ti:8000 >/dev/null 2>&1; then
        kill $(lsof -ti:8000) 2>/dev/null || true
        echo -e "${GREEN}  Proces pe port 8000 oprit${NC}"
        stopped=1
    fi
    if lsof -ti:3000 >/dev/null 2>&1; then
        kill $(lsof -ti:3000) 2>/dev/null || true
        echo -e "${GREEN}  Proces pe port 3000 oprit${NC}"
        stopped=1
    fi

    if [ $stopped -eq 0 ]; then
        echo -e "${YELLOW}  Niciun serviciu activ gasit.${NC}"
    else
        echo -e "${GREEN}Toate serviciile au fost oprite.${NC}"
    fi
}

start_backend() {
    echo -e "${CYAN}[Backend] Pornire FastAPI...${NC}"

    # Check venv
    if [ ! -f "$VENV_DIR/bin/python" ]; then
        echo -e "${RED}  EROARE: venv_linux nu exista. Ruleaza:${NC}"
        echo "    python3 -m venv venv_linux"
        echo "    source venv_linux/bin/activate"
        echo "    pip install -r requirements.txt"
        return 1
    fi

    # Check .env
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        echo -e "${RED}  EROARE: .env nu exista. Copiaza .env.example in .env${NC}"
        return 1
    fi

    # Kill existing process on port 8000
    if lsof -ti:8000 >/dev/null 2>&1; then
        echo -e "${YELLOW}  Port 8000 ocupat, oprire proces existent...${NC}"
        kill $(lsof -ti:8000) 2>/dev/null || true
        sleep 1
    fi

    cd "$PROJECT_DIR"
    "$VENV_DIR/bin/python" run.py > "$PROJECT_DIR/logs/backend.log" 2>&1 &
    echo $! > "$BACKEND_PID_FILE"
    echo -e "${GREEN}  Backend pornit (PID: $(cat $BACKEND_PID_FILE))${NC}"
    echo -e "${GREEN}  API:  http://localhost:8000${NC}"
    echo -e "${GREEN}  Docs: http://localhost:8000/docs${NC}"
    echo -e "  Log:  $PROJECT_DIR/logs/backend.log"
}

start_frontend() {
    echo -e "${CYAN}[Frontend] Pornire Next.js...${NC}"

    # Check node_modules
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        echo -e "${YELLOW}  node_modules nu exista, instalare dependinte...${NC}"
        cd "$FRONTEND_DIR"
        npm install
    fi

    # Kill existing process on port 3000
    if lsof -ti:3000 >/dev/null 2>&1; then
        echo -e "${YELLOW}  Port 3000 ocupat, oprire proces existent...${NC}"
        kill $(lsof -ti:3000) 2>/dev/null || true
        sleep 1
    fi

    cd "$FRONTEND_DIR"
    npm run dev > "$PROJECT_DIR/logs/frontend.log" 2>&1 &
    echo $! > "$FRONTEND_PID_FILE"
    echo -e "${GREEN}  Frontend pornit (PID: $(cat $FRONTEND_PID_FILE))${NC}"
    echo -e "${GREEN}  UI:   http://localhost:3000${NC}"
    echo -e "  Log:  $PROJECT_DIR/logs/frontend.log"
}

wait_for_services() {
    echo ""
    echo -e "${YELLOW}Asteptare pornire servicii...${NC}"

    # Wait for backend
    for i in $(seq 1 30); do
        if curl -s http://localhost:8000/docs >/dev/null 2>&1; then
            echo -e "${GREEN}  Backend: READY${NC}"
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${RED}  Backend: TIMEOUT (verifica logs/backend.log)${NC}"
        fi
        sleep 1
    done

    # Wait for frontend
    for i in $(seq 1 30); do
        if curl -s http://localhost:3000 >/dev/null 2>&1; then
            echo -e "${GREEN}  Frontend: READY${NC}"
            break
        fi
        if [ $i -eq 30 ]; then
            echo -e "${RED}  Frontend: TIMEOUT (verifica logs/frontend.log)${NC}"
        fi
        sleep 1
    done

    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}  Edit Factory ruleaza local!${NC}"
    echo -e "${GREEN}  UI:   http://localhost:3000${NC}"
    echo -e "${GREEN}  API:  http://localhost:8000${NC}"
    echo -e "${GREEN}  Docs: http://localhost:8000/docs${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo -e "  Oprire: ${CYAN}./deploy-local.sh stop${NC}"
    echo -e "  Logs:   ${CYAN}tail -f logs/backend.log${NC}"
    echo -e "          ${CYAN}tail -f logs/frontend.log${NC}"
}

# --- Main ---
print_banner

# Ensure logs dir exists
mkdir -p "$PROJECT_DIR/logs"

case "${1:-all}" in
    stop)
        stop_services
        ;;
    backend)
        stop_services
        start_backend
        ;;
    frontend)
        stop_services
        start_frontend
        ;;
    all|"")
        stop_services
        echo ""
        start_backend
        echo ""
        # Asteapta ca backend-ul sa fie ready inainte de frontend
        echo -e "${YELLOW}Asteptare backend ready...${NC}"
        for i in $(seq 1 30); do
            if curl -s http://localhost:8000/docs >/dev/null 2>&1; then
                echo -e "${GREEN}  Backend: READY${NC}"
                break
            fi
            if [ $i -eq 30 ]; then
                echo -e "${RED}  Backend: TIMEOUT - pornesc frontend oricum${NC}"
            fi
            sleep 1
        done
        echo ""
        start_frontend
        wait_for_services
        ;;
    *)
        echo "Folosire: $0 [all|backend|frontend|stop]"
        exit 1
        ;;
esac
