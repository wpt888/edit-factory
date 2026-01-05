#!/bin/bash
# =============================================================================
# EDIT FACTORY - Monitoring Daemon
# Rulează teste automate la fiecare 5 minute
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/monitor.log"
PID_FILE="$SCRIPT_DIR/.monitor.pid"
INTERVAL=300  # 5 minute în secunde

# Creare directoare
mkdir -p "$SCRIPT_DIR/logs"
mkdir -p "$SCRIPT_DIR/reports"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

start_monitor() {
    if [ -f "$PID_FILE" ]; then
        local old_pid=$(cat "$PID_FILE")
        if kill -0 "$old_pid" 2>/dev/null; then
            echo "Monitor already running with PID $old_pid"
            exit 1
        fi
    fi

    log "Starting Edit Factory Monitor..."
    log "Interval: $INTERVAL seconds ($(($INTERVAL / 60)) minutes)"
    log "PID: $$"

    echo $$ > "$PID_FILE"

    while true; do
        log "=========================================="
        log "Running scheduled tests..."

        # Rulează testele
        "$SCRIPT_DIR/test_platform.sh" >> "$LOG_FILE" 2>&1
        local exit_code=$?

        if [ $exit_code -eq 0 ]; then
            log "✅ All tests passed"
        else
            log "❌ Some tests failed (exit code: $exit_code)"

            # Opțional: trimite notificare
            # curl -X POST "https://hooks.slack.com/..." -d '{"text":"Tests failed!"}'
        fi

        log "Next run in $INTERVAL seconds..."
        log "=========================================="

        sleep $INTERVAL
    done
}

stop_monitor() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log "Stopping monitor (PID: $pid)..."
            kill "$pid"
            rm -f "$PID_FILE"
            echo "Monitor stopped"
        else
            echo "Monitor not running"
            rm -f "$PID_FILE"
        fi
    else
        echo "No PID file found"
    fi
}

status_monitor() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Monitor is running (PID: $pid)"
            echo ""
            echo "Last 10 log entries:"
            tail -10 "$LOG_FILE"
        else
            echo "Monitor is not running (stale PID file)"
        fi
    else
        echo "Monitor is not running"
    fi
}

show_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo "No log file found"
    fi
}

show_reports() {
    echo "Recent test reports:"
    ls -la "$SCRIPT_DIR/reports/" | tail -10
}

# Main
case "$1" in
    start)
        start_monitor
        ;;
    stop)
        stop_monitor
        ;;
    status)
        status_monitor
        ;;
    logs)
        show_logs
        ;;
    reports)
        show_reports
        ;;
    run-once)
        log "Running single test..."
        "$SCRIPT_DIR/test_platform.sh"
        ;;
    *)
        echo "Usage: $0 {start|stop|status|logs|reports|run-once}"
        echo ""
        echo "Commands:"
        echo "  start     - Start the monitoring daemon"
        echo "  stop      - Stop the monitoring daemon"
        echo "  status    - Check if monitor is running"
        echo "  logs      - Follow the log file"
        echo "  reports   - List recent test reports"
        echo "  run-once  - Run tests once without daemon"
        exit 1
        ;;
esac
