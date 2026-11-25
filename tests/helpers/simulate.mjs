// Fait tourner une partie complète et en tire un résumé lisible (sert de « golden master »).
import { withSeed } from './loadGame.mjs';
import { playOneTick } from './autoPlayer.mjs';

export const SIM_TICKS = 3 * 1440; // 3 jours de jeu
export const SIM_SEED = 42;

export function simulate({ reducer, initialState }, ticks = SIM_TICKS, seed = SIM_SEED) {
  return withSeed(seed, () => {
    let s = structuredClone(initialState);
    for (let i = 0; i < ticks; i++) s = playOneTick(reducer, s, i);
    return s;
  });
}

const round = (n) => Math.round(n * 100) / 100;
const roundAll = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? round(v) : v)));

/** Ce qui doit rester identique tant qu'on ne change pas volontairement les règles du jeu. */
export const summarize = (s) => roundAll({
  day: s.day, t: s.t, money: s.money, milestones: s.msIndex,
  features: Object.keys(s.features).filter((k) => s.features[k]).sort(),
  stats: { ...s.stats, truckFill: s.stats.truckFill.length },
  dcStock: s.dc.stock, dcCells: s.dc.cells, dcOrders: s.dc.orders.length,
  factoryStock: Object.fromEntries(Object.entries(s.factoryStock).map(([k, v]) => [k, v.units])),
  components: s.components,
  filiales: Object.fromEntries(Object.entries(s.filiales).filter(([, f]) => f.unlocked).map(([id, f]) => [id, { stock: f.stock, delivered: f.delivered }])),
  pl: s.pl.total,
});
