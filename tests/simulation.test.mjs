// Test de caractérisation (« golden master ») : 3 jours de jeu avec un joueur automatique et un hasard fixé.
// Le résumé obtenu doit rester identique tant qu'on déplace du code sans changer les règles.
// Il a été généré à partir de la v5.5 d'origine (avant découpage), puis vérifié identique après.
// Si vous changez volontairement une règle du jeu : UPDATE_SNAPSHOT=1 npm test, puis relisez le diff du fichier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadGame } from './helpers/loadGame.mjs';
import { simulate, summarize } from './helpers/simulate.mjs';
import brand from '../src/brands/ambrelune.js';

const SNAPSHOT = new URL('./snapshots/simulation-3-jours.json', import.meta.url);

test('3 jours de jeu : toute la chaîne tourne, de l’achat à la filiale', async () => {
  const s = simulate(await loadGame());
  assert.ok(Number.isFinite(s.money), 'la trésorerie reste un nombre');
  assert.ok(s.stats.ofDone > 0, 'des OF sont terminés');
  assert.ok(s.stats.trucksReceived > 0, 'la centrale réceptionne');
  assert.ok(s.stats.ordersDelivered > 0, 'les filiales sont livrées');
  assert.ok(s.msIndex >= 5, 'la progression avance');
});

test('le résumé de la partie est identique au golden master', async () => {
  const summary = JSON.stringify(summarize(simulate(await loadGame())), null, 1);
  if (process.env.UPDATE_SNAPSHOT) writeFileSync(SNAPSHOT, summary);
  assert.deepEqual(JSON.parse(summary), JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
});

test('chaque référence du catalogue a un nom dans l’habillage', async () => {
  const { initialState } = await loadGame();
  const skus = Object.keys(initialState.factoryStock);
  assert.ok(skus.length > 0);
  for (const sku of skus) assert.ok(brand.productNames[sku], `pas de nom affiché pour ${sku}`);
  for (const sku of Object.keys(brand.productNames)) assert.ok(skus.includes(sku), `nom affiché pour une référence inconnue : ${sku}`);
});

test('migrate() complète une ancienne sauvegarde', async () => {
  const { initialState, migrate } = await loadGame();
  const old = structuredClone(initialState);
  old.dc.cells = old.dc.cells.slice(0, 3);
  const migrated = migrate(old);
  assert.equal(migrated.dc.cells.length, 8);
  assert.deepEqual(migrated.dc.cells.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('migrate() oublie une référence inconnue sans erreur', async () => {
  const { initialState, migrate } = await loadGame();
  const old = structuredClone(initialState);
  old.factoryStock.PARF_XXX = { units: 120, max: 1000 };
  old.dc.stock.PARF_XXX = 40;
  old.dc.buffer.PARF_XXX = 2;
  old.launched.PARF_XXX = true;
  old.filiales.FR.stock.PARF_XXX = 5;
  old.factories.PARFUM.queue.push({ id: 999, sku: 'PARF_XXX', pallets: 1, stage: 'queued' });
  old.campaigns.push({ id: 998, lever: 'TV', sku: 'PARF_XXX', fils: ['FR'] });
  const migrated = migrate(old);
  assert.equal(migrated.factoryStock.PARF_XXX, undefined);
  assert.equal(migrated.dc.stock.PARF_XXX, undefined);
  assert.equal(migrated.dc.buffer.PARF_XXX, undefined);
  assert.equal(migrated.launched.PARF_XXX, undefined);
  assert.equal(migrated.filiales.FR.stock.PARF_XXX, undefined);
  assert.ok(!migrated.factories.PARFUM.queue.some((o) => o.sku === 'PARF_XXX'));
  assert.equal(migrated.campaigns.length, 0);
  assert.equal(migrated.factoryStock.PARF_50.max, initialState.factoryStock.PARF_50.max);
});
