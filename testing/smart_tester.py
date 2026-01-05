#!/usr/bin/env python3
"""
EDIT FACTORY - Smart Autonomous Tester
Testare inteligentă și variată - explorează aplicația diferit la fiecare rulare.

Rulează la fiecare 5 minute și face:
- Explorare aleatorie a paginilor
- Teste diferite la fiecare rulare
- Interacțiuni variate cu UI
- Raportare detaliată a problemelor găsite
"""

import asyncio
import json
import os
import random
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict, field

# Configurare
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8001")
SCRIPT_DIR = Path(__file__).parent
REPORTS_DIR = SCRIPT_DIR / "reports"
SCREENSHOTS_DIR = SCRIPT_DIR / "screenshots"
STATE_FILE = SCRIPT_DIR / ".test_state.json"

REPORTS_DIR.mkdir(exist_ok=True)
SCREENSHOTS_DIR.mkdir(exist_ok=True)


@dataclass
class TestAction:
    """O acțiune de test."""
    action_type: str
    target: str
    result: str
    duration_ms: int
    screenshot: Optional[str] = None
    error: Optional[str] = None


@dataclass
class TestSession:
    """O sesiune de testare."""
    session_id: str
    timestamp: str
    duration_seconds: int
    pages_visited: List[str] = field(default_factory=list)
    actions_performed: List[Dict] = field(default_factory=list)
    errors_found: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    console_errors: List[str] = field(default_factory=list)
    summary: str = ""


class SmartTester:
    """Tester autonom inteligent."""

    # Paginile aplicației
    PAGES = [
        {"path": "/", "name": "Home", "weight": 3},
        {"path": "/library", "name": "Library", "weight": 2},
        {"path": "/segments", "name": "Segments", "weight": 2},
        {"path": "/usage", "name": "Usage", "weight": 1},
    ]

    # Acțiuni posibile pe pagini
    ACTIONS = {
        "/": [
            "check_upload_area",
            "navigate_tabs",
            "check_sliders",
            "check_buttons",
            "check_inputs",
            "scroll_page",
            "check_responsive",
        ],
        "/library": [
            "check_project_list",
            "check_create_button",
            "scroll_projects",
            "check_filters",
        ],
        "/segments": [
            "check_video_list",
            "check_video_player",
            "check_timeline",
            "check_segment_controls",
        ],
        "/usage": [
            "check_stats",
            "check_charts",
            "scroll_page",
        ],
    }

    def __init__(self):
        self.page = None
        self.browser = None
        self.context = None
        self.session = None
        self.console_messages = []
        self.state = self._load_state()

    def _load_state(self) -> Dict:
        """Încarcă starea anterioară pentru a varia testele."""
        if STATE_FILE.exists():
            try:
                with open(STATE_FILE) as f:
                    return json.load(f)
            except:
                pass
        return {
            "last_run": None,
            "runs_count": 0,
            "last_pages": [],
            "last_actions": [],
            "found_issues": [],
        }

    def _save_state(self):
        """Salvează starea pentru rularea următoare."""
        self.state["last_run"] = datetime.now().isoformat()
        self.state["runs_count"] += 1
        with open(STATE_FILE, "w") as f:
            json.dump(self.state, f, indent=2)

    async def setup(self):
        """Inițializează browser-ul."""
        try:
            from playwright.async_api import async_playwright
            self.playwright = await async_playwright().start()
            self.browser = await self.playwright.chromium.launch(headless=True)

            # Viewport random pentru varietate
            viewports = [
                {"width": 1920, "height": 1080},  # Desktop
                {"width": 1366, "height": 768},   # Laptop
                {"width": 1440, "height": 900},   # MacBook
                {"width": 375, "height": 812},    # Mobile
            ]
            viewport = random.choice(viewports)

            self.context = await self.browser.new_context(viewport=viewport)
            self.page = await self.context.new_page()

            # Capturăm mesajele din consolă
            self.page.on("console", lambda msg: self.console_messages.append({
                "type": msg.type,
                "text": msg.text,
                "time": datetime.now().isoformat()
            }))

            print(f"[SETUP] Browser initialized (viewport: {viewport['width']}x{viewport['height']})")
            return True
        except Exception as e:
            print(f"[ERROR] Failed to setup: {e}")
            return False

    async def teardown(self):
        """Închide browser-ul."""
        if self.browser:
            await self.browser.close()
        if hasattr(self, 'playwright'):
            await self.playwright.stop()

    def _choose_pages(self) -> List[Dict]:
        """Alege paginile de testat (diferite de ultima rulare)."""
        # Evităm să testăm exact aceleași pagini ca ultima dată
        last_pages = self.state.get("last_pages", [])

        # Weighted random selection
        pages = []
        available = self.PAGES.copy()

        # Prioritizăm paginile care nu au fost testate recent
        for page in available:
            if page["path"] not in last_pages:
                page["weight"] += 1

        # Alegem 2-4 pagini random
        num_pages = random.randint(2, min(4, len(available)))

        weights = [p["weight"] for p in available]
        total = sum(weights)
        weights = [w/total for w in weights]

        selected = random.choices(available, weights=weights, k=num_pages)

        # Eliminăm duplicatele păstrând ordinea
        seen = set()
        pages = []
        for p in selected:
            if p["path"] not in seen:
                seen.add(p["path"])
                pages.append(p)

        self.state["last_pages"] = [p["path"] for p in pages]
        return pages

    def _choose_actions(self, page_path: str) -> List[str]:
        """Alege acțiunile de executat pe o pagină."""
        available = self.ACTIONS.get(page_path, ["scroll_page"])
        last_actions = self.state.get("last_actions", [])

        # Prioritizăm acțiunile care nu au fost făcute recent
        prioritized = [a for a in available if a not in last_actions]
        if not prioritized:
            prioritized = available

        # Alegem 2-4 acțiuni random
        num_actions = random.randint(2, min(4, len(prioritized)))
        selected = random.sample(prioritized, min(num_actions, len(prioritized)))

        return selected

    async def take_screenshot(self, name: str) -> str:
        """Face un screenshot."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{name}_{timestamp}.png"
        filepath = SCREENSHOTS_DIR / filename
        await self.page.screenshot(path=str(filepath))
        return str(filepath)

    # =========================================================================
    # ACȚIUNI DE TEST
    # =========================================================================

    async def check_upload_area(self) -> TestAction:
        """Verifică zona de upload."""
        start = datetime.now()
        try:
            upload = self.page.locator("input[type='file']")
            count = await upload.count()
            if count > 0:
                return TestAction("check_upload_area", "file input", "found",
                                  int((datetime.now() - start).total_seconds() * 1000))
            else:
                return TestAction("check_upload_area", "file input", "not found",
                                  int((datetime.now() - start).total_seconds() * 1000),
                                  error="No file input found")
        except Exception as e:
            return TestAction("check_upload_area", "file input", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def navigate_tabs(self) -> TestAction:
        """Navighează prin tab-uri."""
        start = datetime.now()
        try:
            tabs = await self.page.locator("[role='tab']").all()
            if tabs:
                # Click pe un tab random
                tab = random.choice(tabs)
                await tab.click()
                await self.page.wait_for_timeout(500)
                return TestAction("navigate_tabs", f"{len(tabs)} tabs", "clicked random tab",
                                  int((datetime.now() - start).total_seconds() * 1000))
            return TestAction("navigate_tabs", "tabs", "no tabs found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("navigate_tabs", "tabs", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_sliders(self) -> TestAction:
        """Verifică și interacționează cu slidere."""
        start = datetime.now()
        try:
            sliders = await self.page.locator("[role='slider']").all()
            if sliders:
                slider = random.choice(sliders)
                await slider.click()
                return TestAction("check_sliders", f"{len(sliders)} sliders", "interacted",
                                  int((datetime.now() - start).total_seconds() * 1000))
            return TestAction("check_sliders", "sliders", "none found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_sliders", "sliders", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_buttons(self) -> TestAction:
        """Verifică butoanele vizibile."""
        start = datetime.now()
        try:
            buttons = await self.page.locator("button:visible").all()
            return TestAction("check_buttons", f"{len(buttons)} buttons", "found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_buttons", "buttons", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_inputs(self) -> TestAction:
        """Verifică input-urile."""
        start = datetime.now()
        try:
            inputs = await self.page.locator("input:visible, textarea:visible").all()
            return TestAction("check_inputs", f"{len(inputs)} inputs", "found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_inputs", "inputs", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def scroll_page(self) -> TestAction:
        """Scroll random prin pagină."""
        start = datetime.now()
        try:
            # Scroll random
            scroll_amount = random.randint(200, 800)
            await self.page.evaluate(f"window.scrollBy(0, {scroll_amount})")
            await self.page.wait_for_timeout(300)
            return TestAction("scroll_page", f"{scroll_amount}px", "scrolled",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("scroll_page", "scroll", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_responsive(self) -> TestAction:
        """Verifică dacă pagina e responsive."""
        start = datetime.now()
        try:
            viewport = self.page.viewport_size
            # Verificăm overflow
            has_horizontal_scroll = await self.page.evaluate(
                "document.documentElement.scrollWidth > document.documentElement.clientWidth"
            )
            if has_horizontal_scroll:
                screenshot = await self.take_screenshot("responsive_issue")
                return TestAction("check_responsive", f"{viewport}", "horizontal scroll detected",
                                  int((datetime.now() - start).total_seconds() * 1000),
                                  screenshot=screenshot, error="Possible responsive issue")
            return TestAction("check_responsive", f"{viewport}", "ok",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_responsive", "responsive", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_project_list(self) -> TestAction:
        """Verifică lista de proiecte."""
        start = datetime.now()
        try:
            await self.page.wait_for_timeout(1000)
            content = await self.page.content()
            has_projects = "project" in content.lower() or "proiect" in content.lower()
            return TestAction("check_project_list", "projects", "found" if has_projects else "empty",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_project_list", "projects", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_create_button(self) -> TestAction:
        """Verifică butonul de creare."""
        start = datetime.now()
        try:
            btn = self.page.locator("button:has-text('Proiect'), button:has-text('Create'), button:has-text('New')")
            count = await btn.count()
            return TestAction("check_create_button", "create button", "found" if count > 0 else "not found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_create_button", "create button", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def scroll_projects(self) -> TestAction:
        """Scroll prin lista de proiecte."""
        return await self.scroll_page()

    async def check_filters(self) -> TestAction:
        """Verifică filtrele."""
        start = datetime.now()
        try:
            filters = await self.page.locator("select, [role='combobox']").all()
            return TestAction("check_filters", f"{len(filters)} filters", "found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_filters", "filters", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_video_list(self) -> TestAction:
        """Verifică lista de videouri."""
        start = datetime.now()
        try:
            await self.page.wait_for_timeout(1000)
            videos = await self.page.locator("video, [class*='video']").all()
            return TestAction("check_video_list", f"{len(videos)} video elements", "found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_video_list", "videos", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_video_player(self) -> TestAction:
        """Verifică player-ul video."""
        start = datetime.now()
        try:
            video = self.page.locator("video").first
            if await video.count() > 0:
                # Verificăm dacă are src
                src = await video.get_attribute("src")
                return TestAction("check_video_player", "video player", f"src: {bool(src)}",
                                  int((datetime.now() - start).total_seconds() * 1000))
            return TestAction("check_video_player", "video player", "not found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_video_player", "video player", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_timeline(self) -> TestAction:
        """Verifică timeline-ul."""
        start = datetime.now()
        try:
            timeline = self.page.locator("[class*='timeline'], [class*='Timeline']")
            count = await timeline.count()
            return TestAction("check_timeline", "timeline", "found" if count > 0 else "not found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_timeline", "timeline", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_segment_controls(self) -> TestAction:
        """Verifică controalele de segment."""
        start = datetime.now()
        try:
            controls = await self.page.locator("button:visible").all()
            return TestAction("check_segment_controls", f"{len(controls)} controls", "found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_segment_controls", "controls", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_stats(self) -> TestAction:
        """Verifică statisticile."""
        start = datetime.now()
        try:
            await self.page.wait_for_timeout(500)
            numbers = await self.page.locator("[class*='stat'], [class*='number'], h2, h3").all()
            return TestAction("check_stats", f"{len(numbers)} stat elements", "found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_stats", "stats", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def check_charts(self) -> TestAction:
        """Verifică graficele."""
        start = datetime.now()
        try:
            charts = await self.page.locator("canvas, svg, [class*='chart']").all()
            return TestAction("check_charts", f"{len(charts)} chart elements", "found",
                              int((datetime.now() - start).total_seconds() * 1000))
        except Exception as e:
            return TestAction("check_charts", "charts", "error",
                              int((datetime.now() - start).total_seconds() * 1000),
                              error=str(e))

    async def execute_action(self, action_name: str) -> TestAction:
        """Execută o acțiune."""
        action_method = getattr(self, action_name, None)
        if action_method:
            return await action_method()
        return TestAction(action_name, "unknown", "not implemented", 0)

    # =========================================================================
    # MAIN TEST LOOP
    # =========================================================================

    async def run_session(self) -> TestSession:
        """Rulează o sesiune de testare."""
        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        start_time = datetime.now()

        self.session = TestSession(
            session_id=session_id,
            timestamp=start_time.isoformat(),
            duration_seconds=0
        )

        print(f"\n{'='*60}")
        print(f"  SMART TESTER - Session {session_id}")
        print(f"  Run #{self.state['runs_count'] + 1}")
        print(f"{'='*60}\n")

        if not await self.setup():
            self.session.errors_found.append("Failed to setup browser")
            return self.session

        try:
            # Alegem paginile de testat
            pages = self._choose_pages()
            print(f"[PLAN] Will test {len(pages)} pages: {[p['name'] for p in pages]}")

            for page_info in pages:
                page_path = page_info["path"]
                page_name = page_info["name"]

                print(f"\n--- Testing: {page_name} ({page_path}) ---")

                # Navigăm la pagină
                try:
                    await self.page.goto(f"{FRONTEND_URL}{page_path}", wait_until="networkidle")
                    self.session.pages_visited.append(page_path)
                except Exception as e:
                    self.session.errors_found.append(f"Failed to load {page_path}: {e}")
                    continue

                # Alegem și executăm acțiuni
                actions = self._choose_actions(page_path)
                print(f"  Actions: {actions}")

                for action_name in actions:
                    result = await self.execute_action(action_name)
                    self.session.actions_performed.append(asdict(result))

                    status = "✅" if not result.error else "⚠️"
                    print(f"  {status} {result.action_type}: {result.result}")

                    if result.error:
                        self.session.warnings.append(f"{page_name}/{action_name}: {result.error}")

                # Verificăm erorile din consolă
                await self.page.wait_for_timeout(500)

            # Procesăm mesajele din consolă
            for msg in self.console_messages:
                if msg["type"] == "error" and "favicon" not in msg["text"].lower():
                    self.session.console_errors.append(msg["text"])

        finally:
            await self.teardown()

        # Finalizare
        self.session.duration_seconds = int((datetime.now() - start_time).total_seconds())
        self.session.summary = self._generate_summary()

        # Salvăm starea
        self.state["last_actions"] = [a["action_type"] for a in self.session.actions_performed[-10:]]
        self._save_state()

        # Salvăm raportul
        self._save_report()

        return self.session

    def _generate_summary(self) -> str:
        """Generează sumarul sesiunii."""
        total_actions = len(self.session.actions_performed)
        errors = len(self.session.errors_found) + len(self.session.console_errors)
        warnings = len(self.session.warnings)

        if errors == 0 and warnings == 0:
            return f"✅ All {total_actions} tests passed on {len(self.session.pages_visited)} pages"
        elif errors > 0:
            return f"❌ {errors} errors, {warnings} warnings in {total_actions} tests"
        else:
            return f"⚠️ {warnings} warnings in {total_actions} tests (no critical errors)"

    def _save_report(self):
        """Salvează raportul sesiunii."""
        report_file = REPORTS_DIR / f"smart_test_{self.session.session_id}.json"
        with open(report_file, "w") as f:
            json.dump(asdict(self.session), f, indent=2)

        # Salvăm și un raport MD
        md_file = REPORTS_DIR / f"smart_test_{self.session.session_id}.md"
        with open(md_file, "w") as f:
            f.write(f"# Smart Test Report\n\n")
            f.write(f"**Session:** {self.session.session_id}\n")
            f.write(f"**Duration:** {self.session.duration_seconds}s\n")
            f.write(f"**Pages:** {', '.join(self.session.pages_visited)}\n\n")
            f.write(f"## Summary\n{self.session.summary}\n\n")

            if self.session.errors_found:
                f.write(f"## Errors\n")
                for e in self.session.errors_found:
                    f.write(f"- {e}\n")
                f.write("\n")

            if self.session.warnings:
                f.write(f"## Warnings\n")
                for w in self.session.warnings:
                    f.write(f"- {w}\n")
                f.write("\n")

            f.write(f"## Actions ({len(self.session.actions_performed)})\n")
            for a in self.session.actions_performed:
                status = "✅" if not a.get("error") else "⚠️"
                f.write(f"- {status} {a['action_type']}: {a['result']}\n")

        print(f"\n[REPORT] Saved to: {report_file}")
        print(f"[REPORT] MD: {md_file}")

    def print_results(self):
        """Afișează rezultatele."""
        print(f"\n{'='*60}")
        print(f"  SESSION COMPLETE")
        print(f"{'='*60}")
        print(f"Duration: {self.session.duration_seconds}s")
        print(f"Pages: {len(self.session.pages_visited)}")
        print(f"Actions: {len(self.session.actions_performed)}")
        print(f"Errors: {len(self.session.errors_found)}")
        print(f"Warnings: {len(self.session.warnings)}")
        print(f"Console Errors: {len(self.session.console_errors)}")
        print(f"\n{self.session.summary}")
        print(f"{'='*60}\n")


async def main():
    tester = SmartTester()
    session = await tester.run_session()
    tester.print_results()

    # Exit code bazat pe erori
    if session.errors_found or session.console_errors:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
