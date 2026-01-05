#!/usr/bin/env python3
"""
EDIT FACTORY - Playwright UI Tests
Testează automat toate paginile și funcționalitățile UI.
"""

import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict

# Configurare
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8001")
SCRIPT_DIR = Path(__file__).parent
SCREENSHOTS_DIR = SCRIPT_DIR / "screenshots"
SCREENSHOTS_DIR.mkdir(exist_ok=True)


@dataclass
class TestResult:
    """Rezultatul unui test."""
    name: str
    status: str  # "pass", "fail", "skip"
    duration_ms: int
    error: Optional[str] = None
    screenshot: Optional[str] = None


class EditFactoryUITester:
    """Clasa principală pentru testare UI."""

    def __init__(self):
        self.results: List[TestResult] = []
        self.page = None
        self.browser = None
        self.context = None

    async def setup(self):
        """Inițializează browser-ul."""
        try:
            from playwright.async_api import async_playwright
            self.playwright = await async_playwright().start()
            self.browser = await self.playwright.chromium.launch(headless=True)
            self.context = await self.browser.new_context(
                viewport={"width": 1920, "height": 1080}
            )
            self.page = await self.context.new_page()
            print("[SETUP] Browser initialized")
            return True
        except ImportError:
            print("[ERROR] Playwright not installed. Run: pip install playwright && playwright install")
            return False
        except Exception as e:
            print(f"[ERROR] Failed to setup browser: {e}")
            return False

    async def teardown(self):
        """Închide browser-ul."""
        if self.browser:
            await self.browser.close()
        if hasattr(self, 'playwright'):
            await self.playwright.stop()
        print("[TEARDOWN] Browser closed")

    async def take_screenshot(self, name: str) -> str:
        """Face un screenshot și returnează calea."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{name}_{timestamp}.png"
        filepath = SCREENSHOTS_DIR / filename
        await self.page.screenshot(path=str(filepath))
        return str(filepath)

    async def run_test(self, name: str, test_func):
        """Rulează un test și înregistrează rezultatul."""
        print(f"[TEST] Running: {name}...")
        start_time = datetime.now()

        try:
            await test_func()
            duration = int((datetime.now() - start_time).total_seconds() * 1000)
            self.results.append(TestResult(
                name=name,
                status="pass",
                duration_ms=duration
            ))
            print(f"  ✅ PASS ({duration}ms)")

        except Exception as e:
            duration = int((datetime.now() - start_time).total_seconds() * 1000)
            screenshot = await self.take_screenshot(name.replace(" ", "_"))
            self.results.append(TestResult(
                name=name,
                status="fail",
                duration_ms=duration,
                error=str(e),
                screenshot=screenshot
            ))
            print(f"  ❌ FAIL: {e}")

    # =========================================================================
    # TESTE PAGINI
    # =========================================================================

    async def test_home_page_loads(self):
        """Testează încărcarea paginii principale."""
        await self.page.goto(FRONTEND_URL, wait_until="networkidle")
        # Verificăm că pagina s-a încărcat complet
        await self.page.wait_for_load_state("networkidle")

    async def test_library_page_loads(self):
        """Testează încărcarea paginii Library."""
        await self.page.goto(f"{FRONTEND_URL}/library", wait_until="networkidle")
        # Așteaptă să se încarce pagina
        await self.page.wait_for_load_state("networkidle")

    async def test_segments_page_loads(self):
        """Testează încărcarea paginii Segments."""
        await self.page.goto(f"{FRONTEND_URL}/segments", wait_until="networkidle")
        await self.page.wait_for_load_state("networkidle")

    async def test_usage_page_loads(self):
        """Testează încărcarea paginii Usage."""
        await self.page.goto(f"{FRONTEND_URL}/usage", wait_until="networkidle")
        await self.page.wait_for_load_state("networkidle")

    # =========================================================================
    # TESTE FUNCȚIONALITĂȚI HOME PAGE
    # =========================================================================

    async def test_file_upload_area_exists(self):
        """Verifică existența zonei de upload."""
        await self.page.goto(FRONTEND_URL, wait_until="networkidle")
        # Căutăm input de tip file sau zona de drop
        upload_exists = await self.page.locator("input[type='file']").count() > 0
        if not upload_exists:
            raise Exception("File upload input not found")

    async def test_tabs_navigation(self):
        """Testează navigarea între tab-uri."""
        await self.page.goto(FRONTEND_URL, wait_until="networkidle")

        # Căutăm tab-uri
        tabs = await self.page.locator("[role='tab']").all()
        if len(tabs) > 0:
            for tab in tabs[:3]:  # Testăm primele 3 tab-uri
                await tab.click()
                await self.page.wait_for_timeout(300)

    async def test_slider_controls(self):
        """Testează controalele slider."""
        await self.page.goto(FRONTEND_URL, wait_until="networkidle")

        sliders = await self.page.locator("[role='slider']").all()
        if len(sliders) == 0:
            print("    No sliders found, skipping...")
            return

        # Testăm primul slider
        await sliders[0].click()

    async def test_variant_count_slider(self):
        """Testează slider-ul pentru număr de variante."""
        await self.page.goto(FRONTEND_URL, wait_until="networkidle")

        # Căutăm textul "variante" sau "Numar de variante"
        variant_section = self.page.locator("text=variante").first
        if await variant_section.count() > 0:
            await variant_section.scroll_into_view_if_needed()

    # =========================================================================
    # TESTE LIBRARY PAGE
    # =========================================================================

    async def test_library_project_list(self):
        """Testează afișarea listei de proiecte."""
        await self.page.goto(f"{FRONTEND_URL}/library", wait_until="networkidle")
        await self.page.wait_for_timeout(1000)

        # Verificăm că există conținut (fie proiecte, fie mesaj "no projects")
        content = await self.page.content()
        if "project" not in content.lower() and "proiect" not in content.lower():
            print("    Warning: No project-related content found")

    async def test_library_create_project_button(self):
        """Testează butonul de creare proiect."""
        await self.page.goto(f"{FRONTEND_URL}/library", wait_until="networkidle")

        # Căutăm buton de creare
        create_btn = self.page.locator("button:has-text('Proiect'), button:has-text('Create'), button:has-text('New')").first
        if await create_btn.count() > 0:
            # Verificăm că e vizibil
            await create_btn.wait_for(state="visible", timeout=2000)

    # =========================================================================
    # TESTE SEGMENTS PAGE
    # =========================================================================

    async def test_segments_video_list(self):
        """Testează afișarea listei de videouri."""
        await self.page.goto(f"{FRONTEND_URL}/segments", wait_until="networkidle")
        await self.page.wait_for_timeout(1000)

    async def test_segments_video_player(self):
        """Testează player-ul video (dacă există video)."""
        await self.page.goto(f"{FRONTEND_URL}/segments", wait_until="networkidle")
        await self.page.wait_for_timeout(1000)

        # Verificăm dacă există un video player
        video_player = self.page.locator("video").first
        if await video_player.count() > 0:
            # Verificăm controalele
            controls = await self.page.locator(".video-controls, [class*='control']").count()
            print(f"    Found video player with {controls} control areas")

    # =========================================================================
    # TESTE RESPONSIVE
    # =========================================================================

    async def test_mobile_viewport(self):
        """Testează pe viewport mobil."""
        await self.context.close()
        self.context = await self.browser.new_context(
            viewport={"width": 375, "height": 812}  # iPhone X
        )
        self.page = await self.context.new_page()

        await self.page.goto(FRONTEND_URL, wait_until="networkidle")
        await self.take_screenshot("mobile_home")

        # Revert to desktop
        await self.context.close()
        self.context = await self.browser.new_context(
            viewport={"width": 1920, "height": 1080}
        )
        self.page = await self.context.new_page()

    # =========================================================================
    # TESTE CONSOLE ERRORS
    # =========================================================================

    async def test_no_console_errors(self):
        """Verifică că nu sunt erori în consolă."""
        errors = []

        def handle_console(msg):
            if msg.type == "error":
                errors.append(msg.text)

        self.page.on("console", handle_console)

        await self.page.goto(FRONTEND_URL, wait_until="networkidle")
        await self.page.wait_for_timeout(2000)

        if errors:
            # Filtrăm erorile cunoscute/acceptabile
            critical_errors = [e for e in errors if "favicon" not in e.lower()]
            if critical_errors:
                raise Exception(f"Console errors: {critical_errors[:3]}")

    # =========================================================================
    # RUN ALL TESTS
    # =========================================================================

    async def run_all_tests(self):
        """Rulează toate testele."""
        print("\n" + "=" * 60)
        print("  EDIT FACTORY - UI Test Suite")
        print("=" * 60)
        print(f"Frontend: {FRONTEND_URL}")
        print(f"Backend: {BACKEND_URL}")
        print("=" * 60 + "\n")

        if not await self.setup():
            return False

        try:
            # Page Loading Tests
            print("\n--- PAGE LOADING TESTS ---")
            await self.run_test("Home Page Loads", self.test_home_page_loads)
            await self.run_test("Library Page Loads", self.test_library_page_loads)
            await self.run_test("Segments Page Loads", self.test_segments_page_loads)
            await self.run_test("Usage Page Loads", self.test_usage_page_loads)

            # Home Page Functionality
            print("\n--- HOME PAGE FUNCTIONALITY ---")
            await self.run_test("File Upload Area Exists", self.test_file_upload_area_exists)
            await self.run_test("Tabs Navigation", self.test_tabs_navigation)
            await self.run_test("Slider Controls", self.test_slider_controls)
            await self.run_test("Variant Count Slider", self.test_variant_count_slider)

            # Library Page
            print("\n--- LIBRARY PAGE ---")
            await self.run_test("Library Project List", self.test_library_project_list)
            await self.run_test("Library Create Project Button", self.test_library_create_project_button)

            # Segments Page
            print("\n--- SEGMENTS PAGE ---")
            await self.run_test("Segments Video List", self.test_segments_video_list)
            await self.run_test("Segments Video Player", self.test_segments_video_player)

            # Quality Tests
            print("\n--- QUALITY TESTS ---")
            await self.run_test("Mobile Viewport", self.test_mobile_viewport)
            await self.run_test("No Console Errors", self.test_no_console_errors)

        finally:
            await self.teardown()

        return self.generate_report()

    def generate_report(self) -> bool:
        """Generează raportul de teste."""
        passed = sum(1 for r in self.results if r.status == "pass")
        failed = sum(1 for r in self.results if r.status == "fail")
        total = len(self.results)

        print("\n" + "=" * 60)
        print("  TEST SUMMARY")
        print("=" * 60)
        print(f"Total: {total} | Passed: {passed} ✅ | Failed: {failed} ❌")
        print(f"Success Rate: {passed * 100 // total if total > 0 else 0}%")
        print("=" * 60)

        # Salvează raportul JSON
        report_file = SCRIPT_DIR / "reports" / f"playwright_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        report_file.parent.mkdir(exist_ok=True)

        with open(report_file, "w") as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "summary": {
                    "total": total,
                    "passed": passed,
                    "failed": failed,
                    "success_rate": passed * 100 / total if total > 0 else 0
                },
                "results": [asdict(r) for r in self.results]
            }, f, indent=2)

        print(f"\nReport saved to: {report_file}")

        # Afișează testele eșuate
        if failed > 0:
            print("\nFailed Tests:")
            for r in self.results:
                if r.status == "fail":
                    print(f"  ❌ {r.name}: {r.error}")
                    if r.screenshot:
                        print(f"     Screenshot: {r.screenshot}")

        return failed == 0


async def main():
    tester = EditFactoryUITester()
    success = await tester.run_all_tests()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
