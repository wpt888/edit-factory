import { test, expect } from '@playwright/test';

/**
 * Visual verification of the Notițe (notes) feature — formerly Wiki.
 * Captures: empty state -> split-view Markdown editor -> rendered view.
 * Cleans up the demo note at the end so the list stays empty.
 */
test('notite: empty state, editor, rendered markdown', async ({ page }) => {
  const SAMPLE = `# Ghid Pipeline

Pipeline-ul rulează în **4 pași**:

1. Script (Gemini)
2. TTS (ElevenLabs / Edge)
3. Match segmente
4. Render (FFmpeg)

## Note rapide

- Suportă \`Markdown\` complet
- Tabele, liste, cod

| Pas | Serviciu |
| --- | --- |
| TTS | ElevenLabs |
| Render | FFmpeg |

> Sfat: editează în stânga, vezi preview live în dreapta.`;

  await page.goto('/wiki');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // 1. Empty state
  await page.screenshot({ path: 'screenshots/wiki-1-empty.png', fullPage: true });

  // 2. Create a note -> enters edit (split) mode
  await page.getByRole('button', { name: /Notiță nouă/i }).first().click();
  await page.waitForTimeout(1500);

  // Fill title, category, markdown
  await page.getByPlaceholder('Titlu').fill('Ghid Pipeline');
  await page.getByPlaceholder(/Categorie/i).fill('Ghiduri');
  await page.getByPlaceholder(/Scrie în Markdown/i).fill(SAMPLE);
  await page.waitForTimeout(800);

  // 2. Split-view editor with live preview
  await page.screenshot({ path: 'screenshots/wiki-2-editor.png', fullPage: true });

  // 3. Save -> rendered view
  await page.getByRole('button', { name: /Salvează/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/wiki-3-rendered.png', fullPage: true });

  // Cleanup: delete the demo note so the list stays empty.
  await page.getByRole('button', { name: /Șterge notița/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^Șterge$/i }).click();
  await page.waitForTimeout(1000);
});
