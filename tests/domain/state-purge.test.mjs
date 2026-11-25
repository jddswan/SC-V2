// Tests unitaires : nettoyage des références inconnues d'une sauvegarde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purgeUnknownSkus } from '../../src/domain/state/purgeUnknownSkus.js';

const SKUS = ['A', 'B'];
const save = () => ({
  launched: { A: true, X: true },
  factoryStock: { A: { units: 1 }, B: { units: 2 }, X: { units: 3 } },
  dc: {
    stock: { A: 1, X: 9 }, buffer: { B: 0, X: 1 },
    yard: [{ lines: { A: 2, X: 1 } }], docked: [{ lines: { X: 4 } }],
    orders: [
      { id: 1, lines: [{ sku: 'A', req: 3 }, { sku: 'X', req: 2 }], missing: ['X', 'A'] },
      { id: 2, lines: [{ sku: 'X', req: 5 }] },
    ],
  },
  filiales: { FR: { stock: { A: 1, X: 2 }, carry: { X: 0.5 }, otifLog: [{ missing: ['X'] }] } },
  transit: [{ lines: { A: 1, X: 2 } }],
  shipments: [{ lines: { X: 1, B: 1 }, missing: ['X'] }],
  factories: {
    F: {
      queue: [{ id: 10, sku: 'A' }, { id: 11, sku: 'X' }],
      lines: [
        { id: 1, sku: 'X', orderId: 11, status: 'running', timeLeft: 5 },
        { id: 2, sku: 'A', orderId: 10, status: 'running', timeLeft: 5 },
      ],
    },
  },
  campaigns: [{ sku: 'A' }, { sku: 'X' }],
  rd: { projects: [{ sku: 'X' }, { sku: 'B' }] },
  event: { key: 'VIRAL', sku: 'X' },
});

test('une référence inconnue disparaît des stocks et des tables', () => {
  const d = purgeUnknownSkus(save(), SKUS);
  assert.deepEqual(d.launched, { A: true });
  assert.deepEqual(Object.keys(d.factoryStock), ['A', 'B']);
  assert.deepEqual(d.dc.stock, { A: 1 });
  assert.deepEqual(d.dc.buffer, { B: 0 });
  assert.deepEqual(d.dc.yard[0].lines, { A: 2 });
  assert.deepEqual(d.dc.docked[0].lines, {});
  assert.deepEqual(d.filiales.FR.stock, { A: 1 });
  assert.deepEqual(d.filiales.FR.carry, {});
  assert.deepEqual(d.filiales.FR.otifLog[0].missing, []);
  assert.deepEqual(d.transit[0].lines, { A: 1 });
  assert.deepEqual(d.shipments[0].lines, { B: 1 });
});

test('commandes, OF, campagnes et projets de la référence inconnue sont retirés', () => {
  const d = purgeUnknownSkus(save(), SKUS);
  assert.deepEqual(d.dc.orders.map((o) => o.id), [1]);
  assert.deepEqual(d.dc.orders[0].lines.map((l) => l.sku), ['A']);
  assert.deepEqual(d.dc.orders[0].missing, ['A']);
  assert.deepEqual(d.factories.F.queue.map((o) => o.id), [10]);
  assert.deepEqual(d.campaigns, [{ sku: 'A' }]);
  assert.deepEqual(d.rd.projects, [{ sku: 'B' }]);
  assert.equal(d.event, null);
});

test('la ligne qui produisait la référence inconnue est remise à vide, les autres continuent', () => {
  const d = purgeUnknownSkus(save(), SKUS);
  const [l1, l2] = d.factories.F.lines;
  assert.deepEqual([l1.sku, l1.orderId, l1.status], [null, null, 'idle']);
  assert.deepEqual([l2.sku, l2.orderId, l2.status], ['A', 10, 'running']);
});

test('une sauvegarde déjà propre ne change pas', () => {
  const clean = { launched: { A: true }, factoryStock: { A: { units: 1 } }, dc: { stock: { A: 1 }, buffer: {}, yard: [], docked: [], orders: [] }, filiales: {}, transit: [], shipments: [], factories: {}, campaigns: [], rd: { projects: [] }, event: null };
  assert.deepEqual(purgeUnknownSkus(structuredClone(clean), SKUS), clean);
});
