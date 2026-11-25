# Architecture de Supply Chain Tycoon

Ce document propose une architecture cible pour le code du jeu et la manière d'y arriver par petites étapes, sans jamais casser la partie en cours. La première étape est déjà faite dans la même PR (voir « Étape 0 »).

## Contexte retenu

Le modèle de demande avait des champs entre crochets. Ils sont remplis ici à partir du dépôt :

| Champ | Valeur retenue |
|---|---|
| Langage / framework | JavaScript (JSX), React 18 avec `useReducer`, d3-geo pour le globe, build esbuild |
| Type d'application | Jeu de gestion web, 100 % navigateur, hors ligne, sans serveur. Livré en une page HTML autonome (`dist/`) |
| Taille | 1 fichier source d'environ 5 100 lignes (≈ 485 Ko, dont 128 Ko de contours de cartes) |
| Problèmes ressentis | Fichier unique ingérable, pas de test, difficile de faire évoluer une mécanique sans en casser une autre |
| Contraintes | Projet perso (1 personne + Claude), pas de réécriture, migration progressive, le jeu doit rester jouable sur ordinateur et téléphone, la sortie reste un seul fichier HTML, et les sauvegardes existantes (`supply-chain-tycoon-save-v5`) doivent continuer à se charger |

**Hypothèses** (à corriger si besoin, rien ne bloque) : on reste en JavaScript (TypeScript n'apporterait pas assez pour le coût d'une migration à ce stade) ; on garde `useReducer` et l'état immuable cloné à chaque action, qui marchent bien ; pas de nouvelle librairie.

---

## 1. Diagnostic

Le code est en réalité bien pensé sur plusieurs points : les règles sont déjà presque toutes des fonctions pures sur un objet d'état, les constantes du jeu sont nommées et commentées avec leur sens métier, les notifications sont passées en paramètre (`notify`) aux fonctions de simulation, et `migrate()` gère la compatibilité des sauvegardes. Le problème n'est pas la qualité locale, c'est l'**organisation** : tout est au même endroit, donc tout peut dépendre de tout.

Par ordre de priorité :

1. **Les noms affichés mêlés au code du jeu.** Changer un nom de produit obligeait à fouiller tout le fichier. *Corrigé : l'habillage vit maintenant dans `brands/`.*
2. **Aucun filet de sécurité.** Pas un seul test : impossible de déplacer du code en étant sûr de ne rien changer aux règles. C'est ce qui bloque toute refonte. *Corrigé dans cette PR (golden master + tests unitaires).*
3. **Un fichier de 5 000 lignes qui mélange 4 métiers** : données de référence (l. 1-520), règles et simulation (l. 520-1 480), actions du joueur (l. 1 480-2 030, un `switch` de 65 cas), sauvegarde, puis 2 900 lignes d'interface. Toute modification oblige à naviguer dans l'ensemble, et rien n'empêche l'interface de modifier l'état directement.
4. **Des composants géants** : `GlobePanel` ≈ 650 lignes, `FactoryPanel` ≈ 460, `DCPanel` ≈ 380, chacun mêlant calculs métier, mise en page et styles. 527 objets `style={{…}}` en ligne et 388 couleurs codées en dur.
5. **Un reducer qui fait tout** : 550 lignes, il valide, débite, applique et formate les messages. La logique d'une même mécanique (ex. la centrale) est éparpillée entre les constantes, `tickDC`, le reducer et `DCPanel`.
6. **De l'état global mutable** hors de React : `TICK_MS` (réécrit à chaque rendu), `memorySave`, trois caches (`ROUTES_CACHE`, `GEO_CACHE`, `GL_MW_CACHE`), et `PRODUCT_SPECS` modifié au chargement pour mettre les noms de marque.
7. **Le domaine dépend de la présentation** à quelques endroits : les messages d'erreur du reducer utilisent `eur()`, et certaines constantes du jeu ne servent qu'à l'affichage.

Ce qui n'est **pas** un problème et qu'on garde : l'état unique sérialisable (c'est lui qui rend la sauvegarde triviale), les tables de données (`EQUIP`, `DC_UPGRADES`, `EVENT_DEFS`…) qui rendent l'ajout de contenu facile, et la page HTML unique en sortie.

---

## 2. Architecture cible

Quatre couches, plus deux petits dossiers transverses. C'est la Clean Architecture ramenée à la taille d'un jeu : pas d'interfaces abstraites partout, pas de conteneur d'injection, juste des dossiers avec une règle de dépendance claire.

```
src/
├── main.jsx                    point d'entrée navigateur                         ✅ fait
├── brands/                     habillage : noms de la maison et des produits     ✅ fait
│   └── ambrelune.js            Maison Ambrelune, choisie au build par l'alias @brand
├── shared/                     utilitaires sans aucune dépendance
│   └── format.js               eur(), pct(), fmtT()
├── domain/                     LES RÈGLES DU JEU, en JavaScript pur
│   ├── catalog/                données de référence : composants, produits, process, usines, filiales
│   ├── factory/                OF, lignes, équipements, maintenance, tickFactory
│   ├── dc/                     centrale logistique
│   │   ├── storage.js          racks et cellules                                 ✅ fait
│   │   ├── posts.js            postes, débits, kaizen, équipements
│   │   ├── orders.js           préparation, allocation, quais d'expédition
│   │   └── tick.js             tickDC
│   ├── filiales/               demande, OTIF, réappro, modes de transport, CO₂
│   ├── marketing/              désirabilité, A&P, campagnes
│   ├── finance/                P&L, impôt, taxe carbone, coûts horaires
│   ├── progression/            jalons, fonctionnalités, aléas
│   ├── state/                  initialState, migrate (sauvegardes)               ✅ commencé (purgeUnknownSkus.js)
│   └── simulation.js           une minute de jeu : enchaîne les tick*
├── application/                LES ACTIONS DU JOUEUR
│   ├── gameReducer.js          aiguillage action.type → handler
│   ├── context.js              pay(), fail(), notify() : ce dont une action a besoin
│   └── actions/                factory.js, dc.js, filiales.js, marketing.js, rd.js, system.js
├── infrastructure/             LE MONDE EXTÉRIEUR
│   └── saveStorage.js          window.storage / localStorage, export et import de fichier
└── ui/                         LA PRÉSENTATION (React)
    ├── App.jsx                 coquille, onglets, boucle de temps, sauvegarde auto
    ├── theme.js                couleurs, LUXE_CSS, styles de boutons
    ├── components/             Btn, Card, Bar, Modal, Stepper, Ico, Hint…
    ├── panels/                 un dossier par onglet : factory/, dc/, filiales/, marketing/, dashboard/, rd/, guide/
    └── globe/                  GlobePanel, routes.js, sites.js, geoData.js     (geoData ✅ fait)
tests/
├── helpers/                    chargement du jeu dans Node, joueur automatique  ✅ fait
├── domain/                     tests unitaires des règles                        ✅ commencé
├── simulation.test.mjs         golden master : 3 jours de jeu, habillage, migrate ✅ fait
└── architecture.test.mjs       respect des règles de dépendance                  ✅ fait
```

### Rôle de chaque couche

| Couche | Contient | Ne contient jamais |
|---|---|---|
| `domain/` | Les règles de la supply chain : combien coûte un rack, comment une filiale calcule son besoin, ce qui se passe pendant une minute de jeu. Des fonctions qui lisent ou modifient l'état « brouillon ». | React, `window`, textes d'interface, `localStorage` |
| `application/` | Une fonction par action du joueur (`BUY_RACKING`, `CREATE_ORDER`…) : vérifier, payer, appeler le domaine, prévenir le joueur. | Du calcul métier (il est dans le domaine), du JSX |
| `infrastructure/` | Ce qui parle au monde extérieur : stockage de la sauvegarde, téléchargement d'un fichier. | Des règles du jeu |
| `ui/` | Ce qu'on voit : panneaux, composants, globe, styles. Lit l'état, envoie des actions. | Des modifications directes de l'état, des règles du jeu recopiées |
| `brands/` | Habillage : noms de la maison et des produits, message d'accueil. | Du code |
| `shared/` | Petits utilitaires purs (formatage). | Toute dépendance |

### Règles de dépendance

```
ui ──────────► application ──────► domain ◄──── brands (données)
 │                                   ▲
 ├──────────────────────────────────┘   (lecture : constantes à afficher, sélecteurs)
 └──► infrastructure                     shared ◄── tout le monde
```

- Le **domaine ne dépend de rien** (sauf `shared/` et les données de `brands/`). C'est lui qui a le plus de valeur et qui doit être le plus stable.
- L'**application** dépend du domaine, jamais de l'interface.
- L'**interface** dépend de tout le reste, mais ne modifie l'état qu'en envoyant des actions.
- L'**infrastructure** est branchée par `App.jsx` : le reste du jeu ne sait pas où la partie est sauvegardée.

Ces règles sont vérifiées automatiquement par `tests/architecture.test.mjs` : un import interdit fait échouer `npm test`.

---

## 3. Justification des choix

| Choix | Principe appliqué | Problème résolu |
|---|---|---|
| **Un seul code, l'habillage choisi au build** (`brands/` + alias `@brand`) | DRY ; OCP (un nouvel habillage = un nouveau fichier, sans modifier le code) | Diagnostic n°1 : les noms mêlés au code. |
| **Golden master avant de déplacer quoi que ce soit** | Prérequis de tout refactoring : changer la structure sans changer le comportement | Diagnostic n°2. On peut déplacer du code les yeux fermés : si les 3 jours simulés donnent un résultat différent, le test le dit. |
| **Découpage par métier dans le domaine** (`factory/`, `dc/`, `filiales/`…) plutôt que par type technique (`constants/`, `utils/`) | SRP : un module = une raison de changer (une mécanique du jeu) ; forte cohésion | Diagnostic n°3 et n°5 : aujourd'hui, modifier la centrale oblige à modifier 4 zones du fichier. Demain, tout est dans `domain/dc/`. |
| **Le domaine en JavaScript pur** | Clean Architecture : dépendances dirigées vers le domaine | Les règles deviennent testables en quelques millisecondes, sans navigateur, et réutilisables (simulation accélérée, équilibrage). |
| **Fonctions « devis » + « application »** (`rackingQuote` puis `addRacking`) | SRP ; commande / requête séparées | Le reducer n'a plus à connaître les règles de prix : il demande un devis, paie, applique. L'interface peut afficher le même devis que celui qui sera payé (plus de prix recalculé à la main dans le JSX). |
| **Un handler par action, regroupés par module** | SRP ; OCP (ajouter une action = ajouter une fonction, sans modifier un `switch` de 550 lignes) | Diagnostic n°5. |
| **`context.js` (pay, fail, notify) passé aux handlers** | DIP : les actions dépendent d'une petite abstraction, pas de React ni du toast | C'est ce que fait déjà `notify` pour les tick : on généralise un bon réflexe existant. |
| **Stockage isolé dans `infrastructure/`** | DIP | Le jeu tourne aussi bien dans un artifact Claude (`window.storage`), dans un navigateur (`localStorage`) que dans un test (mémoire). |
| **Petits composants d'interface + `theme.js`** | SRP, DRY ; ISP (un panneau reçoit ce dont il a besoin, pas tout `g` quand ce n'est pas utile) | Diagnostic n°4 : 388 couleurs en dur, composants de 400 à 650 lignes. |
| **Garder `useReducer` et l'état unique** | KISS | Ça marche, c'est sérialisable, c'est la sauvegarde. Redux, Zustand ou une couche « repository » n'apporteraient rien ici. |
| **Pas de classes, pas d'interfaces abstraites, pas de TypeScript pour l'instant** | KISS, YAGNI | Projet d'une personne. LSP ne s'applique presque pas (aucun héritage) ; le seul « contrat » partagé, celui de l'habillage, est vérifié par `simulation.test.mjs` (chaque référence a un nom). On pourra ajouter `// @ts-check` + JSDoc sur `domain/` plus tard, à coût quasi nul. |

---

## 4. Exemple concret : acheter des racks à la centrale

C'est la mécanique de stockage de la centrale logistique (8 cellules, 55 000 emplacements à équiper petit à petit). Elle a été migrée dans cette PR.

### Avant

Les règles étaient réparties à trois endroits du fichier unique : des constantes en haut (l. 343-350), la logique de prix dans le reducer, et une partie recopiée dans l'interface.

```js
// SupplyChainTycoon.jsx, en haut du fichier
const RACK_STEP = 100;
const RACK_COST = 10000;
const MAX_RACK_PER_CELL = 6875;
const RACK_BULK = 1000;          // achat groupé : 1 000 emplacements pour le prix de 900
const cellCost = (id) => Math.round((CELL_COST * Math.pow(1.6, Math.max(0, id - 2))) / 1000) * 1000;

// … 1 500 lignes plus bas, dans le reducer
case 'BUY_RACKING': {
  const cell = s.dc.cells.find((c) => c.id === action.cellId);
  if (cell.racking >= MAX_RACK_PER_CELL) return state;
  const bulk = action.bulk && MAX_RACK_PER_CELL - cell.racking >= RACK_BULK;
  if (!pay(bulk ? RACK_COST * 9 : RACK_COST)) return fail('Fonds insuffisants pour ajouter des emplacements !');
  cell.racking = Math.min(cell.racking + (bulk ? RACK_BULK : RACK_STEP), MAX_RACK_PER_CELL);
  return s;
}

// … et 1 300 lignes encore plus bas, dans DCPanel : la règle « achat groupé possible » et le prix sont recopiés
{MAX_RACK_PER_CELL - cell.racking >= RACK_BULK && <Btn …>+{RACK_BULK} ({eur(RACK_COST * 9)})</Btn>}
```

Problèmes : la règle « 1 000 pour le prix de 900 » existe deux fois (reducer et interface), rien n'est testable sans lancer le jeu, et pour comprendre le stockage il faut lire trois zones éloignées.

### Après

**Domaine** : `src/domain/dc/storage.js`, toutes les règles du stockage, sans React.

```js
export const RACK_BULK_PRICE = RACK_COST * 9;

/** Devis d'un achat de racks : { cost, slots }, ou null si la cellule est déjà pleine. */
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
```

**Application** : le reducer ne fait plus qu'orchestrer (devis → paiement → application).

```js
case 'BUY_RACKING': {
  const cell = s.dc.cells.find((c) => c.id === action.cellId);
  const quote = rackingQuote(cell, action.bulk);
  if (!quote) return state;
  if (!pay(quote.cost)) return fail('Fonds insuffisants pour ajouter des emplacements !');
  addRacking(cell, quote.slots);
  return s;
}
```

À l'étape 5 du plan, ce bloc deviendra simplement une fonction `buyRacking(s, action, ctx)` dans `application/actions/dc.js`.

**Interface** : elle réutilise la même règle au lieu de la recopier.

```jsx
{canBuyBulk(cell) && <Btn …>+{RACK_BULK} ({eur(RACK_BULK_PRICE)})</Btn>}
```

**Tests** : `tests/domain/dc-storage.test.mjs` (8 tests, quelques millisecondes), qui documentent la règle en même temps :

```js
test('plus d’achat groupé quand il reste moins de 1 000 places', () => {
  const cell = { id: 1, unlocked: true, racking: MAX_RACK_PER_CELL - 500 };
  assert.deepEqual(rackingQuote(cell, true), { cost: RACK_COST, slots: RACK_STEP });
});
```

Et le golden master confirme qu'une partie de 3 jours donne exactement le même résultat avant et après.

---

## 5. Plan de migration

Chaque étape est une PR autonome. **Règle commune** : `npm test` vert (dont le golden master inchangé), `npm run build` OK, et une partie rapide sur ordinateur et téléphone. Une étape ne change jamais les règles du jeu ; si on veut changer une règle, on le fait dans une PR à part et on met à jour le golden master volontairement (`UPDATE_SNAPSHOT=1 npm test`).

| # | Étape | Contenu | Taille |
|---|---|---|---|
| **0** | **Socle** ✅ *(cette PR)* | Un seul code, l'habillage à part (`brands/` + alias `@brand`) ; `src/main.jsx` ; tests (golden master 3 jours, unitaires, architecture) ; contours de cartes sortis dans `ui/globe/geoData.js` ; stockage de la centrale migré dans `domain/dc/storage.js`. | fait |
| 1 | Transverses | `shared/format.js` (eur, pct, fmtT) et `ui/theme.js` (couleurs, `LUXE_CSS`, styles de boutons). Purement mécanique. | S |
| 2 | Catalogue | `domain/catalog/` : `COMPONENTS`, `PROCESS`, `PRODUCT_SPECS` (avec les noms de marque appliqués proprement, sans muter au chargement), `FACTORY_DEFS`, `FILIALE_DEFS`. | S |
| 3 | Règles par métier | Un module par PR, chacun avec ses tests unitaires : `finance/` → `dc/` (postes, commandes, `tickDC`) → `factory/` → `filiales/` → `marketing/` → `progression/` (jalons, aléas). Commencer par la centrale, c'est la partie que tu fais le plus évoluer. | M × 6 |
| 4 | État et simulation | `domain/state/` (`initialState`, `migrate`) et `domain/simulation.js` : le cas `TICK` du reducer devient `advanceOneMinute(s, notify)`. Ajouter des sauvegardes réelles en fixtures de test. | M |
| 5 | Actions du joueur | `application/` : le `switch` de 65 cas est découpé en handlers par module ; `context.js` fournit `pay`, `fail`, `notify`. | M |
| 6 | Sauvegarde | `infrastructure/saveStorage.js` ; `App.jsx` le reçoit. Supprimer le global `memorySave`. | S |
| 7 | Interface | `ui/components/` d'abord, puis un panneau par PR : Centrale, Usines, Filiales, Marketing, Pilotage, R&D, Guide. Le globe en dernier : séparer le dessin canvas, les routes et le panneau de détails. Remplacer le global `TICK_MS` par une valeur passée en prop ou en contexte. | M × 8 |
| 8 | Finitions | `SupplyChainTycoon.jsx` n'existe plus (remplacé par `ui/App.jsx`) ; option `// @ts-check` + JSDoc sur `domain/`. | S |

On peut s'arrêter à n'importe quelle étape : le jeu fonctionne à chaque fois. Rien n'oblige à tout faire d'un coup, et une nouvelle mécanique (coffrets de Noël, lancements avec allocation, libération QC…) peut être écrite directement dans la nouvelle structure dès que le module concerné existe.

**Conséquence pratique** : la source de vérité est désormais le dépôt. Le fichier jouable reste un seul HTML (`npm run build` → `dist/`), qu'on peut publier tel quel. Il n'y a plus de `.jsx` unique à copier.

---

## 6. Stratégie de tests

Outil : `node:test`, intégré à Node, aucune dépendance à ajouter. `npm test` lance tout en ≈ 5 secondes.

| Niveau | Ce qu'on teste | Comment | État |
|---|---|---|---|
| **Domaine** | Chaque règle métier : prix, capacités, débits, calcul du besoin d'une filiale, OTIF, désirabilité, impôt, taxe carbone, effets des aléas. Les cas limites (cellule pleine, stock à zéro, découvert). | Tests unitaires sur des petits objets d'état construits à la main. Rapides, nombreux, lisibles comme des règles du jeu. | commencé (`dc-storage`, `state-purge`) |
| **Simulation** | Que toute la chaîne tourne ensemble et ne change pas sans qu'on le veuille. | Golden master : un joueur automatique joue 3 jours avec un hasard fixé, le résumé est comparé à `tests/snapshots/`. À compléter par des invariants (aucun stock négatif, palettes conservées entre usine et centrale, trésorerie toujours un nombre). | fait (golden master) |
| **Application** | Chaque action : refus quand les fonds manquent, quand la fonctionnalité n'est pas débloquée, effet correct quand tout va bien. | `handler(state, action, fakeContext)` → on vérifie l'état et les messages. | à faire (étape 5) |
| **Sauvegardes** | Qu'une ancienne partie se recharge toujours, même si elle contient une référence retirée du catalogue. | `migrate()` sur des sauvegardes réelles gardées en fixtures ; aller-retour save → load avec un stockage en mémoire ; `tests/domain/state-purge.test.mjs`. | commencé (`migrate`, purge) |
| **Habillage** | Chaque référence du catalogue a un nom affiché, et l'habillage ne nomme aucune référence inconnue. | `simulation.test.mjs`. | fait |
| **Architecture** | Que le domaine reste pur et que les couches respectent leurs dépendances. | `architecture.test.mjs` lit les imports. | fait |
| **Interface** | Que la page s'ouvre et que chaque onglet s'affiche sans erreur, sur ordinateur et sur téléphone. | Test de fumée Playwright sur `dist/SupplyChainTycoon.html` (chargé avec une partie avancée) : `npm run test:ui`. Pas de tests unitaires de composants : ce serait coûteux pour un gain faible dans un jeu perso. | fait (`tests/ui/smoke.mjs`) |
