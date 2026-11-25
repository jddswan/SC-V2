// Tests unitaires d'une règle du domaine : aucun React, aucun navigateur, quelques millisecondes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DC_CELLS, MAX_RACK_PER_CELL, RACK_STEP, RACK_COST, RACK_BULK,
  cellCost, dcCapacity, initialCells, completeCells, rackingQuote, addRacking, cellQuote, openCell,
} from '../../src/domain/dc/storage.js';

test('Centrale : 8 cellules, environ 55 000 emplacements au maximum', () => {
  assert.equal(DC_CELLS * MAX_RACK_PER_CELL, 55000);
});

test('au départ : une cellule de 200 emplacements', () => {
  const cells = initialCells();
  assert.equal(cells.length, DC_CELLS);
  assert.equal(dcCapacity({ cells }), 200);
});

test('chaque nouvelle cellule coûte 1,6 fois la précédente', () => {
  assert.equal(cellCost(2), 80000);
  assert.equal(cellCost(3), 128000);
  assert.equal(cellCost(8), Math.round((80000 * 1.6 ** 6) / 1000) * 1000);
});

test('devis de racks : à l’unité ou par 1 000 au prix de 900', () => {
  const cell = { id: 1, unlocked: true, racking: 200 };
  assert.deepEqual(rackingQuote(cell, false), { cost: RACK_COST, slots: RACK_STEP });
  assert.deepEqual(rackingQuote(cell, true), { cost: RACK_COST * 9, slots: RACK_BULK });
});

test('plus d’achat groupé quand il reste moins de 1 000 places', () => {
  const cell = { id: 1, unlocked: true, racking: MAX_RACK_PER_CELL - 500 };
  assert.deepEqual(rackingQuote(cell, true), { cost: RACK_COST, slots: RACK_STEP });
});

test('une cellule pleine ne se vend plus, et les racks ne débordent jamais', () => {
  const cell = { id: 1, unlocked: true, racking: MAX_RACK_PER_CELL - 50 };
  addRacking(cell, RACK_STEP);
  assert.equal(cell.racking, MAX_RACK_PER_CELL);
  assert.equal(rackingQuote(cell, false), null);
});

test('construire une cellule : une seule fois, livrée avec 100 emplacements', () => {
  const cell = { id: 2, unlocked: false, racking: 0 };
  assert.deepEqual(cellQuote(cell), { cost: 80000 });
  openCell(cell);
  assert.equal(cell.racking, RACK_STEP);
  assert.equal(cellQuote(cell), null);
});

test('les cellules non construites ne comptent pas dans la capacité', () => {
  const cells = [{ id: 1, unlocked: true, racking: 300 }, { id: 2, unlocked: false, racking: 999 }];
  completeCells(cells);
  assert.equal(cells.length, DC_CELLS);
  assert.equal(dcCapacity({ cells }), 300);
});
