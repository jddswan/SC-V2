// Charge la logique du jeu dans Node (sans navigateur) : esbuild compile le JSX à la volée.
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadGame(brand = 'ambrelune') {
  const res = await build({
    stdin: { contents: "export { reducer, initialState, migrate } from './SupplyChainTycoon.jsx';", resolveDir: 'src', loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node',
    loader: { '.jsx': 'jsx', '.js': 'jsx' },
    alias: { '@brand': `./src/brands/${brand}.js` },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const file = join(mkdtempSync(join(tmpdir(), 'sct-')), `game-${brand}.mjs`);
  writeFileSync(file, res.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

/** Hasard reproductible : remplace Math.random pendant fn(). */
export function withSeed(seed, fn) {
  const original = Math.random;
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = original; }
}
