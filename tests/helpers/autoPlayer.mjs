// Un joueur automatique très simple, pour faire tourner toute la chaîne dans les tests :
// achats → OF à l'usine de parfum → camion → centrale (réception, rangement, préparation, chargement) → filiale.
// Il ne cherche pas à bien jouer, seulement à passer par toutes les mécaniques de base.
const PARFUM_COMPS = ['ALCOOL', 'ESSENCES', 'FLACON_50', 'BOUCHON', 'ETUI_PARF50', 'CARTON_PARF', 'PALETTE'];

export function playOneTick(reducer, state, i) {
  let s = state;
  const act = (action) => { s = reducer(s, action); };
  while (s.popups.length) act({ type: 'CLOSE_POPUP' });

  if (i === 5) { act({ type: 'HIRE_SUPPLY', fid: 'PARFUM' }); act({ type: 'DC_HIRE' }); act({ type: 'DC_HIRE' }); }
  if (i % 30 === 0) {
    PARFUM_COMPS.forEach((comp) => { if ((s.components[comp] || 0) < 2000) act({ type: 'ORDER_COMPONENT', fid: 'PARFUM', comp }); });
  }
  if (i % 5 === 0) {
    const f = s.factories.PARFUM;
    if (f.queue.length < 2) act({ type: 'CREATE_ORDER', fid: 'PARFUM', sku: 'PARF_50', pallets: 5 });
    s.factories.PARFUM.queue.forEach((o) => act({ type: 'ADVANCE_ORDER', fid: 'PARFUM', orderId: o.id }));
  }
  if (i % 60 === 0) {
    act({ type: 'SEND_TRUCK', fid: 'PARFUM' });
    if (s.features.pick && s.dc.assign.pick === 0) act({ type: 'DC_ASSIGN', post: 'pick', delta: 1 });
    if (s.features.load && s.dc.assign.load === 0) act({ type: 'DC_ASSIGN', post: 'load', delta: 1 });
    s.dc.orders.filter((o) => o.status === 'open').forEach((o) => act({ type: 'RELEASE_ORDER', orderId: o.id }));
  }
  act({ type: 'TICK' });
  return s;
}
