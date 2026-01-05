#!/bin/bash
# Quick Test Script pentru Edit Factory

FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "  EDIT FACTORY - Quick Test"
echo "========================================"
echo "Backend: $BACKEND_URL"
echo "Frontend: $FRONTEND_URL"
echo ""

PASSED=0
FAILED=0

test_url() {
    local name="$1"
    local url="$2"

    response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$url" 2>/dev/null)

    if [ "$response" = "200" ]; then
        echo "✅ $name: OK ($response)"
        ((PASSED++))
    else
        echo "❌ $name: FAIL ($response)"
        ((FAILED++))
    fi
}

echo "--- Backend Tests ---"
test_url "Health Check" "$BACKEND_URL/api/v1/health"
test_url "Jobs Endpoint" "$BACKEND_URL/api/v1/jobs"
test_url "Projects Endpoint" "$BACKEND_URL/api/v1/library/projects"

echo ""
echo "--- Frontend Tests ---"
test_url "Home Page" "$FRONTEND_URL/"
test_url "Library Page" "$FRONTEND_URL/library"
test_url "Segments Page" "$FRONTEND_URL/segments"
test_url "Usage Page" "$FRONTEND_URL/usage"

echo ""
echo "--- Service Tests ---"

# FFmpeg
if command -v ffmpeg &> /dev/null; then
    echo "✅ FFmpeg: Available"
    ((PASSED++))
else
    echo "❌ FFmpeg: Not found"
    ((FAILED++))
fi

# Python imports
cd "$(dirname "$SCRIPT_DIR")"
source venv_linux/bin/activate 2>/dev/null || true
python_test=$(python3 -c "
import sys
sys.path.insert(0, '.')
errors = []
try:
    from app.services.silence_remover import SilenceRemover
except Exception as e:
    errors.append(f'SilenceRemover: {e}')
try:
    from app.services.voice_detector import VoiceDetector
except Exception as e:
    errors.append(f'VoiceDetector: {e}')
try:
    from app.config import get_settings
except Exception as e:
    errors.append(f'Config: {e}')
if errors:
    print('FAIL: ' + '; '.join(errors))
else:
    print('OK')
" 2>&1)

if [ "$python_test" = "OK" ]; then
    echo "✅ Python Services: Importable"
    ((PASSED++))
else
    echo "❌ Python Services: $python_test"
    ((FAILED++))
fi

echo ""
echo "========================================"
echo "  SUMMARY: $PASSED passed, $FAILED failed"
echo "========================================"

# Salvează raport
REPORT="$SCRIPT_DIR/reports/quick_$(date +%Y%m%d_%H%M%S).txt"
mkdir -p "$SCRIPT_DIR/reports"
{
    echo "Edit Factory Quick Test - $(date)"
    echo "Passed: $PASSED"
    echo "Failed: $FAILED"
} > "$REPORT"

echo "Report: $REPORT"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0
