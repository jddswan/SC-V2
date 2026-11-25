// Construit une page HTML autonome (React + d3 + jeu, tout en ligne) : dist/SupplyChainTycoon.html.
// Usage : node scripts/build.mjs
//
// L'habillage (noms de la maison et des produits) est choisi ici, en faisant pointer l'import « @brand »
// vers src/brands/<habillage>.js.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BRAND = 'ambrelune';
const OUT = 'dist/SupplyChainTycoon.html';
const TITLE = 'Supply Chain Tycoon · Maison Ambrelune';

/** Construit le bundle JS du jeu (utilisé aussi par les tests). */
export async function bundle(brand = BRAND, extra = {}) {
  const res = await build({
    entryPoints: ['src/main.jsx'],
    bundle: true, minify: true, write: false, format: 'iife', charset: 'utf8',
    loader: { '.jsx': 'jsx', '.js': 'jsx' },
    alias: { '@brand': `./src/brands/${brand}.js` },
    define: { 'process.env.NODE_ENV': '"production"' },
    ...extra,
  });
  return res.outputFiles[0].text;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  mkdirSync('dist', { recursive: true });
  const js = (await bundle()).replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${TITLE}</title>
<style>html,body{background:#f4f1ea;margin:0}</style></head><body>
<div id="root"></div>
<script>${js}</script>
</body></html>
`;
  writeFileSync(OUT, html);
  console.log(`✓ ${OUT} (${(html.length / 1024).toFixed(0)} Ko)`);
}
