// Nettoyage d'une sauvegarde : retire toute référence (SKU) que le catalogue ne connaît plus.
// Règle pure (aucun React, aucun navigateur) : voir tests/domain/state-purge.test.mjs.
// Sans table de correspondance : une référence inconnue est simplement oubliée (stocks, OF, commandes…).
// Modifie l'état « brouillon » reçu (déjà cloné par migrate()).

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

/** Supprime d'une table { sku: valeur } les clés inconnues. */
const purgeMap = (map, known) => {
  if (!isObj(map)) return;
  Object.keys(map).forEach((k) => { if (!known.has(k)) delete map[k]; });
};

/** Garde seulement les éléments d'une liste dont le sku est connu (ou absent). */
const keepKnown = (list, known) => (Array.isArray(list) ? list.filter((x) => !x || x.sku == null || known.has(x.sku)) : list);
const keepKnownCodes = (list, known) => (Array.isArray(list) ? list.filter((k) => known.has(k)) : list);

/** Retire de l'état toutes les références absentes de `skus` (liste des codes du catalogue). */
export function purgeUnknownSkus(d, skus) {
  const known = new Set(skus);

  purgeMap(d.launched, known);
  purgeMap(d.factoryStock, known);
  if (d.dc) {
    purgeMap(d.dc.stock, known);
    purgeMap(d.dc.buffer, known);
    ['yard', 'docked'].forEach((k) => (d.dc[k] || []).forEach((t) => purgeMap(t.lines, known)));
    if (Array.isArray(d.dc.orders)) {
      d.dc.orders.forEach((o) => { o.lines = keepKnown(o.lines, known); o.missing = keepKnownCodes(o.missing, known); });
      d.dc.orders = d.dc.orders.filter((o) => !Array.isArray(o.lines) || o.lines.length > 0);
    }
  }
  Object.values(d.filiales || {}).forEach((f) => {
    purgeMap(f.stock, known);
    purgeMap(f.carry, known);
    (f.otifLog || []).forEach((l) => { l.missing = keepKnownCodes(l.missing, known); });
  });
  (d.transit || []).forEach((t) => purgeMap(t.lines, known));
  (d.shipments || []).forEach((sh) => { purgeMap(sh.lines, known); sh.missing = keepKnownCodes(sh.missing, known); });

  // Usines : OF retirés, lignes réglées sur une référence inconnue remises à vide
  Object.values(d.factories || {}).forEach((f) => {
    const removed = new Set((f.queue || []).filter((o) => o && o.sku != null && !known.has(o.sku)).map((o) => o.id));
    f.queue = keepKnown(f.queue, known);
    (f.lines || []).forEach((l) => {
      if (l.sku != null && !known.has(l.sku)) l.sku = null;
      if (l.orderId != null && removed.has(l.orderId)) { l.orderId = null; if (l.status === 'running' || l.status === 'changeover') { l.status = 'idle'; l.timeLeft = 0; } }
    });
  });

  d.campaigns = keepKnown(d.campaigns, known);
  if (d.rd) d.rd.projects = keepKnown(d.rd.projects, known);
  if (d.event && d.event.sku != null && !known.has(d.event.sku)) d.event = null;
  return d;
}
