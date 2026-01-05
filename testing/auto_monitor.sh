#!/bin/bash
# =============================================================================
# EDIT FACTORY - Auto Monitor (Smart Testing Every 5 Minutes)
# Rulează teste VARIATE la fiecare 5 minute
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$SCRIPT_DIR/logs/auto_monitor.log"
PID_FILE="$SCRIPT_DIR/.auto_monitor.pid"
INTERVAL=300  # 5 minute

mkdir -p "$SCRIPT_DIR/logs"
mkdir -p "$SCRIPT_DIR/reports"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

run_smart_test() {
    log "=========================================="
    log "Starting SMART test session..."

    cd "$PROJECT_DIR"
    source venv_linux/bin/activate 2>/dev/null || true

    # Rulează smart tester
    python3 "$SCRIPT_DIR/smart_tester.py" 2>&1 | tee -a "$LOG_FILE"
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        log "✅ Session completed successfully"
    else
        log "⚠️ Session found issues (exit code: $exit_code)"
    fi

    log "=========================================="
    log "Next run in $((INTERVAL / 60)) minutes..."
    log ""
}

start_daemon() {
    if [ -f "$PID_FILE" ]; then
        local old_pid=$(cat "$PID_FILE")
        if kill -0 "$old_pid" 2>/dev/null; then
            echo "Auto monitor already running (PID: $old_pid)"
            exit 1
        fi
    fi

    log "Starting Auto Monitor daemon..."
    log "Interval: $INTERVAL seconds ($((INTERVAL / 60)) minutes)"
    log "PID: $$"

    echo $$ > "$PID_FILE"

    # Prima rulare imediat
    run_smart_test

    while true; do
        sleep $INTERVAL
        run_smart_test
    done
}

stop_daemon() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log "Stopping Auto Monitor (PID: $pid)..."
            kill "$pid"
            rm -f "$PID_FILE"
            echo "Auto Monitor stopped"
        else
            echo "Auto Monitor not running"
            rm -f "$PID_FILE"
        fi
    else
        echo "No PID file found"
    fi
}

status_daemon() {
    echo "=== AUTO MONITOR STATUS ==="
    echo ""

    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Status: RUNNING (PID: $pid)"
        else
            echo "Status: STOPPED (stale PID)"
        fi
    else
        echo "Status: STOPPED"
    fi

    echo ""
    echo "=== LAST 5 SESSIONS ==="
    ls -lt "$SCRIPT_DIR/reports/smart_test_"*.md 2>/dev/null | head -5

    echo ""
    echo "=== RECENT LOG ==="
    tail -20 "$LOG_FILE" 2>/dev/null || echo "No logs yet"
}

show_logs() {
    tail -f "$LOG_FILE"
}

run_once() {
    log "Running single smart test..."
    run_smart_test
}

case "$1" in
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    status)
        status_daemon
        ;;
    logs)
        show_logs
        ;;
    run)
        run_once
        ;;
    *)
        echo "Edit Factory - Auto Monitor"
        echo ""
        echo "Usage: $0 {start|stop|status|logs|run}"
        echo ""
        echo "Commands:"
        echo "  start   - Start daemon (tests every 5 min)"
        echo "  stop    - Stop daemon"
        echo "  status  - Show status and recent tests"
        echo "  logs    - Follow live logs"
        echo "  run     - Run one test session now"
        exit 1
        ;;
esac
