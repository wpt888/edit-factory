#!/bin/bash
# =============================================================================
# EDIT FACTORY - Platform Testing Script
# Rulează teste automate pentru întreaga platformă
# =============================================================================

set -e

# Configurare
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$SCRIPT_DIR/logs"
REPORT_FILE="$SCRIPT_DIR/reports/test_report_$(date +%Y%m%d_%H%M%S).md"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8001}"

# Culori pentru output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Creare directoare
mkdir -p "$LOG_DIR"
mkdir -p "$SCRIPT_DIR/reports"
mkdir -p "$SCRIPT_DIR/screenshots"

# Funcții helper
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%H:%M:%S') $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $(date '+%H:%M:%S') $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%H:%M:%S') $1"
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $(date '+%H:%M:%S') $1"
}

# Inițializare raport
init_report() {
    cat > "$REPORT_FILE" << EOF
# Edit Factory - Test Report
**Data:** $(date '+%Y-%m-%d %H:%M:%S')
**Versiune:** $(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "N/A")

---

## Rezultate Teste

| Test | Status | Durată | Detalii |
|------|--------|--------|---------|
EOF
}

# Adaugă rezultat în raport
add_to_report() {
    local test_name="$1"
    local status="$2"
    local duration="$3"
    local details="$4"

    if [ "$status" = "PASS" ]; then
        echo "| $test_name | ✅ PASS | ${duration}s | $details |" >> "$REPORT_FILE"
    else
        echo "| $test_name | ❌ FAIL | ${duration}s | $details |" >> "$REPORT_FILE"
    fi
}

# =============================================================================
# TESTE BACKEND
# =============================================================================

test_backend_health() {
    log_info "Testing Backend Health..."
    local start_time=$(date +%s)

    if curl -s --max-time 10 "$BACKEND_URL/api/v1/health" > /dev/null 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        log_success "Backend is healthy"
        add_to_report "Backend Health" "PASS" "$duration" "API responding"
        return 0
    else
        log_error "Backend not responding at $BACKEND_URL"
        add_to_report "Backend Health" "FAIL" "10" "Connection refused"
        return 1
    fi
}

test_backend_endpoints() {
    log_info "Testing Backend Endpoints..."
    local start_time=$(date +%s)
    local failed=0

    # Lista de endpoint-uri de testat
    local endpoints=(
        "/api/v1/health"
        "/api/v1/jobs"
        "/api/v1/library/projects"
        "/api/v1/voices"
    )

    for endpoint in "${endpoints[@]}"; do
        local response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BACKEND_URL$endpoint" 2>/dev/null)
        if [ "$response" = "200" ] || [ "$response" = "404" ]; then
            log_success "  $endpoint -> $response"
        else
            log_error "  $endpoint -> $response"
            ((failed++))
        fi
    done

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ $failed -eq 0 ]; then
        add_to_report "Backend Endpoints" "PASS" "$duration" "All endpoints responding"
        return 0
    else
        add_to_report "Backend Endpoints" "FAIL" "$duration" "$failed endpoints failed"
        return 1
    fi
}

# =============================================================================
# TESTE FRONTEND
# =============================================================================

test_frontend_health() {
    log_info "Testing Frontend Health..."
    local start_time=$(date +%s)

    if curl -s --max-time 10 "$FRONTEND_URL" > /dev/null 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        log_success "Frontend is healthy"
        add_to_report "Frontend Health" "PASS" "$duration" "Page loading"
        return 0
    else
        log_error "Frontend not responding at $FRONTEND_URL"
        add_to_report "Frontend Health" "FAIL" "10" "Connection refused"
        return 1
    fi
}

test_frontend_pages() {
    log_info "Testing Frontend Pages..."
    local start_time=$(date +%s)
    local failed=0

    # Lista de pagini de testat
    local pages=(
        "/"
        "/library"
        "/segments"
        "/usage"
    )

    for page in "${pages[@]}"; do
        local response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$FRONTEND_URL$page" 2>/dev/null)
        if [ "$response" = "200" ]; then
            log_success "  $page -> $response"
        else
            log_error "  $page -> $response"
            ((failed++))
        fi
    done

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ $failed -eq 0 ]; then
        add_to_report "Frontend Pages" "PASS" "$duration" "All pages loading"
        return 0
    else
        add_to_report "Frontend Pages" "FAIL" "$duration" "$failed pages failed"
        return 1
    fi
}

# =============================================================================
# TESTE SERVICII
# =============================================================================

test_ffmpeg() {
    log_info "Testing FFmpeg..."
    local start_time=$(date +%s)

    if command -v ffmpeg &> /dev/null; then
        local version=$(ffmpeg -version 2>&1 | head -n1)
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        log_success "FFmpeg available: $version"
        add_to_report "FFmpeg" "PASS" "$duration" "${version:0:50}"
        return 0
    else
        log_error "FFmpeg not found"
        add_to_report "FFmpeg" "FAIL" "0" "Not installed"
        return 1
    fi
}

test_python_services() {
    log_info "Testing Python Services..."
    local start_time=$(date +%s)

    cd "$PROJECT_ROOT"

    # Testăm importul serviciilor
    local result=$(python3 -c "
import sys
sys.path.insert(0, '.')
errors = []

try:
    from app.services.video_processor import VideoProcessor
    print('VideoProcessor: OK')
except Exception as e:
    errors.append(f'VideoProcessor: {e}')
    print(f'VideoProcessor: FAIL - {e}')

try:
    from app.services.silence_remover import SilenceRemover
    print('SilenceRemover: OK')
except Exception as e:
    errors.append(f'SilenceRemover: {e}')
    print(f'SilenceRemover: FAIL - {e}')

try:
    from app.services.voice_detector import VoiceDetector
    print('VoiceDetector: OK')
except Exception as e:
    errors.append(f'VoiceDetector: {e}')
    print(f'VoiceDetector: FAIL - {e}')

sys.exit(len(errors))
" 2>&1)

    local exit_code=$?
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    echo "$result"

    if [ $exit_code -eq 0 ]; then
        add_to_report "Python Services" "PASS" "$duration" "All services importable"
        return 0
    else
        add_to_report "Python Services" "FAIL" "$duration" "$exit_code services failed"
        return 1
    fi
}

# =============================================================================
# TESTE UI CU PLAYWRIGHT
# =============================================================================

test_ui_playwright() {
    log_info "Running Playwright UI Tests..."
    local start_time=$(date +%s)

    cd "$SCRIPT_DIR"

    if [ -f "playwright_tests.py" ]; then
        python3 playwright_tests.py --report "$SCRIPT_DIR/reports/playwright_$(date +%Y%m%d_%H%M%S).json" 2>&1 | tee "$LOG_DIR/playwright_$(date +%Y%m%d_%H%M%S).log"
        local exit_code=$?
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))

        if [ $exit_code -eq 0 ]; then
            add_to_report "UI Playwright Tests" "PASS" "$duration" "All UI tests passed"
            return 0
        else
            add_to_report "UI Playwright Tests" "FAIL" "$duration" "Some tests failed"
            return 1
        fi
    else
        log_warning "Playwright tests not found, skipping..."
        add_to_report "UI Playwright Tests" "SKIP" "0" "Tests not configured"
        return 0
    fi
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    log_info "=========================================="
    log_info "  EDIT FACTORY - Platform Test Suite"
    log_info "=========================================="
    log_info "Frontend: $FRONTEND_URL"
    log_info "Backend: $BACKEND_URL"
    log_info ""

    init_report

    local total_tests=0
    local passed_tests=0
    local failed_tests=0

    # Backend Tests
    log_info "--- BACKEND TESTS ---"
    if test_backend_health; then ((passed_tests++)); else ((failed_tests++)); fi
    ((total_tests++))

    if test_backend_endpoints; then ((passed_tests++)); else ((failed_tests++)); fi
    ((total_tests++))

    # Frontend Tests
    log_info ""
    log_info "--- FRONTEND TESTS ---"
    if test_frontend_health; then ((passed_tests++)); else ((failed_tests++)); fi
    ((total_tests++))

    if test_frontend_pages; then ((passed_tests++)); else ((failed_tests++)); fi
    ((total_tests++))

    # Service Tests
    log_info ""
    log_info "--- SERVICE TESTS ---"
    if test_ffmpeg; then ((passed_tests++)); else ((failed_tests++)); fi
    ((total_tests++))

    if test_python_services; then ((passed_tests++)); else ((failed_tests++)); fi
    ((total_tests++))

    # UI Tests (optional)
    log_info ""
    log_info "--- UI TESTS ---"
    if test_ui_playwright; then ((passed_tests++)); else ((failed_tests++)); fi
    ((total_tests++))

    # Finalizare raport
    cat >> "$REPORT_FILE" << EOF

---

## Sumar

- **Total teste:** $total_tests
- **Passed:** $passed_tests ✅
- **Failed:** $failed_tests ❌
- **Success Rate:** $(echo "scale=1; $passed_tests * 100 / $total_tests" | bc)%

---

## Logs

Logs salvate în: \`$LOG_DIR\`

## Următoarea rulare

Script-ul poate fi rulat automat cu:
\`\`\`bash
# Cron job (la fiecare 5 minute)
*/5 * * * * $SCRIPT_DIR/test_platform.sh >> $LOG_DIR/cron.log 2>&1
\`\`\`
EOF

    log_info ""
    log_info "=========================================="
    log_info "  TEST SUMMARY"
    log_info "=========================================="
    log_info "Total: $total_tests | Passed: $passed_tests | Failed: $failed_tests"
    log_info "Report saved to: $REPORT_FILE"
    log_info "=========================================="

    if [ $failed_tests -gt 0 ]; then
        exit 1
    fi
    exit 0
}

# Run main
main "$@"
