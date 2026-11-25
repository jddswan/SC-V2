// Centrale logistique · stockage en racks : cellules du bâtiment et emplacements palettes.
// Règles pures (aucun React, aucun navigateur) : testables seules, voir tests/domain/dc-storage.test.mjs.
// Les fonctions qui modifient prennent l'état « brouillon » que le reducer vient de cloner.

export const DC_CELLS = 8;                 // 8 cellules…
export const MAX_RACK_PER_CELL = 6875;     // …et environ 55 000 emplacements palettes au total
export const RACK_STEP = 100;              // achat à l'unité : +100 emplacements
export const RACK_COST = 10000;
export const RACK_BULK = 1000;             // achat groupé : 1 000 emplacements pour le prix de 900
export const RACK_BULK_PRICE = RACK_COST * 9;
export const CELL_COST = 80000;
export const RACK_RENT = 0.05;             // loyer par emplacement de rack et par tick

/** Prix de construction d'une cellule : chaque nouvelle cellule coûte plus cher (×1,6). */
export const cellCost = (id) => Math.round((CELL_COST * Math.pow(1.6, Math.max(0, id - 2))) / 1000) * 1000;

/** Emplacements palettes disponibles dans les cellules construites. */
export const dcCapacity = (dc) => dc.cells.reduce((a, c) => a + (c.unlocked ? c.racking : 0), 0);

/** Le bâtiment de départ : une cellule équipée de 200 emplacements, les autres à construire. */
export const initialCells = () => [
  { id: 1, unlocked: true, racking: 200 },
  ...Array.from({ length: DC_CELLS - 1 }, (_, i) => ({ id: i + 2, unlocked: false, racking: 0 })),
];

/** Complète la liste des cellules d'une ancienne sauvegarde. */
export const completeCells = (cells) => {
  for (let id = cells.length + 1; id <= DC_CELLS; id++) cells.push({ id, unlocked: false, racking: 0 });
};

/** Peut-on encore poser l'achat groupé dans cette cellule ? */
export const canBuyBulk = (cell) => MAX_RACK_PER_CELL - cell.racking >= RACK_BULK;

/**
 * Devis d'un achat de racks : { cost, slots }, ou null si la cellule est déjà pleine.
 * L'achat groupé n'est proposé que s'il reste au moins 1 000 emplacements libres.
 */
export const rackingQuote = (cell, bulk) => {
  if (!cell || cell.racking >= MAX_RACK_PER_CELL) return null;
  return bulk && canBuyBulk(cell)
    ? { cost: RACK_BULK_PRICE, slots: RACK_BULK }
    : { cost: RACK_COST, slots: RACK_STEP };
};

/** Pose des racks (sans dépasser le maximum de la cellule). */
export const addRacking = (cell, slots) => {
  cell.racking = Math.min(cell.racking + slots, MAX_RACK_PER_CELL);
};

/** Devis de construction d'une cellule : { cost }, ou null si elle est déjà construite. */
export const cellQuote = (cell) => (!cell || cell.unlocked ? null : { cost: cellCost(cell.id) });

/** Une cellule neuve arrive avec un premier lot de racks. */
export const openCell = (cell) => {
  cell.unlocked = true;
  cell.racking = RACK_STEP;
};
