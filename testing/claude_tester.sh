#!/bin/bash
# =============================================================================
# EDIT FACTORY - Claude Code Auto Tester
# Trimite prompt-uri la Claude Code pentru testare autonomă
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$SCRIPT_DIR/logs/claude_tester.log"
PROMPTS_FILE="$SCRIPT_DIR/test_prompts.txt"
STATE_FILE="$SCRIPT_DIR/.claude_state.json"
RESULTS_DIR="$SCRIPT_DIR/claude_results"

mkdir -p "$SCRIPT_DIR/logs"
mkdir -p "$RESULTS_DIR"

# Prompt-uri variate pentru testare
PROMPTS=(
    "Folosește Playwright MCP să navighezi pe http://localhost:3000 și verifică dacă pagina se încarcă corect. Fă un screenshot și raportează ce vezi."

    "Navighează pe http://localhost:3000/library cu Playwright. Verifică dacă există proiecte, dacă butoanele funcționează. Caută buguri vizuale."

    "Testează pagina /segments: navighează acolo, verifică video player-ul, timeline-ul, controalele. Încearcă să dai click pe elemente și raportează problemele."

    "Verifică pagina de usage http://localhost:3000/usage - caută erori în consolă, verifică dacă statisticile se încarcă."

    "Fă un test de responsive: navighează pe home page, redimensionează browser-ul la 375x812 (mobil) și verifică dacă UI-ul arată bine."

    "Testează fluxul de upload: mergi pe home page, caută zona de upload, verifică dacă input-ul pentru fișiere există și funcționează."

    "Explorează tab-urile din home page: dă click pe fiecare tab, verifică că conținutul se schimbă, caută erori."

    "Verifică toate butoanele vizibile de pe pagina curentă - sunt clickable? Au hover states? Raportează problemele."

    "Caută erori de consolă pe toate paginile: navighează prin /, /library, /segments, /usage și colectează erorile JavaScript."

    "Testează formularul de setări subtitrări: găsește sliderul de font size, încearcă să-l miști, verifică că valoarea se actualizează."
)

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

get_random_prompt() {
    local idx=$((RANDOM % ${#PROMPTS[@]}))
    echo "${PROMPTS[$idx]}"
}

run_claude_test() {
    local prompt="$1"
    local session_id=$(date +%Y%m%d_%H%M%S)
    local result_file="$RESULTS_DIR/test_$session_id.md"

    log "=========================================="
    log "SESSION: $session_id"
    log "PROMPT: ${prompt:0:80}..."
    log "=========================================="

    # Construim prompt-ul complet
    local full_prompt="Ești în modul de testare automată a platformei Edit Factory.

TASK: $prompt

INSTRUCȚIUNI:
1. Folosește mcp__playwright tools pentru a interacționa cu browser-ul
2. Navighează, dă click, verifică elemente
3. Fă screenshots dacă găsești probleme
4. Raportează clar ce ai găsit: buguri, erori, probleme de UI
5. La final, scrie un SUMAR cu: ✅ ce funcționează, ❌ ce nu funcționează

Începe testarea acum."

    # Salvăm prompt-ul
    echo "# Test Session: $session_id" > "$result_file"
    echo "" >> "$result_file"
    echo "## Prompt" >> "$result_file"
    echo "$prompt" >> "$result_file"
    echo "" >> "$result_file"
    echo "## Result" >> "$result_file"
    echo "" >> "$result_file"

    # Rulăm Claude Code cu prompt-ul
    # Folosim -p pentru output non-interactiv
    cd "$PROJECT_DIR"

    log "Running Claude Code..."

    # Timeout de 3 minute pentru fiecare test
    # Folosim pipe pentru input și --allowed-tools pentru Playwright
    echo "$full_prompt" | timeout 180 claude -p \
        --allowed-tools "mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_click,mcp__playwright__browser_close,mcp__playwright__browser_console_messages,mcp__playwright__browser_tabs,mcp__playwright__browser_type,mcp__playwright__browser_resize" \
        2>&1 | tee -a "$result_file"

    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        log "✅ Test completed successfully"
    elif [ $exit_code -eq 124 ]; then
        log "⚠️ Test timed out after 3 minutes"
        echo "" >> "$result_file"
        echo "**TIMEOUT**: Test exceeded 3 minute limit" >> "$result_file"
    else
        log "❌ Test failed with exit code: $exit_code"
    fi

    log "Result saved to: $result_file"
    log ""
}

run_interactive_session() {
    # Sesiune interactivă unde Claude testează și apoi primește follow-up
    local session_id=$(date +%Y%m%d_%H%M%S)

    log "Starting interactive test session: $session_id"

    # Prima rundă: explorare generală
    local prompt1="Navighează pe http://localhost:3000 cu Playwright MCP. Explorează pagina, verifică ce elemente există, fă un screenshot. Raportează structura paginii."

    run_claude_test "$prompt1"

    # A doua rundă: căutare buguri
    sleep 5
    local prompt2="Continuă testarea: mergi pe /segments, testează video player-ul dacă există, verifică timeline-ul, caută buguri de UI sau funcționalitate."

    run_claude_test "$prompt2"

    # A treia rundă: verificare erori
    sleep 5
    local prompt3="Verifică erorile: navighează prin toate paginile și colectează erorile din consolă. Listează toate problemele găsite."

    run_claude_test "$prompt3"
}

# Main
case "$1" in
    run)
        prompt=$(get_random_prompt)
        run_claude_test "$prompt"
        ;;
    session)
        run_interactive_session
        ;;
    loop)
        log "Starting continuous testing loop (5 min interval)..."
        while true; do
            prompt=$(get_random_prompt)
            run_claude_test "$prompt"
            log "Next test in 5 minutes..."
            sleep 300
        done
        ;;
    custom)
        if [ -z "$2" ]; then
            echo "Usage: $0 custom \"your prompt here\""
            exit 1
        fi
        run_claude_test "$2"
        ;;
    *)
        echo "Edit Factory - Claude Code Tester"
        echo ""
        echo "Usage: $0 {run|session|loop|custom}"
        echo ""
        echo "Commands:"
        echo "  run      - Run one random test"
        echo "  session  - Run interactive 3-step session"
        echo "  loop     - Continuous testing every 5 min"
        echo "  custom   - Run with custom prompt"
        echo ""
        echo "Example:"
        echo "  $0 custom \"Testează butonul de fullscreen pe video player\""
        ;;
esac
