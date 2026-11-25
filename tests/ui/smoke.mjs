// Test de fumée de l'interface : ouvre la page construite (dist/SupplyChainTycoon.html) sur ordinateur et sur téléphone,
// charge une partie avancée (3 jours simulés) et affiche chaque onglet en surveillant les erreurs.
// Lancement : npm run build && npm run test:ui
// Prérequis : Playwright et Chromium installés (npx playwright install chromium) ; pas une dépendance du projet.
// Les captures d'écran sont écrites dans test-results/ (ignoré par git).
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadGame } from '../helpers/loadGame.mjs';
import { simulate } from '../helpers/simulate.mjs';

let chromium, devices;
try { ({ chromium, devices } = await import('playwright')); } catch {
  console.error('Playwright introuvable : npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const SAVE_KEY = 'supply-chain-tycoon-save-v5';
const OUT = fileURLToPath(new URL('../../test-results/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const PAGE = 'SupplyChainTycoon.html';
const screens = {
  ordinateur: { viewport: { width: 1440, height: 900 } },
  telephone: { ...devices['iPhone 13'] },
};

const browser = await chromium.launch();
const problems = [];
{
  const save = JSON.stringify(simulate(await loadGame()));
  const url = pathToFileURL(fileURLToPath(new URL(`../../dist/${PAGE}`, import.meta.url))).href;
  for (const [screen, opts] of Object.entries(screens)) {
    const ctx = await browser.newContext(opts);
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, [SAVE_KEY, save]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.waitForSelector('[data-tab]', { timeout: 15000 });
    const tabs = await page.$$eval('[data-tab]', (els) => [...new Set(els.map((e) => e.dataset.tab))]);
    for (const tab of tabs) {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 2) errors.push(`onglet ${tab} : la page déborde de ${overflow}px en largeur`);
      await page.screenshot({ path: `${OUT}${screen}-${tab}.png` });
    }
    const label = screen;
    if (errors.length) problems.push(`${label} :\n  - ${[...new Set(errors)].join('\n  - ')}`);
    console.log(`${errors.length ? '✗' : '✓'} ${label} : ${tabs.length} onglets (${tabs.join(', ')})`);
    await ctx.close();
  }
}
await browser.close();
if (problems.length) { console.error(`\nProblèmes :\n${problems.join('\n')}`); process.exit(1); }
console.log(`\nAucune erreur. Captures dans test-results/`);
