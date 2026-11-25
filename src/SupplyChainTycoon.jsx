import React, { useReducer, useEffect, useState, useRef } from 'react';
import { geoOrthographic, geoPath, geoGraticule10, geoCircle } from 'd3'; // globe 3D (d3-geo)
import BRAND from '@brand'; // habillage choisi au build : src/brands/ambrelune.js
import { GEO_DATA } from './ui/globe/geoData.js';
import {
  DC_CELLS, MAX_RACK_PER_CELL, RACK_STEP, RACK_COST, RACK_BULK, RACK_BULK_PRICE, RACK_RENT,
  cellCost, dcCapacity, initialCells, completeCells, canBuyBulk, rackingQuote, addRacking, cellQuote, openCell,
} from './domain/dc/storage.js';
import { purgeUnknownSkus } from './domain/state/purgeUnknownSkus.js';

/* ============================================================
   SUPPLY CHAIN TYCOON — v5.5 « Maison Ambrelune »
   1 tick = 1 seconde réelle = 1 minute de jeu (vitesse ×1).
   Nouveauté v5.5 : affichage adapté au téléphone (barre d'onglets en bas, en-tête compact,
   livraisons du globe en panneau coulissant) comme à l'ordinateur.
   Nouveauté v5.4 : onglet « Globe » (débloqué au premier camion), globe 3D zoomable où
   circulent en direct camions, bateaux et avions, avec usines et centrale placées sur la carte.
   Nouveautés v5 :
   - Progression par objectifs : les mécaniques se débloquent au fil des chapitres,
     chacune expliquée par une fiche « Dans la vraie vie ».
   - Centrale logistique en 4 postes : réception → rangement → préparation → chargement.
   - Filiales réalistes : elles vendent à leur marché, commandent à la centrale
     (stock cible en minutes de couverture) et jugent la centrale à l'OTIF.
   ============================================================ */

/* --- Tous les achats : matières premières, composants, cartons, palettes ---
   comp(nom, icône, prix unitaire, délai de livraison, lot minimum commandé, stock max) */
const comp = (name, icon, cost, leadTime, lot, max) => ({ name, icon, cost, leadTime, lot, max });
const COMPONENTS = {
  // Matières premières (vrac) : consommées à la pesée
  ALCOOL:      comp('Alcool parfumeur',      '🧪', 0.96, 30, 1000, 6000),
  ESSENCES:    comp('Essences & concentrés', '🌸', 1.44, 90, 500, 4000), // Grasse : ~650 km
  BASE_SOIN:   comp('Base crème & sérum',    '🧴', 0.72, 30, 1000, 6000),
  ACTIFS:      comp('Actifs cosmétiques',    '💊', 1.2, 120, 500, 4000), // chimie fine européenne
  PIGMENTS:    comp('Pigments',              '🎨', 1.32, 120, 500, 4000), // importés
  BASE_MAKEUP: comp('Cires & huiles',        '🕯', 0.72, 30, 1000, 6000),
  // Composants de conditionnement : consommés par les lignes
  FLACON_50:     comp('Flacons 50 ml',        '🍾', 1.2, 45, 500, 2000),
  FLACON_100:    comp('Flacons 100 ml',       '🍾', 1.92, 45, 500, 2000),
  BOUCHON:       comp('Bouchons & capuchons', '🔘', 0.6, 30, 500, 2000),
  ETUI_PARF50:   comp('Étuis parfum 50 ml',   '🎁', 0.6, 30, 500, 2000),
  ETUI_PARF100:  comp('Étuis parfum 100 ml',  '🎁', 0.84, 30, 500, 2000),
  POT_CREME:     comp('Pots de crème',        '🍯', 0.84, 45, 1000, 4000),
  ETUI_CREME:    comp('Étuis crème',          '📦', 0.48, 30, 1000, 4000),
  FLACON_SERUM:  comp('Flacons sérum',        '💧', 1.08, 45, 1000, 4000),
  ETUI_SERUM:    comp('Étuis sérum',          '📦', 0.48, 30, 1000, 4000),
  FLACON_FOND:   comp('Flacons fond de teint', '🍶', 1.08, 45, 1000, 4000),
  ETUI_FOND:     comp('Étuis fond de teint',  '📦', 0.48, 30, 1000, 4000),
  TUBE_ROUGE:    comp('Tubes rouge à lèvres', '💄', 0.96, 150, 1000, 4000), // fabricants italiens
  ETUI_ROUGE:    comp('Étuis rouge à lèvres', '📦', 0.36, 30, 1000, 4000),
  // Logistique : cartons d'expédition et palettes bois
  CARTON_PARF:   comp('Cartons parfum',       '📦', 0.72, 20, 300, 1500),
  CARTON_SKIN:   comp('Cartons skincare',     '📦', 0.72, 20, 300, 1500),
  CARTON_MAKEUP: comp('Cartons maquillage',   '📦', 0.72, 20, 300, 1500),
  PALETTE:       comp('Palettes bois',        '🪵', 9.6, 10, 50, 300),
  // Parfums d'exception (usine prestige, fin de partie)
  ESSENCES_RARES:  comp('Essences rares (iris, oud)', '💎', 7.2, 360, 200, 1500), // Inde, Moyen-Orient
  FLACON_CRISTAL:  comp('Flacons en cristal',   '🔮', 9.6, 180, 200, 800), // cristallerie de l'Est
  ETUI_PRESTIGE:   comp('Coffrets laqués',      '🎁', 3.6, 60, 200, 800),
  CARTON_PRESTIGE: comp('Caisses prestige',     '📦', 1.8, 20, 100, 600),
};

/* --- Produits : 2 références par usine ---
   comps = composants de conditionnement pour 1 unité (cartons et palettes sont ajoutés automatiquement) */
const prod = (name, factory, unitsPerCarton, cartonsPerPallet, sellingPricePerUnit, baseRate, comps) =>
  ({ name, factory, unitsPerCarton, cartonsPerPallet, sellingPricePerUnit, baseRate, comps });
/* Chaque référence a ses propres temps de fabrication (visibles en survolant son nom) :
   weigh = unités pesées par minute et par poste · batch = taille d'un lot de cuve · cuve = minutes par lot
   (une crème est une émulsion longue, un extrait macère, un rouge à lèvres se coule vite…) */
const PROCESS = {
  PARF_50:      { weigh: 15, batch: 600,  cuve: 30 },
  PARF_100:     { weigh: 14, batch: 600,  cuve: 35 },
  SKIN_CREME:   { weigh: 20, batch: 800,  cuve: 45 },
  SKIN_SERUM:   { weigh: 18, batch: 800,  cuve: 40 },
  MK_FOND:      { weigh: 16, batch: 600,  cuve: 40 },
  MK_ROUGE:     { weigh: 25, batch: 1000, cuve: 35 },
  PRES_EXTRAIT: { weigh: 6,  batch: 200,  cuve: 60 },
  PRES_100:     { weigh: 6,  batch: 200,  cuve: 60 },
  PARF_BOISE:   { weigh: 14, batch: 600,  cuve: 35 },
  PARF_FLORAL:  { weigh: 13, batch: 500,  cuve: 40 },
  PARF_EDT:     { weigh: 16, batch: 600,  cuve: 30 },
  PARF_FRAIS:   { weigh: 18, batch: 800,  cuve: 25 },
  SKIN_HYDRA:   { weigh: 22, batch: 1000, cuve: 40 },
  SKIN_REPAR:   { weigh: 12, batch: 400,  cuve: 55 },
  SKIN_EXFO:    { weigh: 18, batch: 800,  cuve: 35 },
  MK_ENCRE:     { weigh: 22, batch: 800,  cuve: 30 },
  MK_MASCARA:   { weigh: 20, batch: 800,  cuve: 40 },
  MK_HALO:      { weigh: 18, batch: 600,  cuve: 35 },
  PRES_AMBRE:   { weigh: 5,  batch: 200,  cuve: 70 },
};
const PRODUCT_SPECS = {
  PARF_50:    prod('Parfum 50 ml',        'PARFUM',   6, 12, 45, 6,  { FLACON_50: 1, BOUCHON: 1, ETUI_PARF50: 1 }),
  PARF_100:   prod('Parfum 100 ml',       'PARFUM',   6, 10, 70, 5,  { FLACON_100: 1, BOUCHON: 1, ETUI_PARF100: 1 }),
  SKIN_CREME: prod('Crème visage 50 ml',  'SKINCARE', 12, 24, 22, 10, { POT_CREME: 1, ETUI_CREME: 1 }),
  SKIN_SERUM: prod('Sérum 30 ml',         'SKINCARE', 12, 20, 35, 8,  { FLACON_SERUM: 1, ETUI_SERUM: 1 }),
  MK_FOND:    prod('Fond de teint',       'MAKEUP',   12, 20, 28, 8,  { FLACON_FOND: 1, ETUI_FOND: 1 }),
  MK_ROUGE:   prod('Rouge à lèvres',      'MAKEUP',   24, 24, 18, 12, { TUBE_ROUGE: 1, ETUI_ROUGE: 1 }),
  PRES_EXTRAIT: prod('Extrait de parfum 30 ml', 'PRESTIGE', 4, 10, 220, 2,  { FLACON_CRISTAL: 1, ETUI_PRESTIGE: 1 }),
  PRES_100:     prod("Parfum d'exception 100 ml", 'PRESTIGE', 4, 8, 320, 1.5, { FLACON_CRISTAL: 1, ETUI_PRESTIGE: 1 }),
  // Références issues du Développement (débloquées une par une, usine par usine)
  PARF_BOISE:    prod('Eau de parfum boisée 100 ml', 'PARFUM', 6, 10, 75, 5, { FLACON_100: 1, BOUCHON: 1, ETUI_PARF100: 1 }),
  PARF_FLORAL:   prod('Parfum floral ambré 100 ml', 'PARFUM', 6, 10, 80, 5, { FLACON_100: 1, BOUCHON: 1, ETUI_PARF100: 1 }),
  PARF_EDT:      prod('Eau de toilette 50 ml', 'PARFUM', 6, 12, 50, 6, { FLACON_50: 1, BOUCHON: 1, ETUI_PARF50: 1 }),
  PARF_FRAIS:    prod('Eau fraîche 100 ml',   'PARFUM', 6, 10, 65, 6, { FLACON_100: 1, BOUCHON: 1, ETUI_PARF100: 1 }),
  SKIN_HYDRA:    prod('Crème hydratante 50 ml', 'SKINCARE', 12, 24, 30, 10, { POT_CREME: 1, ETUI_CREME: 1 }),
  SKIN_REPAR:    prod('Crème réparatrice 50 ml', 'SKINCARE', 12, 20, 95, 6, { POT_CREME: 1, ETUI_CREME: 1 }),
  SKIN_EXFO:     prod('Soin exfoliant 30 ml',  'SKINCARE', 12, 20, 40, 8, { FLACON_SERUM: 1, ETUI_SERUM: 1 }),
  MK_ENCRE:      prod('Gloss longue tenue',    'MAKEUP', 24, 24, 22, 12, { TUBE_ROUGE: 1, ETUI_ROUGE: 1 }),
  MK_MASCARA:    prod('Mascara volume',        'MAKEUP', 24, 24, 20, 12, { TUBE_ROUGE: 1, ETUI_ROUGE: 1 }),
  MK_HALO:       prod('Enlumineur liquide',    'MAKEUP', 12, 20, 32, 8, { FLACON_FOND: 1, ETUI_FOND: 1 }),
  PRES_AMBRE:    prod("Collection d'exception 100 ml", 'PRESTIGE', 4, 8, 280, 1.5, { FLACON_CRISTAL: 1, ETUI_PRESTIGE: 1 }),
};
/* --- Habillage (noms de la maison, des produits, sources des sites) : fourni par src/brands/<marque>.js,
   choisi au build par l'alias « @brand » (voir scripts/build.mjs). Le code du jeu est le même pour toutes les marques. */
Object.entries(BRAND.productNames).forEach(([k, n]) => { if (PRODUCT_SPECS[k]) PRODUCT_SPECS[k].name = n; });
const SKUS = Object.keys(PRODUCT_SPECS);

/* --- Usines : raw = matières premières pour 1 unité de vrac ---
   Ordre d'ouverture des usines : le parfum d'abord, puis le soin, puis le maquillage,
   et enfin les parfums d'exception, fabriqués en petites séries. */
const FACTORY_DEFS = {
  PARFUM:   { name: 'Usine Parfum',     icon: '🌸', buyCost: 0,      skus: ['PARF_50', 'PARF_100', 'PARF_BOISE', 'PARF_FLORAL', 'PARF_EDT', 'PARF_FRAIS'], raw: { ALCOOL: 1, ESSENCES: 1 },      carton: 'CARTON_PARF' },
  SKINCARE: { name: 'Usine Skincare',   icon: '🧴', buyCost: 120000, skus: ['SKIN_CREME', 'SKIN_SERUM', 'SKIN_HYDRA', 'SKIN_EXFO', 'SKIN_REPAR'], raw: { BASE_SOIN: 1, ACTIFS: 1 },     carton: 'CARTON_SKIN' },
  MAKEUP:   { name: 'Usine Maquillage', icon: '💄', buyCost: 250000, skus: ['MK_FOND', 'MK_ROUGE', 'MK_ENCRE', 'MK_MASCARA', 'MK_HALO'], raw: { PIGMENTS: 1, BASE_MAKEUP: 1 }, carton: 'CARTON_MAKEUP' },
  PRESTIGE: { name: "Usine Parfums d'exception", icon: '💎', buyCost: 400000, skus: ['PRES_EXTRAIT', 'PRES_100', 'PRES_AMBRE'], raw: { ESSENCES_RARES: 1 }, carton: 'CARTON_PRESTIGE' },
};

/* --- Marketing de maison de luxe ---
   1. Désirabilité (0-100) de chaque référence sur chaque marché : elle fixe la demande de fond (×0,5 à ×1,5) et le prix tenu (×0,9 à ×1,1).
   2. Budget publicité & promotion (A&P) en % des ventes, par filiale : il tire la désirabilité vers une cible (rendements décroissants).
      Sans budget elle s'érode ; une rupture de stock l'abîme aussi (le luxe ne pardonne pas l'absence en rayon).
   3. Campagnes ciblées (une référence, un ou tous les marchés, un levier), annoncées à l'avance, avec un bilan à la fin. */
const DES0 = 50;
const AP_DEFAULT = 8;          // % des ventes à l'ouverture du marketing
const AP_MAX = 40;
const DES_SPEED = 1 / 720;     // la désirabilité rejoint sa cible en une douzaine d'heures
const DES_RUPTURE = 0.03;      // perte par minute de rupture sur une référence
const desTarget = (ap) => 30 + 65 * (1 - Math.exp(-ap / 15));
const MKT_LEVERS = {
  DIGITAL: { name: 'Digital et influenceurs', icon: '📱', hours: 1.2, min: 5000,  lead: 60,  duration: 240, boost: 0.5, des: 4,
             desc: 'Effet rapide et fort, mais court. Idéal pour relancer une référence.' },
  TV:      { name: 'Film TV et affichage',    icon: '📺', hours: 5, min: 25000, lead: 180, duration: 600, boost: 0.8, des: 10,
             desc: "Le grand jeu : très forte hausse pendant 10 h et une image durablement renforcée. Annoncé 3 h avant : préparez le stock." },
  RETAIL:  { name: 'Conseillères et échantillons', icon: '💄', hours: 1.4, min: 3000, lead: 30, duration: 480, boost: 0.2, des: 8,
             desc: 'Animation en magasin : petite hausse des ventes, mais la désirabilité monte durablement.' },
};

/* --- Salaires et frais : en € par heure de jeu (= par minute réelle à vitesse ×1) --- */
const SUPPLY_STAFF_COST = 250;  // agent d'appro usine
const BUYER_COST = 300;         // acheteur
const TECH_COST = 300;          // technicien de maintenance
const DC_STAFF_COST = 300;      // équipier de la centrale
const FIXED_COST = 600;         // frais de structure (siège, énergie, assurances)
const OVERDRAFT_RATE = 0.01;    // agios : 1 % du découvert par heure
/* --- Compte de résultat : chaque flux d'argent est rangé dans une ligne --- */
const PL_LINES = [
  ['ventes', "Chiffre d'affaires"], ['commercial', 'Frais commerciaux des filiales'], ['achats', 'Achats de composants'],
  ['transport', 'Transport'], ['salaires', 'Salaires'], ['structure', 'Frais de structure'], ['racks', 'Loyer des racks'],
  ['stockfil', 'Stock des filiales'], ['usine', 'Maintenance et changements de série'], ['marketing', 'Marketing'], ['rd', 'Développement (R&D)'],
  ['carbone', 'Taxe carbone'], ['incidents', 'Vols et surestaries'], ['agios', 'Agios'], ['autres', 'Autres'],
];
const PL_OUT = ['impot', 'invest', 'primes']; // hors résultat d'exploitation
const book = (s, cat, amt) => { s.money += amt; if (s.pl) { s.pl.cur[cat] = (s.pl.cur[cat] || 0) + amt; if (s.pl.hcur) s.pl.hcur[cat] = (s.pl.hcur[cat] || 0) + amt; } };
const plOp = (c) => PL_LINES.reduce((a, [k]) => a + (c[k] || 0), 0); // résultat d'exploitation
// Frais commerciaux : 0 % avec 1 ou 2 filiales, puis +2,5 points par filiale ouverte, 30 % au plus
const openFilialesCount = (s) => Object.values(s.filiales).filter((f) => f.unlocked).length;
const commercialRate = (s) => Math.min(0.30, Math.max(0, (openFilialesCount(s) - 2) * 0.025));
// Frais de structure : le siège grossit avec le réseau
const structureCost = (s) => FIXED_COST
  + Object.entries(s.filiales).reduce((a, [id, f]) => a + (f.unlocked && id !== 'FR' ? 1000 * FILIALE_DEFS[id].size : 0), 0)
  + Math.max(0, Object.values(s.factories).filter((f) => f.unlocked).length - 1) * 2000
  + Object.values(s.factories).reduce((a, f) => a + (f.unlocked ? zoneFixed(levelDef(f, 'fab'), 'fab') + zoneFixed(levelDef(f, 'cond'), 'cond') : 0), 0);
// Impôt sur le résultat de la journée, par tranches
const TAX_BRACKETS = [[50000, 0], [250000, 0.15], [1000000, 0.25], [Infinity, 0.33]];
const dayTax = (res) => { let t = 0, lo = 0; TAX_BRACKETS.forEach(([hi, r]) => { if (res > lo) t += (Math.min(res, hi) - lo) * r; lo = hi; }); return Math.round(t); };

/* --- Taxe carbone (dès l'export) : un plafond de CO₂ par palette transportée, qui baisse chaque jour --- */
const CARBON_TAX = 0.15;         // € par kg au-delà du quota (150 €/t)
const CARBON_CAP0 = 400;         // kg de CO₂ autorisés par palette le premier jour
const CARBON_CAP_MIN = 120;      // plancher
const CARBON_DROP = 0.97;        // -3 % par jour
const carbonOn = (s) => !!s.features.fil_US;
const carbonCap = (s) => Math.max(CARBON_CAP_MIN, Math.round(CARBON_CAP0 * CARBON_DROP ** Math.max(0, s.day - (s.carbon.start ?? s.day))));
const addCarbon = (s, kg, pal, air) => { s.carbon.co2 += kg; s.carbon.pal += pal; if (air) s.carbon.airPal += pal; };

/* --- Usine : appro, pesée et cuve --- */
const RECEIVE_RATE = 250;       // unités rangées par tick et par agent libre (quai -> zone d'appro)
const KIT_RATE = 300;           // unités préparées par tick par un agent (kit d'un OF)
const ZONE_COST = 30000;        // agrandissement de la zone d'appro (+50 % de stock par niveau)
const BUYER_PERIOD = 30;        // un acheteur passe une commande toutes les 30 s
const BUYER_TARGET = 0.7;       // il ne commande que si le stock (livraisons en route comprises) est sous 70 % de la zone
const STATION_COST = 20000;
const TANK_COST = 40000;
const APS_COST = 80000;         // module de planification automatique
const SOP_COST = 50000;         // module S&OP : les OF se créent seuls selon la demande des filiales
const SOP_REVIEW = 30;          // revue du plan toutes les 30 min
const LAUNCH_COST = { PARFUM: 40000, SKINCARE: 50000, MAKEUP: 60000, PRESTIGE: 100000 }; // (ancien) lancement direct
/* --- Développement (R&I) : chaque nouvelle référence est un projet long et cher ---
   Le prix grimpe avec le nombre de références déjà développées (+30 % par projet). Une seule référence
   à la fois par usine, dans l'ordre du portefeuille. Un laboratoire = un projet en parallèle. */
const RD_BASE = { PARFUM: 40000, SKINCARE: 70000, MAKEUP: 80000, PRESTIGE: 160000 };
const RD_TICKS = { PARFUM: 240, SKINCARE: 300, MAKEUP: 270, PRESTIGE: 420 };
const RD_STEP = 0.3;
const LAB_COST = 150000;
const rdCost = (s, sku) => Math.round(RD_BASE[PRODUCT_SPECS[sku].factory] * (1 + RD_STEP * s.rd.developed));
const nextRdSku = (s, fid) => FACTORY_DEFS[fid].skus.find((k) => !s.launched[k] && !s.rd.projects.some((p) => p.sku === k));

/* --- Usine : lignes de conditionnement --- */
const UPGRADE_LINE_COST = 50000;
/* --- Bâtiment de l'usine : 5 niveaux. Chaque niveau plafonne le nombre d'équipements et ouvre des équipements plus gros.
   Passer au niveau suivant = travaux d'agrandissement (cher, long, cadence à 85 % pendant le chantier). --- */
const FACTORY_LEVELS = [
  { name: 'Atelier',        st: 6,  tk: 6,  ln: 6,  cost: 0,        ticks: 0,    fixed: 0,     ms: 0 },
  { name: 'Usine',          st: 12, tk: 12, ln: 14, cost: 250000,   ticks: 180,  fixed: 500,   ms: 5 },
  { name: 'Usine agrandie', st: 20, tk: 20, ln: 25, cost: 2000000,  ticks: 480,  fixed: 1500,  ms: 7 },
  { name: 'Grand site',     st: 32, tk: 32, ln: 40, cost: 6000000,  ticks: 960,  fixed: 4000,  ms: 8 },
  { name: 'Site mondial',   st: 50, tk: 50, ln: 60, cost: 15000000, ticks: 1440, fixed: 10000, ms: 9 },
];
const WORKS_SPEED = 0.85;
const EQUIP_REFUND = 0.5; // reprise de l'ancien équipement quand on le remplace
// Tailles d'équipement : mult = capacité (lot de cuve, cadence de pesée ou de ligne), lvl = niveau de bâtiment requis
const EQUIP = {
  station: { label: 'Pesée', icon: '⚖️', key: 'stationT', tiers: [
    { name: 'Pesée manuelle', cost: 20000, mult: 1, lvl: 1 },
    { name: 'Pesée semi-automatique', cost: 150000, mult: 3, lvl: 2 },
    { name: 'Centrale de dosage automatique', cost: 1000000, mult: 10, lvl: 4 }] },
  tank: { label: 'Cuve', icon: '🛢', key: 'tankT', tiers: [
    { name: 'Micro-cuve', cost: 40000, mult: 1, time: 1, lvl: 1 },
    { name: 'Cuve industrielle', cost: 300000, mult: 5, time: 1.3, lvl: 2 },
    { name: 'Grande cuve', cost: 1500000, mult: 20, time: 1.6, lvl: 3 }] },
  line: { label: 'Ligne', icon: '🏭', key: null, tiers: [
    { name: 'Ligne standard', cost: 50000, mult: 1, change: 20, lvl: 1 },
    { name: 'Ligne rapide', cost: 400000, mult: 2, change: 30, lvl: 2 },
    { name: 'Ligne haute cadence', cost: 2000000, mult: 4, change: 45, lvl: 4 }] },
};
// Deux zones agrandies séparément : fabrication (pesée + cuves) et conditionnement (lignes). Chacune paie sa part des travaux et des frais fixes.
const ZONES = {
  fab:  { name: 'Fabrication', what: 'pesée et cuves', lvl: 'level', works: 'works', share: 0.4, icon: '🛢' },
  cond: { name: 'Conditionnement', what: 'lignes', lvl: 'levelC', works: 'worksC', share: 0.6, icon: '🏭' },
};
const zoneOf = (kind) => (kind === 'line' ? 'cond' : 'fab');
const facLevel = (f, z = 'fab') => f[ZONES[z].lvl] || 1;
const levelDef = (f, z = 'fab') => FACTORY_LEVELS[facLevel(f, z) - 1];
const zoneCost = (N, z) => Math.round(N.cost * ZONES[z].share / 1000) * 1000;
const zoneFixed = (L, z) => Math.round(L.fixed * ZONES[z].share);
const capOf = (f, kind) => levelDef(f, zoneOf(kind))[{ station: 'st', tank: 'tk', line: 'ln' }[kind]];
const countOf = (f, kind) => (kind === 'line' ? f.lines.length : (f[EQUIP[kind].key] || []).length);
const inWorks = (f, z = 'cond') => !!f[ZONES[z].works];
const lineTier = (l) => EQUIP.line.tiers[l.tier || 0];
// Durée de cuve d'un OF dans une cuve donnée : nombre de lots × durée d'un lot (plus longue dans une grosse cuve)
const mixTime = (of, tier) => { const t = EQUIP.tank.tiers[tier]; const P = PROCESS[of.sku]; return Math.ceil(of.qty / (P.batch * t.mult)) * Math.ceil(P.cuve * t.time); };
const weighTime = (of, tier) => Math.max(2, Math.ceil(of.qty / (PROCESS[of.sku].weigh * EQUIP.station.tiers[tier].mult)));
const busyIdx = (f, stage, field) => new Set(f.queue.filter((o) => o.stage === stage).map((o) => o[field]));
const FACTORY_STORAGE_COST = 25000;
const CONTRACT_SIGN_COST = 60000;
const MIN_ORDER_PALLETS = 5;
const MAX_ORDER_PALLETS = 1000;
const ORDER_STEP = 5;
const CHANGEOVER_TICKS = 20; // ligne standard ; plus long sur les grosses lignes (EQUIP.line)
const CHANGEOVER_COST = 1500;
const MAINTENANCE_TICKS = 10;
const MAINTENANCE_COST = 4000;
const REPAIR_COST = 3000;
const TECH_MAINT_COST = 1000;
const WEAR_PER_TICK = 0.25;
const MAX_SPEED_LOSS = 0.25;
const BASE_REJECT_RATE = 0.02;
const REJECT_PER_WEAR = 0.0004;
const BASE_BREAKDOWN_RATE = 0.001;
const BREAKDOWN_PER_WEAR = 0.0002;

/* --- Transport primaire : usine -> centrale --- */
const TRUCK_MAX_PALLETS = 33;   // un semi-remorque européen = 33 palettes
const TRUCK_COST = 900;         // prix fixe du camion, plein ou vide
const TRUCK_TRANSIT = 20;
const TRUCK_CO2 = 250;           // kg de CO₂ par trajet, plein ou vide

/* --- Centrale logistique --- */
const DC_POSTS = {
  recv:    { name: 'Réception',   icon: '📥', rate: 0.5,  unit: 'pal.',    feature: 'recv',    job: 'déchargent et contrôlent les palettes à quai (2 par camion au plus)' },
  putaway: { name: 'Rangement',   icon: '🏗', rate: 0.35, unit: 'pal.',    feature: 'putaway', job: 'rangent les palettes de la zone de réception dans les racks' },
  pick:    { name: 'Préparation', icon: '🧺', rate: 0.25, unit: 'cartons', feature: 'pick',    job: 'prélèvent les cartons et filment les palettes : une mission par palette de commande, un préparateur par mission' },
  load:    { name: 'Chargement',  icon: '🚛', rate: 0.5,  unit: 'pal.',    feature: 'load',    job: 'chargent les commandes prêtes dans les camions (2 par camion au plus)' },
};
const POSTS = Object.keys(DC_POSTS);
const DC_UPGRADES = {
  SCANNER:   { name: 'Scanners code-barres',       icon: '📟', cost: 30000,  post: 'recv',    mult: 1.4, desc: "On scanne l'étiquette SSCC de chaque palette au lieu de compter à la main : +40 % en réception." },
  RETRACT:   { name: 'Chariots à mât rétractable', icon: '🏗', cost: 60000,  post: 'putaway', mult: 1.5, desc: 'Ils montent plus haut et plus vite dans les allées étroites : +50 % en rangement.' },
  PICKLIGHT: { name: 'Pick-to-light',              icon: '💡', cost: 80000,  post: 'pick',    mult: 1.6, desc: "Un voyant s'allume sur l'emplacement à prélever : +60 % en préparation, moins d'erreurs." },
  FULLPAL:   { name: 'Flux palettes complètes',    icon: '🟦', cost: 60000,  post: null,      mult: 1,   desc: "Quand une commande demande une palette entière d'une référence, un cariste la sort directement du rack au lieu de la reconstituer carton par carton : ces missions vont 8 fois plus vite. Effet sur les commandes lancées après l'installation." },
  LEVELER:   { name: 'Niveleurs de quai',          icon: '🛗', cost: 40000,  post: 'load',    mult: 1.4, desc: 'Le transpalette passe de plain-pied dans la remorque : +40 % au chargement.' },
  BACKUP:    { name: 'Serveur de secours (PRA)',   icon: '🧯', cost: 50000,  post: null,      mult: 1,   desc: "Plan de reprise d'activité : en cas de panne informatique, on bascule sur le serveur de secours. Les pannes système durent 3 fois moins longtemps." },
  SECURITY:  { name: 'Transport sécurisé',         icon: '🛰', cost: 45000,  post: null,      mult: 1,   desc: 'Traceurs GPS sur les remorques, parkings gardés, transporteurs certifiés : 75 % des tentatives de vol échouent.' },
  WMS:       { name: "WMS (logiciel d'entrepôt)",  icon: '🖥', cost: 90000,  post: null,      mult: 1,   desc: "Le WMS lance seul les commandes en préparation, par date de livraison, dès que le stock est là (ou en partiel si l'échéance approche)." },
};
/* Amélioration continue : un chantier par poste à la fois, +12 % de débit par niveau (5 niveaux).
   Pendant le chantier (2 h de jeu), l'équipe du poste est mobilisée en partie : -20 % de débit. */
const KAIZEN_COST = 8000;
const KAIZEN_TICKS = 120;
const KAIZEN_GAIN = 0.12;
const KAIZEN_MAX = 5;
const KAIZEN_TOPICS = {
  recv:    ['Prise de rendez-vous transporteurs', 'Contrôle par échantillonnage', 'Étiquetage SSCC à la source', 'Réception sans papier', 'Quais spécialisés par usine'],
  putaway: ['5S dans les allées', 'Adressage dynamique', 'Rangement en double cycle', 'Plan de circulation des chariots', 'Classement ABC des emplacements'],
  pick:    ['Chemin de préparation optimisé', 'Produits A près des quais', 'Préparation par vagues', 'Standard de filmage', 'Polyvalence des préparateurs'],
  load:    ['Plan de chargement standard', 'Pré-staging par quai', 'Check-list départ camion', 'Chargement double profondeur', 'Rendez-vous transporteurs'],
};
const BUFFER_BASE = 24;         // (ancien système, gardé pour les vieilles sauvegardes)
const BUFFER_STEP = 8;
const BUFFER_COST = 12000;
const RECV_ZONE_PER_DOCK = 50;  // chaque quai de réception a sa zone au sol de 50 palettes, non agrandissable
const bufferCap = (dc) => RECV_ZONE_PER_DOCK * dc.recvDocks;
// Remplissage de la zone au sol de chaque quai (les palettes y attendent le rangement)
const zoneFillOf = (dc) => { const z = Array.isArray(dc.zoneFill) ? dc.zoneFill.slice(0, dc.recvDocks) : []; while (z.length < dc.recvDocks) z.push(0); return z; };
const DOCK_COST = 35000;
// Racks et cellules de la centrale : voir src/domain/dc/storage.js
const YARD_FREE_TICKS = 30;     // au-delà, un camion qui attend dans la cour coûte des frais d'immobilisation
const DEMURRAGE = 5;            // € par tick et par camion
const PICK_ALLOW = 420;          // un poste de 7 h pour préparer une commande
const LOAD_ALLOW = 90;           // 1 h 30 pour la charger
const PREP_ALLOW = PICK_ALLOW + LOAD_ALLOW; // délai total laissé à la centrale

/* --- Filiales : chaque filiale vend sur son marché et commande à la centrale ---
   size = taille du marché · price = niveau de prix local · mix = appétence par catégorie
   modes = transports possibles depuis la centrale (time en ticks, cost en € par palette) */
const FILIALE_DEFS = {
  FR: { name: 'France', city: 'Paris', flag: '🇫🇷', unlockCost: 0, size: 1.0, price: 1.0, posCost: 20000,
        mix: { PARFUM: 1.0, SKINCARE: 0.9, MAKEUP: 1.0, PRESTIGE: 1.0 }, modes: { road: { time: 120, cost: 90, co2: 40 } },
        blurb: 'Le marché historique : grands magasins parisiens et parfumeries sélectives. Livré en camion depuis la centrale.' },
  DE: { name: 'Allemagne', city: 'Düsseldorf', flag: '🇩🇪', unlockCost: 60000, size: 1.1, price: 1.0, posCost: 25000,
        mix: { PARFUM: 0.9, SKINCARE: 1.1, MAKEUP: 0.9, PRESTIGE: 0.7 }, modes: { road: { time: 300, cost: 140, co2: 60 } },
        blurb: 'Grand marché des parfumeries de chaîne. Livraison routière, un peu plus longue.' },
  US: { name: 'États-Unis', city: 'New York', flag: '🇺🇸', unlockCost: 180000, size: 1.8, price: 1.15, posCost: 45000,
        defaultMode: 'air', mix: { PARFUM: 1.0, SKINCARE: 0.9, MAKEUP: 1.3, PRESTIGE: 1.0 }, modes: { sea: { time: 1152, cost: 220, co2: 35 }, air: { time: 288, cost: 1200, co2: 1400 } },
        blurb: 'Énorme marché, très fort en maquillage. Il faut choisir entre bateau (lent, bon marché) et avion (rapide, cher).' },
  AE: { name: 'Travel Retail', city: 'Dubaï', flag: '🇦🇪', unlockCost: 220000, size: 1.2, price: 1.1, posCost: 40000,
        defaultMode: 'air', mix: { PARFUM: 1.6, SKINCARE: 0.8, MAKEUP: 0.8, PRESTIGE: 1.8 }, modes: { sea: { time: 960, cost: 240, co2: 30 }, air: { time: 240, cost: 1000, co2: 1100 } },
        blurb: "Boutiques duty free des aéroports : le royaume du parfum, avec des voyageurs du monde entier." },
  CN: { name: 'Chine', city: 'Shanghai', flag: '🇨🇳', unlockCost: 300000, size: 2.2, price: 1.25, posCost: 60000,
        defaultMode: 'air', mix: { PARFUM: 0.7, SKINCARE: 1.5, MAKEUP: 1.0, PRESTIGE: 1.3 }, modes: { sea: { time: 1440, cost: 260, co2: 45 }, air: { time: 384, cost: 1400, co2: 1700 } },
        blurb: 'Premier marché de croissance du luxe, porté par le soin. Long trajet et formalités douanières.' },
  ES: { name: 'Espagne', city: 'Madrid', flag: '🇪🇸', unlockCost: 80000, size: 0.8, price: 1.0, posCost: 25000,
        mix: { PARFUM: 1.3, SKINCARE: 0.8, MAKEUP: 0.9, PRESTIGE: 0.8 }, modes: { road: { time: 420, cost: 150, co2: 70 } },
        blurb: "Un pays de parfum, où les grands magasins pèsent lourd. Livré en camion par Bordeaux et le Pays basque." },
  UK: { name: 'Royaume-Uni', city: 'Londres', flag: '🇬🇧', unlockCost: 120000, size: 1.2, price: 1.05, posCost: 35000,
        mix: { PARFUM: 1.2, SKINCARE: 0.9, MAKEUP: 1.1, PRESTIGE: 1.2 }, modes: { road: { time: 360, cost: 170, co2: 60 } },
        blurb: "Camion par le tunnel sous la Manche. Depuis le Brexit, il faut une déclaration en douane pour chaque envoi : le trajet est plus long qu'il n'y paraît." },
  IT: { name: 'Italie', city: 'Milan', flag: '🇮🇹', unlockCost: 100000, size: 0.9, price: 1.0, posCost: 28000,
        mix: { PARFUM: 1.1, SKINCARE: 1.0, MAKEUP: 1.1, PRESTIGE: 1.1 }, modes: { road: { time: 360, cost: 155, co2: 65 } },
        blurb: 'Marché exigeant et très attaché aux maisons de luxe. Les camions passent les Alpes par le tunnel du Mont-Blanc.' },
  BR: { name: 'Brésil', city: 'São Paulo', flag: '🇧🇷', unlockCost: 200000, size: 1.3, price: 1.2, posCost: 45000,
        defaultMode: 'air', mix: { PARFUM: 1.5, SKINCARE: 0.8, MAKEUP: 1.0, PRESTIGE: 0.6 }, modes: { sea: { time: 1440, cost: 260, co2: 45 }, air: { time: 336, cost: 1400, co2: 1600 } },
        blurb: "L'un des plus grands marchés du parfum au monde. Droits d'importation élevés et enregistrement sanitaire obligatoire avant la vente." },
  ZA: { name: 'Afrique du Sud', city: 'Johannesburg', flag: '🇿🇦', unlockCost: 180000, size: 0.6, price: 1.1, posCost: 35000,
        defaultMode: 'sea', mix: { PARFUM: 1.3, SKINCARE: 0.9, MAKEUP: 1.0, PRESTIGE: 0.7 }, modes: { sea: { time: 1520, cost: 250, co2: 45 }, air: { time: 384, cost: 1400, co2: 1700 } },
        blurb: "La porte d'entrée de l'Afrique australe. Les conteneurs arrivent à Durban puis montent en camion jusqu'à Johannesburg." },
  KR: { name: 'Corée du Sud', city: 'Séoul', flag: '🇰🇷', unlockCost: 250000, size: 1.0, price: 1.25, posCost: 50000,
        defaultMode: 'air', mix: { PARFUM: 0.6, SKINCARE: 1.8, MAKEUP: 1.2, PRESTIGE: 0.9 }, modes: { sea: { time: 1680, cost: 280, co2: 50 }, air: { time: 432, cost: 1600, co2: 2000 } },
        blurb: 'Le pays de la K-beauty : des clientes très expertes en soin, qui suivent les nouveautés de près.' },
  JP: { name: 'Japon', city: 'Tokyo', flag: '🇯🇵', unlockCost: 320000, size: 1.4, price: 1.3, posCost: 60000,
        defaultMode: 'air', mix: { PARFUM: 0.5, SKINCARE: 1.7, MAKEUP: 1.1, PRESTIGE: 1.0 }, modes: { sea: { time: 1760, cost: 290, co2: 55 }, air: { time: 432, cost: 1700, co2: 2100 } },
        blurb: "Le marché le plus exigeant sur la qualité : un étui abîmé ou une étiquette de travers et le carton est refusé." },
  SG: { name: 'Singapour', city: 'Singapour', flag: '🇸🇬', unlockCost: 200000, size: 0.7, price: 1.15, posCost: 40000,
        defaultMode: 'air', mix: { PARFUM: 1.3, SKINCARE: 1.2, MAKEUP: 0.9, PRESTIGE: 1.4 }, modes: { sea: { time: 1360, cost: 250, co2: 40 }, air: { time: 384, cost: 1400, co2: 1700 } },
        blurb: "Hub de l'Asie du Sud-Est et grand aéroport de travel retail. Un relais pour toute la région." },
  AU: { name: 'Australie', city: 'Sydney', flag: '🇦🇺', unlockCost: 280000, size: 0.8, price: 1.25, posCost: 45000,
        defaultMode: 'air', mix: { PARFUM: 1.1, SKINCARE: 1.2, MAKEUP: 1.0, PRESTIGE: 0.8 }, modes: { sea: { time: 2080, cost: 320, co2: 60 }, air: { time: 480, cost: 1800, co2: 2300 } },
        blurb: "Au bout du monde : le trajet le plus long du réseau, et des saisons inversées (Noël tombe en plein été)." },
};
const MODE_LABELS = { road: '🚚 Route', sea: '🚢 Maritime', air: '✈️ Aérien' };
const BASE_DEMAND = { PARF_50: 2.0, PARF_100: 0.8, SKIN_CREME: 1.4, SKIN_SERUM: 1.0, MK_FOND: 1.0, MK_ROUGE: 1.6, PRES_EXTRAIT: 0.25, PRES_100: 0.15,
  PARF_BOISE: 1.0, PARF_FLORAL: 1.0, PARF_EDT: 1.1, PARF_FRAIS: 1.0, SKIN_HYDRA: 1.2, SKIN_REPAR: 0.4, SKIN_EXFO: 0.8, MK_ENCRE: 1.2, MK_MASCARA: 1.3, MK_HALO: 0.9, PRES_AMBRE: 0.15 }; // unités / tick pour un marché de taille 1
const REVIEW_PERIOD = 60;       // une filiale revoit ses besoins toutes les 60 s
const HOLDING_COST = 0.01;      // coût de possession du stock filiale, par unité et par tick
const SVC_DECAY = 0.995;        // mémoire du taux de service (≈ 200 dernières secondes)

/* --- Événements (chapitre 4) --- */
const EVENT_DEFS = {
  VIRAL:   { icon: '📱', title: 'Produit viral sur les réseaux', duration: 240, lead: 0 },
  FESTIVE: { icon: '🎄', title: 'Pic des fêtes de fin d\'année', duration: 500, lead: 150 },
  PORT:    { icon: '⚓', title: 'Grève portuaire', duration: 400, lead: 0 },
  GLASS:   { icon: '🍾', title: 'Pénurie de verre', duration: 400, lead: 0 },
  TRAFFIC: { icon: '🛫', title: 'Chute du trafic aérien', duration: 400, lead: 0 },
  OUTAGE:  { icon: '💻', title: 'Panne du système informatique', duration: 150, lead: 0 },
  THEFT:   { icon: '🚨', title: 'Camion braqué', duration: 1, lead: 0 },
};

/* ============================================================
   PROGRESSION : fonctionnalités et objectifs
   ============================================================ */
const CHAPTERS = { 1: "L'atelier", 2: 'La centrale', 3: "L'essor", 4: 'Le grand large', 5: 'Le tour du monde' };
const FEATURE_INFO = {
  exp:              ['🚛', 'Expédition usine', "Envoyez les palettes produites vers la centrale logistique."],
  centrale:         ['🏢', 'Centrale logistique', "Le nouvel onglet où arrivent les camions de l'usine."],
  globe:            ['🌐', 'Globe des transports', 'Suivez en direct vos camions, bateaux et avions sur un globe 3D, avec les sites placés sur la carte.'],
  recv:             ['📥', 'Poste Réception', 'Vos équipiers déchargent et contrôlent les camions à quai.'],
  putaway:          ['🏗', 'Poste Rangement', 'Les palettes contrôlées sont rangées dans les racks.'],
  appro:            ['📦', 'Achats & appro usine', 'Vos stocks de départ baissent : commandez matières et composants.'],
  fil_FR:           ['🇫🇷', 'Filiale France', 'Votre premier client interne : elle vend en France et vous commande.'],
  pick:             ['🧺', 'Poste Préparation', 'Les cartons des commandes filiales sont prélevés dans les racks.'],
  load:             ['🚛', 'Poste Chargement', 'Les commandes préparées partent en camion vers les filiales.'],
  techs:            ['🔧', 'Techniciens de maintenance', 'Ils réparent plus vite et font la maintenance préventive.'],
  navette:          ['🔁', 'Navette automatique', "Le camion usine → centrale part tout seul dès qu'il est assez rempli."],
  dashboard:        ['📊', 'Tableau de bord', 'Vos indicateurs clés : CA, résultat, OTIF, taux de service.'],
  kaizen:           ['🔁', 'Amélioration continue', 'Des chantiers terrain qui augmentent durablement le débit de chaque poste.'],
  buyers:           ['🛒', 'Acheteurs', "Ils passent les commandes fournisseurs à votre place."],
  marketing:        ['📢', 'Marketing', 'Désirabilité de vos produits, budget publicité et campagnes ciblées : la demande grimpe… à anticiper.'],
  dc_upgrades:      ['⚙️', 'Équipements de la centrale', 'Scanners, chariots, pick-to-light, WMS.'],
  fil_DE:           ['🇩🇪', 'Filiale Allemagne', 'Un deuxième marché européen à ouvrir.'],
  launch:           ['🧪', 'Développement', 'Votre centre de recherche crée de nouvelles références, une par une : plus de ventes, mais plus d\'OF et de changements de série à gérer.'],
  sop:              ['🧭', 'Module S&OP', 'Les OF se créent seuls à partir de la demande prévue des filiales et du stock du réseau.'],
  aps:              ['🤖', 'Planification automatique', 'Les OF s\'enchaînent seuls à l\'usine.'],
  contract:         ['📝', "Contrat d'appro", 'Un fournisseur vous livre tout un kit à intervalle régulier.'],
  factory_SKINCARE: ['🧴', 'Usine Skincare', 'Une deuxième catégorie : crème et sérum.'],
  fil_US:           ['🇺🇸', 'Filiale États-Unis', 'Le grand export : bateau ou avion ?'],
  events:           ['⚡', 'Aléas du monde réel', 'Pannes informatiques, camions braqués, grèves, pénuries, buzz : la supply chain doit encaisser.'],
  factory_MAKEUP:   ['💄', 'Usine Maquillage', 'Fond de teint et rouge à lèvres.'],
  fil_AE:           ['🇦🇪', 'Travel Retail Dubaï', 'Les boutiques duty free, reines du parfum.'],
  fil_CN:           ['🇨🇳', 'Filiale Chine', 'Le premier marché de croissance du luxe.'],
  fil_ES:           ['🇪🇸', 'Filiale Espagne', 'Un pays de parfum, livré en camion.'],
  fil_UK:           ['🇬🇧', 'Filiale Royaume-Uni', 'Le tunnel sous la Manche et la douane du Brexit.'],
  fil_IT:           ['🇮🇹', 'Filiale Italie', 'Par le tunnel du Mont-Blanc.'],
  fil_BR:           ['🇧🇷', 'Filiale Brésil', 'Un géant du parfum, de l\'autre côté de l\'Atlantique.'],
  fil_KR:           ['🇰🇷', 'Filiale Corée du Sud', 'Le pays de la K-beauty.'],
  fil_JP:           ['🇯🇵', 'Filiale Japon', 'Le marché le plus exigeant sur la qualité.'],
  fil_SG:           ['🇸🇬', 'Filiale Singapour', "Le hub de l'Asie du Sud-Est."],
  fil_ZA:           ['🇿🇦', 'Filiale Afrique du Sud', "La porte de l'Afrique australe."],
  fil_AU:           ['🇦🇺', 'Filiale Australie', 'Le bout du monde.'],
  factory_PRESTIGE: ['💎', "Usine Parfums d'exception", 'Extraits et éditions rares, en petites séries, vendus très cher.'],
};

const MILESTONES = [
  { id: 'first_of', chapter: 1, title: 'Votre premier ordre de fabrication',
    goal: `Un OF de ${PRODUCT_SPECS.PARF_50.name} est déjà au planning. Lancez ses 4 étapes une par une : kit d'appro, pesée, cuve, puis ligne.`,
    progress: (s) => [s.stats.ofDone, 1], check: (s) => s.stats.ofDone >= 1, reward: 10000, unlocks: ['exp'],
    lesson: ["L'ordre de fabrication (OF)", "Dans une usine cosmétique, rien ne se fabrique sans OF. Il fixe la référence et la quantité, puis déclenche une chaîne : le magasin prépare le kit de matières et de composants, on pèse les matières premières, on fabrique le « vrac » (le jus du parfum) en cuve, et la ligne de conditionnement remplit, bouche et met en étui. Changer de référence sur une ligne impose un nettoyage et des réglages : c'est pourquoi on regroupe les OF d'une même référence."] },
  { id: 'first_truck', chapter: 1, title: 'Premier départ usine',
    goal: "Dans Usine › Expédition, envoyez un camion de palettes vers la centrale logistique.",
    progress: (s) => [s.stats.trucksSent, 1], check: (s) => s.stats.trucksSent >= 1, reward: 5000, unlocks: ['centrale', 'recv', 'globe'],
    lesson: ['Le transport primaire', "Le trajet usine → entrepôt central s'appelle le transport primaire. Un semi-remorque européen porte 33 palettes et coûte presque le même prix plein ou à moitié vide : le taux de remplissage des camions est un indicateur suivi de près. Attendre d'avoir un camion bien rempli fait baisser le coût par palette, mais retarde l'arrivée du stock."] },
  { id: 'first_recv', chapter: 2, title: 'La réception',
    goal: "Votre camion arrive à la centrale. Vos équipiers du poste Réception vont le décharger : attendez qu'il soit vidé.",
    progress: (s) => [s.stats.trucksReceived, 1], check: (s) => s.stats.trucksReceived >= 1, reward: 8000, unlocks: ['putaway', 'appro'],
    lesson: ['Réceptionner, ce n\'est pas juste décharger', "À quai, on décharge, on compte et on contrôle : le nombre de palettes doit correspondre à l'avis d'expédition (ASN) envoyé par l'usine, et chaque palette porte une étiquette SSCC qu'on scanne. Tant que ce contrôle n'est pas fait, le stock n'existe pas dans le système. Un camion qui attend trop longtemps dans la cour se paie : ce sont les frais d'immobilisation."] },
  { id: 'putaway', chapter: 2, title: 'Le rangement',
    goal: "Rangez 10 palettes dans les racks. Affectez au moins un équipier au poste Rangement (onglet Centrale).",
    progress: (s) => [s.stats.palletsPutaway, 10], check: (s) => s.stats.palletsPutaway >= 10, reward: 10000, unlocks: ['fil_FR', 'pick', 'load'],
    lesson: ['Le rangement', "Après contrôle, les palettes attendent au sol dans la zone de réception. Les caristes les rangent ensuite dans les racks, à une adresse précise : allée, colonne, niveau. Si la zone de réception déborde, toute la réception s'arrête : le rangement doit suivre le rythme des quais. C'est une règle d'or de l'entrepôt : le débit est celui du poste le plus lent."] },
  { id: 'first_delivery', chapter: 2, title: 'Première commande filiale',
    goal: "La filiale France vous a passé commande. Dans Centrale › Préparation, lancez-la, puis laissez-la se charger et partir. Pensez à recruter des équipiers pour la préparation et le chargement.",
    progress: (s) => [s.stats.ordersDelivered, 1], check: (s) => s.stats.ordersDelivered >= 1, reward: 15000, unlocks: ['techs', 'navette', 'dashboard', 'kaizen'],
    lesson: ['Ce qu\'est une filiale', "Une filiale est la société de la maison dans un pays. Elle ne fabrique rien : elle achète les produits à la centrale, les garde dans son entrepôt local et les vend aux distributeurs de son pays (grands magasins, parfumeries, duty free). Pour éviter les ruptures, elle commande régulièrement : elle compare son stock, plus ce qui est déjà en route, à un stock cible exprimé en durée de couverture. Vous pouvez régler cette couverture dans l'onglet Filiales."] },
  { id: 'otif5', chapter: 3, title: "À l'heure et complet",
    goal: "Livrez 5 commandes OTIF : arrivées avant l'échéance ET complètes.",
    progress: (s) => [s.stats.otif, 5], check: (s) => s.stats.otif >= 5, reward: 20000, unlocks: ['launch', 'buyers', 'marketing', 'dc_upgrades'],
    lesson: ["L'OTIF, juge de paix", `L'OTIF (On Time In Full) mesure la part des commandes livrées à l'heure et complètes. C'est l'indicateur qui lie la centrale à ses filiales. Une commande partielle ou en retard crée des ruptures en point de vente, et en luxe une rupture se paie deux fois : la vente perdue et l'image de la marque. Ici, une filiale mal servie perd en satisfaction et ses ventes baissent. Nouveau : l'onglet Développement, pour créer ${PRODUCT_SPECS.PARF_100.name} puis toute une gamme.`] },
  { id: 'ca', chapter: 3, title: 'Une maison qui décolle',
    goal: "Atteignez 150 000 € de chiffre d'affaires cumulé dans vos filiales.",
    progress: (s) => [Math.floor(s.stats.revenue), 150000], check: (s) => s.stats.revenue >= 150000, reward: 25000, unlocks: ['fil_DE', 'fil_ES', 'fil_IT', 'sop', 'aps', 'contract', 'factory_SKINCARE'],
    lesson: ['Le S&OP', "Avec plus de volume vient le S&OP (Sales & Operations Planning) : chaque mois, ventes, marketing et supply chain alignent prévisions et capacités. Ici, une campagne marketing non anticipée vide les stocks des filiales avant que la centrale ait pu réagir. Le bon réflexe : augmenter la couverture des filiales et produire en avance avant le démarrage. Le module S&OP fait la même chose pour l'usine : il crée les OF à partir de la demande prévue et du stock de tout le réseau."] },
  { id: 'skincare', chapter: 4, title: 'Deuxième catégorie',
    goal: "Construisez l'usine Skincare et livrez à une filiale une commande contenant un produit de soin.",
    progress: (s) => [s.stats.skinDelivered, 1], check: (s) => s.stats.skinDelivered >= 1, reward: 30000, unlocks: ['fil_UK', 'fil_US', 'events'],
    lesson: ['Chaque marché a son profil', "Le soin domine en Asie, le parfum en travel retail, le maquillage aux États-Unis. Plus de références signifie des commandes multi-produits, plus de lignes à préparer, et des palettes « mixtes » à composer à la centrale. Attention aussi au monde réel : pannes du système informatique, vols de camions, grèves, pénuries et buzz arrivent désormais sans prévenir. Une bonne supply chain n'est pas celle qui n'a jamais de problème, c'est celle qui s'en remet vite."] },
  { id: 'us', chapter: 4, title: "Traverser l'Atlantique",
    goal: "Ouvrez la filiale États-Unis et livrez-lui une commande.",
    progress: (s) => [s.filiales.US.delivered, 1], check: (s) => s.filiales.US.delivered >= 1, reward: 40000, unlocks: ['factory_MAKEUP', 'fil_AE'],
    lesson: ['Bateau ou avion ?', "Pour le grand export, on choisit entre le maritime (lent et bon marché : 4 à 6 semaines en réalité) et l'aérien (rapide mais 5 à 10 fois plus cher). Plus le délai est long, plus la filiale doit garder de couverture de stock, donc d'argent immobilisé. On utilise souvent le bateau pour le réassort courant et l'avion pour les lancements et les urgences."] },
  { id: 'makeup', chapter: 5, title: 'Une maison complète',
    goal: "Construisez l'usine Maquillage.",
    progress: (s) => [s.factories.MAKEUP.unlocked ? 1 : 0, 1], check: (s) => s.factories.MAKEUP.unlocked, reward: 50000, unlocks: ['fil_CN', 'fil_BR'],
    lesson: ['Le grand export', "La Chine impose l'enregistrement des cosmétiques auprès des autorités avant toute vente, et le passage en douane allonge les délais. Le travel retail (aéroports, Dubaï) est un canal à part entière pour le luxe, très porté sur le parfum, avec ses propres règles de prix et d'approvisionnement."] },
  { id: 'green', chapter: 5, title: 'Moins d\'avion',
    goal: "À partir de maintenant, expédiez 80 palettes vers le grand export (États-Unis, Dubaï, Chine) avec moins de 25 % en avion. Passez au bateau et augmentez les couvertures.",
    progress: (s) => [s.stats.greenSea + s.stats.greenAir, 80],
    check: (s) => s.stats.greenSea + s.stats.greenAir >= 80 && s.stats.greenAir / (s.stats.greenSea + s.stats.greenAir) < 0.25, reward: 60000, unlocks: ['factory_PRESTIGE', 'fil_KR', 'fil_JP', 'fil_SG', 'fil_ZA'],
    lesson: ['Le fret aérien, premier poste carbone', "Une palette en avion émet 30 à 50 fois plus de CO₂ qu'en bateau. Les grandes maisons de beauté se sont fixé des objectifs chiffrés de réduction du fret aérien, remplacé par le maritime et le transport intermodal. Pour y arriver, il faut des prévisions fiables et plus de couverture en filiale : l'avion ne doit servir qu'aux vraies urgences. Le remplissage des camions compte aussi : un camion à moitié vide émet autant qu'un camion plein. Nouveau : une usine de parfums d'exception, pour des extraits fabriqués en petites séries et vendus très cher, surtout en travel retail."] },
  { id: 'world', chapter: 5, title: 'Supply chain mondiale',
    goal: "Avec au moins 4 filiales ouvertes, tenez un taux de service ≥ 95 % et un OTIF ≥ 90 % dans chacune pendant 10 minutes d'affilée.",
    progress: (s) => [s.stats.excellence, 600], check: (s) => s.stats.excellence >= 600, reward: 100000, unlocks: ['fil_AU'],
    lesson: ['Directeur Supply Chain Monde', "Bravo : vous pilotez une chaîne complète, de la matière première au point de vente, sur plusieurs continents. Dans la vraie vie, le métier continue avec la prévision de la demande, la gestion des lancements, la durabilité (moins d'avion, des camions mieux remplis) et l'arbitrage permanent entre service, coût et stock. La partie continue : à vous d'optimiser !"] },
];

/* ============================================================
   CALCULS
   ============================================================ */
const unitsPerPallet = (sku) => PRODUCT_SPECS[sku].cartonsPerPallet * PRODUCT_SPECS[sku].unitsPerCarton;
const getStockDisplay = (sku, totalUnits) => {
  const specs = PRODUCT_SPECS[sku];
  const upp = unitsPerPallet(sku);
  const remaining = totalUnits % upp;
  return { pallets: Math.floor(totalUnits / upp), cartons: Math.floor(remaining / specs.unitsPerCarton), units: remaining % specs.unitsPerCarton };
};
const bomOf = (sku) => {
  const p = PRODUCT_SPECS[sku];
  return { ...p.comps, [FACTORY_DEFS[p.factory].carton]: 1 / p.unitsPerCarton, PALETTE: 1 / unitsPerPallet(sku) };
};
const rawCostOf = (fid) => Object.entries(FACTORY_DEFS[fid].raw).reduce((a, [c, q]) => a + COMPONENTS[c].cost * q, 0);
const unitCost = (sku) =>
  rawCostOf(PRODUCT_SPECS[sku].factory) + Object.entries(bomOf(sku)).reduce((a, [c, q]) => a + COMPONENTS[c].cost * q, 0);

const contractKit = (fid, qty, s) => {
  const def = FACTORY_DEFS[fid];
  const kit = {};
  const add = (c, n) => { kit[c] = (kit[c] || 0) + n; };
  // Le contrat ne couvre que les références lancées (sinon on achète des flacons de produits qui n'existent pas encore)
  const live = s ? def.skus.filter((k) => s.launched[k]) : [];
  const skus = live.length ? live : def.skus;
  Object.entries(def.raw).forEach(([c, q]) => add(c, q * qty));
  skus.forEach((sku) => Object.entries(bomOf(sku)).forEach(([c, q]) => add(c, (q * qty) / skus.length)));
  Object.keys(kit).forEach((c) => { kit[c] = Math.ceil(kit[c]); });
  return kit;
};
const kitTotalCost = (kit) => Object.entries(kit).reduce((a, [c, n]) => a + COMPONENTS[c].cost * n, 0);

const activeSkus = (s) => SKUS.filter((k) => s.factories[PRODUCT_SPECS[k].factory].unlocked && s.launched[k]);
const skuTip = (sku) => { const p = PRODUCT_SPECS[sku]; const t = PROCESS[sku]; return `${p.name} · pesée ${t.weigh} u/min · cuve : lots de ${t.batch} u en ${t.cuve} min · ligne ${p.baseRate} u/min · ${p.unitsPerCarton} u/carton, ${p.cartonsPerPallet} cartons/palette · prix ${p.sellingPricePerUnit} €`; };
const pendingOf = (s, c) => s.purchaseOrders.filter((p) => p.comp === c).reduce((sum, p) => sum + p.qty, 0)
  + Object.values(s.factories).reduce((sum, f) => sum + f.dock.filter((d) => d.comp === c).reduce((a, d) => a + d.qty, 0), 0);

const COMP_OWNER = (() => {
  const m = {};
  Object.entries(FACTORY_DEFS).forEach(([fid, d]) => {
    Object.keys(d.raw).forEach((c) => { m[c] = fid; });
    m[d.carton] = fid;
    d.skus.forEach((k) => Object.keys(PRODUCT_SPECS[k].comps).forEach((c) => { m[c] = fid; }));
  });
  return m;
})();
const zoneMult = (f) => 1 + 0.5 * f.zone;
const maxOf = (s, c) => {
  if (c === 'PALETTE') return Math.round(COMPONENTS.PALETTE.max * Math.max(...Object.values(s.factories).filter((f) => f.unlocked).map(zoneMult)));
  return Math.round(COMPONENTS[c].max * zoneMult(s.factories[COMP_OWNER[c]]));
};
const factoryComps = (fid) => {
  const d = FACTORY_DEFS[fid];
  return [...new Set([...Object.keys(d.raw), ...d.skus.flatMap((k) => Object.keys(PRODUCT_SPECS[k].comps)), d.carton, 'PALETTE'])];
};
const countStage = (f, stage) => f.queue.filter((o) => o.stage === stage).length;
const kitNeeds = (fid, sku, qty) => {
  const need = {};
  Object.entries(FACTORY_DEFS[fid].raw).forEach(([c, q]) => { need[c] = Math.ceil(q * qty); });
  Object.entries(bomOf(sku)).forEach(([c, q]) => { need[c] = Math.ceil(q * qty - 1e-6); });
  return need;
};
const maxPalletsFor = (s, fid, sku) => {
  const upp = unitsPerPallet(sku);
  let best = 0;
  for (let p = MIN_ORDER_PALLETS; p <= MAX_ORDER_PALLETS; p += ORDER_STEP) {
    const fits = Object.entries(kitNeeds(fid, sku, p * upp)).every(([c, n]) => n <= maxOf(s, c));
    if (fits) best = p; else break;
  }
  return best;
};
const readyPalletsOf = (s, fid) => FACTORY_DEFS[fid].skus.reduce((a, sku) => a + Math.floor(s.factoryStock[sku].units / unitsPerPallet(sku)), 0);

/* TRS = Disponibilité x Performance x Qualité */
const emptyStats = () => ({ planned: 0, run: 0, theo: 0, made: 0, good: 0 });
const kpiOf = (st) => {
  const dispo = st.planned > 0 ? st.run / st.planned : null;
  const perf = st.theo > 0 ? st.made / st.theo : null;
  const qual = st.made > 0 ? st.good / st.made : null;
  const trs = dispo !== null && perf !== null && qual !== null ? dispo * perf * qual : null;
  return { dispo, perf, qual, trs };
};
const sumStats = (lines) =>
  lines.reduce((a, l) => ({ planned: a.planned + l.stats.planned, run: a.run + l.stats.run, theo: a.theo + l.stats.theo, made: a.made + l.stats.made, good: a.good + l.stats.good }), emptyStats());
const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(0)} %`);
const eur = (n) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const fmtT = (ticks) => (ticks >= 60 ? `${Math.floor(ticks / 60)}h${String(Math.round(ticks % 60)).padStart(2, '0')}` : `${Math.max(0, Math.round(ticks))} min`);

/* --- Centrale --- */
const dcPallets = (dc) => SKUS.reduce((a, k) => a + Math.ceil(dc.stock[k] / unitsPerPallet(k) - 1e-9), 0);
const bufferTotal = (dc) => SKUS.reduce((a, k) => a + dc.buffer[k], 0);
const equipMult = (dc, post) => Object.entries(DC_UPGRADES).reduce((m, [k, u]) => (dc.upgrades[k] && u.post === post ? m * u.mult : m), 1);
const postMult = (dc, post) => equipMult(dc, post)
  * (1 + KAIZEN_GAIN * dc.kaizen[post])
  * (dc.kaizenRun && dc.kaizenRun.post === post ? 0.8 : 1)
  * (dc.outage && (post === 'recv' || post === 'pick') ? 0.35 : 1);
const RECV_PER_TRUCK = 2;        // au plus 2 équipiers déchargent un même camion
// Équipiers réellement utiles à un poste : à la réception, 2 par quai (camion à quai ou quai libre)
/* --- Automatisation de la préparation : un gros projet, puis des robots qui préparent sans salaire --- */
const AUTO_COST = 5000000;
const AUTO_BUILD = 1440;         // 24 h de jeu de travaux
const AUTO_ROBOTS = 10;          // robots livrés avec le projet
const ROBOT_COST = 10000;        // robot supplémentaire
const robotsOf = (dc) => (dc.auto && dc.auto.done ? dc.auto.robots : 0);
const pickTeam = (dc) => dc.assign.pick + robotsOf(dc);
const PER_DOCK = 2;              // préparation et chargement : 2 équipiers au plus par quai d'expédition
const usefulStaff = (dc, post) => (post === 'recv' ? Math.min(dc.assign.recv, RECV_PER_TRUCK * dc.recvDocks)
  : post === 'load' ? Math.min(dc.assign.load, PER_DOCK * dc.shipDocks) : post === 'pick' ? pickTeam(dc) : dc.assign[post]);
const SHIP_ACTIVE = ['packed', 'loading'];
// Préparation : une commande = autant de missions que de palettes à monter ; un préparateur par mission
// Les missions sont fixées au lancement (une par palette) : chaque préparateur monte sa palette en parallèle
// o.mis = travail restant par mission ; o.misK = cartons faits par unité de travail (palette complète : 8 fois plus vite)
const FULLPAL_SPEED = 8;
const missionsOf = (o, dc) => {
  if (!o.mis) {
    if (dc && dc.upgrades.FULLPAL && !o.lines.some((l) => l.picked > 0)) {
      o.mis = []; o.misK = []; let mixed = 0;
      o.lines.forEach((l) => {
        const cpp = PRODUCT_SPECS[l.sku].cartonsPerPallet; const full = Math.floor(l.alloc / cpp + 1e-9);
        for (let i = 0; i < full; i++) { o.mis.push(cpp / FULLPAL_SPEED); o.misK.push(FULLPAL_SPEED); }
        mixed += l.alloc - full * cpp;
      });
      if (mixed > 1e-9) {
        const n = Math.max(1, Math.ceil(o.lines.reduce((a, l) => { const cpp = PRODUCT_SPECS[l.sku].cartonsPerPallet; return a + (l.alloc - Math.floor(l.alloc / cpp + 1e-9) * cpp) / cpp; }, 0) - 1e-9));
        for (let i = 0; i < n; i++) { o.mis.push(mixed / n); o.misK.push(1); }
      }
      if (o.mis.length === 0) { o.mis = [0]; o.misK = [1]; }
    } else {
      const n = palletsEq(o, 'alloc'); const left = o.lines.reduce((a, l) => a + Math.max(0, l.alloc - l.picked), 0);
      o.mis = Array.from({ length: n }, () => left / n);
    }
  }
  return o.mis;
};
const pickMissions = (o) => (o.mis ? o.mis.filter((m) => m > 1e-9).length : palletsEq(o, 'alloc'));
const pickSlots = (dc) => dc.pickSlots ?? 3; // nombre de commandes préparées en même temps, réglé par le joueur
const started = (o) => o.lines.some((l) => l.picked > 0);
// Heure limite de départ d'une commande (échéance - durée du transport) : plus elle est proche, plus c'est urgent
const departBy = (o) => { const ms = FILIALE_DEFS[o.fil].modes; return o.due - (ms[o.mode] || Object.values(ms)[0]).time; };
const byUrgency = (a, b) => departBy(a) - departBy(b);
const pickActive = (dc) => {
  const pk = dc.orders.filter((o) => o.status === 'picking');
  // on finit d'abord ce qui est entamé, puis on démarre les plus urgentes
  return [...pk.filter(started).sort(byUrgency), ...pk.filter((o) => !started(o)).sort(byUrgency)].slice(0, pickSlots(dc));
};
const pickAlloc = (dc) => {
  let free = pickTeam(dc); const out = {};
  const act = [...pickActive(dc)].sort(byUrgency);
  // 1) chaque commande en cours a au moins un préparateur, en commençant par la plus urgente
  act.forEach((o) => { const w = Math.min(1, free); out[o.id] = w; free -= w; });
  // 2) le reste renforce les plus urgentes, jusqu'à un préparateur par palette
  act.forEach((o) => { const w = Math.min(pickMissions(o) - out[o.id], free); if (w > 0) { out[o.id] += w; free -= w; } });
  out.idle = free;
  return out;
};
// Chaque commande lancée est préparée devant un quai d'expédition, puis chargée sur ce même quai
const assignShipDocks = (dc) => {
  dc.orders.forEach((o) => {
    if (!SHIP_ACTIVE.includes(o.status) || (o.dock != null && o.dock < dc.shipDocks)) return;
    const load = Array.from({ length: dc.shipDocks }, (_, i) => dc.orders.filter((x) => x !== o && SHIP_ACTIVE.includes(x.status) && x.dock === i).length);
    o.dock = load.indexOf(Math.min(...load));
  });
};
const postRate = (dc, post) => usefulStaff(dc, post) * DC_POSTS[post].rate * postMult(dc, post);
const assignedTotal = (dc) => POSTS.reduce((a, p) => a + dc.assign[p], 0);
const orderCartons = (o, field = 'req') => o.lines.reduce((a, l) => a + l[field], 0);
const palletsEq = (o, field) => Math.max(1, Math.ceil(o.lines.reduce((a, l) => a + l[field] / PRODUCT_SPECS[l.sku].cartonsPerPallet, 0) - 1e-9));
const availCartons = (s, sku) => Math.floor(s.dc.stock[sku] / PRODUCT_SPECS[sku].unitsPerCarton + 1e-9);

/* --- Filiales --- */
const posMult = (f) => 1 + 0.6 * (f.pos - 1);
const popOf = (f) => 0.7 + 0.5 * f.sat;
const modeOf = (s, id) => FILIALE_DEFS[id].modes[s.filiales[id].mode];
// Split mer / air : le joueur fixe la part des commandes envoyées en avion ; chaque commande garde son mode
const hasSplit = (id) => !!(FILIALE_DEFS[id].modes.sea && FILIALE_DEFS[id].modes.air);
const airPctOf = (f) => f.airPct ?? (f.mode === 'air' ? 100 : 0);
const orderModeKey = (s, o) => o.mode || s.filiales[o.fil].mode;
const orderMode = (s, o) => FILIALE_DEFS[o.fil].modes[orderModeKey(s, o)];
/* Coût d'un envoi vers une filiale = forfait par envoi + prix par palette (calés sur l'ancien prix « cost » par palette).
   Route : un camion se paie surtout au trajet. Mer : le conteneur et le passage portuaire pèsent lourd. Air : on paie surtout au poids. */
const SHIP_SPLIT = { road: { fix: 1.6, var: 0.6 }, sea: { fix: 2.0, var: 0.5 }, air: { fix: 0.6, var: 0.85 } };
const shipFix = (mode, mk) => Math.round(mode.cost * SHIP_SPLIT[mk].fix);
const shipVar = (mode, mk) => Math.round(mode.cost * SHIP_SPLIT[mk].var);
const shipCostOf = (mode, mk, pal) => shipFix(mode, mk) + shipVar(mode, mk) * pal;
const shipPriceTxt = (mode, mk) => `${shipFix(mode, mk)} € + ${shipVar(mode, mk)} €/pal.`;
const ORDER_PERIODS = [60, 120, 240, 480, 720, 1440]; // fréquence de commande d'une filiale
const periodOf = (f) => f.period || REVIEW_PERIOD;
const splitTime = (id, pct) => Math.round((pct * FILIALE_DEFS[id].modes.air.time + (100 - pct) * FILIALE_DEFS[id].modes.sea.time) / 100);
const desOf = (f, sku) => (f.des && f.des[sku] != null ? f.des[sku] : DES0);
const desDemand = (f, sku) => 0.5 + desOf(f, sku) / 100;
const desPrice = (f, sku) => 0.9 + 0.2 * desOf(f, sku) / 100;
const apOf = (f) => (f.ap == null ? AP_DEFAULT : f.ap);
const campActive = (s, c) => s.t >= c.start && s.t < c.end;
// Hausse de demande des campagnes en cours sur cette référence et ce marché
const campaignBoost = (s, id, sku) => s.campaigns.reduce((a, c) => (c.lever && c.sku === sku && c.fils.includes(id) && campActive(s, c) ? a + MKT_LEVERS[c.lever].boost : a), 0);
// Ventes d'une heure de la référence sur ces marchés (hors campagnes) : une campagne coûte un nombre d'heures de ces ventes
const skuHourSales = (s, sku, fils) => fils.reduce((a, id) => a + baseRate(s, id, sku) * 60 * PRODUCT_SPECS[sku].sellingPricePerUnit * FILIALE_DEFS[id].price * desPrice(s.filiales[id], sku), 0);
const campaignCost = (s, lever, sku, fils) => { const L = MKT_LEVERS[lever]; return Math.round(Math.max(L.min * fils.length, L.hours * skuHourSales(s, sku, fils)) / 1000) * 1000; };
const eventActive = (s, key) => s.event && s.event.key === key && s.t >= s.event.start && s.t < s.event.end;
const eventDemandMult = (s, sku, id) => (eventActive(s, 'VIRAL') && s.event.sku === sku ? 4 : 1) * (eventActive(s, 'FESTIVE') ? 1.6 : 1) * (eventActive(s, 'TRAFFIC') && (id === 'AE' || id === 'SG') ? 0.4 : 1);
const baseRate = (s, id, sku) => {
  const d = FILIALE_DEFS[id];
  const f = s.filiales[id];
  return BASE_DEMAND[sku] * d.mix[PRODUCT_SPECS[sku].factory] * d.size * posMult(f) * popOf(f) * desDemand(f, sku);
};
const liveRate = (s, id, sku) => baseRate(s, id, sku) * (1 + campaignBoost(s, id, sku)) * eventDemandMult(s, sku, id);
const svcOf = (f) => (f.svcD > 0.5 ? f.svcS / f.svcD : null);
const otifOf = (f) => (f.otifHist.length ? f.otifHist.filter(Boolean).length / f.otifHist.length : null);
const transitUnits = (s, id, sku) => s.shipments.filter((sh) => sh.fil === id).reduce((a, sh) => a + (sh.lines[sku] || 0), 0);
const openOrderUnits = (s, id, sku) =>
  s.dc.orders.filter((o) => o.fil === id).reduce((a, o) => a + o.lines.filter((l) => l.sku === sku).reduce((b, l) => b + (o.status === 'open' ? l.req : l.alloc) * PRODUCT_SPECS[sku].unitsPerCarton, 0), 0);
const defaultCover = (id, mode) => FILIALE_DEFS[id].modes[mode].time + PREP_ALLOW + 90;

const wageCosts = (s) => Object.values(s.factories).reduce((a, f) => a + (f.unlocked ? f.supplyStaff * SUPPLY_STAFF_COST + f.buyers.length * BUYER_COST + f.techs * TECH_COST : 0), 0) + s.dc.staff * DC_STAFF_COST;
const hourlyCosts = (s) => wageCosts(s) + structureCost(s);

/* ============================================================
   LIGNES DE CONDITIONNEMENT
   ============================================================ */
const makeLine = (id, name, sku) => ({
  id, name, sku, status: 'idle', timeLeft: 0, orderId: null, wear: 0, carry: 0, rejectCarry: 0, stall: null, breakdowns: 0, stats: emptyStats(),
});
const STATUS_LABELS = {
  idle: ["😴 En attente d'un OF", '#8c8372'],
  running: ['▶ En production', '#2f7a57'],
  changeover: ['🔄 Changement de série', '#b8902f'],
  broken: ['🔧 En panne', '#a4262c'],
  maintenance: ['🛠 Maintenance', '#1a1a1a'],
};
const lineStatusOf = (l) => (l.status === 'running' && l.stall ? [`⏳ Bloquée : ${l.stall}`, '#b4531a'] : STATUS_LABELS[l.status]);

/* ============================================================
   ORDRE DE FABRICATION : queued → kitting → kitted → weighing → weighed → mixing → mixed → running → terminé
   ============================================================ */
const newOrder = (id, sku, pallets) => ({
  id, sku, pallets, qty: pallets * unitsPerPallet(sku), produced: 0, made: 0,
  stage: 'queued', timeLeft: 0, maxTime: 0, wait: null, lineId: null,
});
const bestIdleLine = (f, sku) => {
  const idle = f.lines.filter((l) => l.status === 'idle' && !l.orderId);
  return idle.find((l) => l.sku === sku) || idle.find((l) => !l.sku) || idle[0] || null;
};

function tryAdvance(s, fid, f, of, lineId) {
  of.wait = null;
  if (of.stage === 'queued') {
    if (f.supplyStaff - countStage(f, 'kitting') < 1) { of.wait = "agents d'appro tous occupés"; return false; }
    const needs = kitNeeds(fid, of.sku, of.qty);
    const missing = Object.entries(needs).find(([c, n]) => s.components[c] < n);
    if (missing) { of.wait = `il manque ${COMPONENTS[missing[0]].name} (${Math.ceil(missing[1] - s.components[missing[0]])} u)`; return false; }
    Object.entries(needs).forEach(([c, n]) => { s.components[c] = Math.max(0, s.components[c] - n); });
    of.stage = 'kitting';
    of.maxTime = of.timeLeft = Math.max(3, Math.ceil(of.qty / KIT_RATE));
    return true;
  }
  if (of.stage === 'kitted') {
    const busy = busyIdx(f, 'weighing', 'stIdx');
    const free = f.stationT.map((t, i) => i).filter((i) => !busy.has(i));
    if (!free.length) { of.wait = 'postes de pesée tous occupés'; return false; }
    const i = free.reduce((b, k) => (weighTime(of, f.stationT[k]) < weighTime(of, f.stationT[b]) ? k : b), free[0]);
    of.stage = 'weighing'; of.stIdx = i;
    of.maxTime = of.timeLeft = Math.ceil(weighTime(of, f.stationT[i]) / (inWorks(f, 'fab') ? WORKS_SPEED : 1));
    return true;
  }
  if (of.stage === 'weighed') {
    const busy = busyIdx(f, 'mixing', 'tkIdx');
    const free = f.tankT.map((t, i) => i).filter((i) => !busy.has(i));
    if (!free.length) { of.wait = 'cuves toutes occupées'; return false; }
    // la cuve libre qui finit le plus vite (une grosse cuve est lente pour un petit OF)
    const i = free.reduce((b, k) => (mixTime(of, f.tankT[k]) < mixTime(of, f.tankT[b]) ? k : b), free[0]);
    of.stage = 'mixing'; of.tkIdx = i;
    of.maxTime = of.timeLeft = Math.ceil(mixTime(of, f.tankT[i]) / (inWorks(f, 'fab') ? WORKS_SPEED : 1));
    return true;
  }
  if (of.stage === 'mixed') {
    const l = lineId ? f.lines.find((x) => x.id === lineId && x.status === 'idle' && !x.orderId) : bestIdleLine(f, of.sku);
    if (!l) { of.wait = 'aucune ligne libre'; return false; }
    const change = l.sku && l.sku !== of.sku;
    if (change && s.money < CHANGEOVER_COST) { of.wait = 'fonds insuffisants pour le changement de série'; return false; }
    l.orderId = of.id; l.carry = 0; l.rejectCarry = 0; l.stall = null;
    if (change) { book(s, 'usine', -CHANGEOVER_COST); l.status = 'changeover'; l.timeLeft = lineTier(l).change; }
    else { l.sku = of.sku; l.status = 'running'; }
    of.stage = 'running';
    of.lineId = l.id;
    return true;
  }
  return false;
}

function tickLine(s, f, l, notify) {
  if (l.status === 'idle') return;
  const st = l.stats;
  if (l.orderId) st.planned += 1;
  if (l.status === 'broken' || l.status === 'maintenance') {
    l.timeLeft -= l.byTech ? 2 : 1;
    if (l.timeLeft <= 0) { l.status = l.orderId ? 'running' : 'idle'; l.byTech = false; }
    return;
  }
  const o = f.queue.find((x) => x.id === l.orderId);
  if (!o) { l.orderId = null; l.status = 'idle'; return; }
  if (l.status === 'changeover') {
    l.timeLeft -= 1;
    if (l.timeLeft <= 0) { l.sku = o.sku; l.status = 'running'; }
    return;
  }
  const base = PRODUCT_SPECS[o.sku].baseRate * lineTier(l).mult * (inWorks(f, 'cond') ? WORKS_SPEED : 1);
  const speed = 1 - MAX_SPEED_LOSS * (l.wear / 100);
  l.carry = Math.min(l.carry + base * speed, base * 2);
  const want = Math.min(Math.floor(l.carry), o.qty - o.made);
  const fs = s.factoryStock[o.sku];
  const made = Math.max(0, Math.min(want, fs.max - fs.units));
  l.stall = null;
  if (want >= 1 && made === 0) { l.stall = 'stock de sortie saturé'; return; }
  if (made === 0) return;
  l.carry -= made;
  l.rejectCarry += made * (BASE_REJECT_RATE + l.wear * REJECT_PER_WEAR);
  const rejects = Math.min(made, Math.floor(l.rejectCarry));
  l.rejectCarry -= rejects;
  const good = made - rejects;
  // Correctif v5 : les composants des rebuts ont déjà été consommés dans le kit, on ne les paie pas une 2e fois.
  // Le kit est calculé pour "qty" unités : chaque rebut est une unité bonne en moins à la fin de l'OF.
  fs.units += good;
  o.produced += good;
  o.made += made;
  st.run += 1; st.theo += base; st.made += made; st.good += good;
  l.wear = Math.min(100, l.wear + WEAR_PER_TICK);
  if (o.made >= o.qty) {
    s.stats.ofDone += 1;
    notify(`✅ OF terminé sur ${l.name} : ${o.produced} ${PRODUCT_SPECS[o.sku].name} bons (${o.made - o.produced} rebuts)`, 'success');
    f.queue = f.queue.filter((x) => x.id !== o.id);
    l.orderId = null; l.status = 'idle'; l.carry = 0;
    return;
  }
  if (Math.random() < BASE_BREAKDOWN_RATE + l.wear * BREAKDOWN_PER_WEAR) {
    l.status = 'broken';
    l.timeLeft = 15 + Math.floor(Math.random() * 16);
    l.breakdowns += 1;
    l.wear = Math.min(l.wear, 50);
    book(s, 'usine', -REPAIR_COST);
    notify(`🔧 Panne sur ${l.name} ! Réparation : ${l.timeLeft}s (-${eur(REPAIR_COST)})`, 'info');
  }
}

const leadTimeOf = (s, c) => COMPONENTS[c].leadTime * (eventActive(s, 'GLASS') && c.startsWith('FLACON') ? 3 : 1);
const placePO = (s, fid, c, qty) => {
  const lt = leadTimeOf(s, c);
  s.purchaseOrders.push({ id: s.nextId++, fid, comp: c, qty, eta: lt, maxEta: lt });
  s.stats.purchaseOrders += 1;
};

function sendTruck(s, fid) {
  const def = FACTORY_DEFS[fid];
  const lines = {};
  let total = 0;
  def.skus.forEach((sku) => {
    const upp = unitsPerPallet(sku);
    const n = Math.min(Math.floor(s.factoryStock[sku].units / upp), TRUCK_MAX_PALLETS - total);
    if (n > 0) { lines[sku] = n; total += n; s.factoryStock[sku].units -= n * upp; }
  });
  book(s, 'transport', -TRUCK_COST);
  s.transit.push({ id: s.nextId++, fid, lines, pallets: total, eta: TRUCK_TRANSIT, maxEta: TRUCK_TRANSIT });
  s.stats.trucksSent += 1;
  s.stats.co2 += TRUCK_CO2;
  addCarbon(s, TRUCK_CO2, total, false);
  s.stats.truckFill.push(total / TRUCK_MAX_PALLETS);
  if (s.stats.truckFill.length > 20) s.stats.truckFill.shift();
  return total;
}

function tickFactory(s, fid, f, notify) {
  Object.entries(ZONES).forEach(([z, Z]) => {
    const w = f[Z.works];
    if (!w || s.t < w.end) return;
    f[Z.lvl] = w.to; f[Z.works] = null;
    const L = levelDef(f, z);
    notify(`🏗 Travaux terminés : ${Z.name.toLowerCase()} de l'${FACTORY_DEFS[fid].name} au niveau ${w.to}. ${z === 'fab' ? `Jusqu'à ${L.st} pesées et ${L.tk} cuves.` : `Jusqu'à ${L.ln} lignes.`}`, 'success');
  });
  // 1. Réception usine : les agents d'appro libres rangent les livraisons du quai
  let cap = Math.max(0, f.supplyStaff - countStage(f, 'kitting')) * RECEIVE_RATE;
  while (cap > 0 && f.dock.length > 0) {
    const d = f.dock[0];
    const n = Math.min(cap, d.qty);
    s.components[d.comp] = Math.min(s.components[d.comp] + n, maxOf(s, d.comp));
    d.qty -= n; cap -= n;
    if (d.qty <= 0) f.dock.shift();
  }
  // 2. Étapes avec durée
  f.queue.forEach((o) => {
    if (o.stage !== 'kitting' && o.stage !== 'weighing' && o.stage !== 'mixing') return;
    o.timeLeft -= 1;
    if (o.timeLeft > 0) return;
    const label = { kitting: "📦 Kit d'appro prêt", weighing: '⚖️ Pesée terminée', mixing: '🛢 Cuve terminée' }[o.stage];
    o.stage = { kitting: 'kitted', weighing: 'weighed', mixing: 'mixed' }[o.stage];
    o.timeLeft = 0; o.wait = null;
    if (!f.auto) notify(`${label} : ${PRODUCT_SPECS[o.sku].name} (${o.pallets} pal.) — lancez l'étape suivante`, 'success');
  });
  // 2b. S&OP : création automatique des OF selon la demande prévue des filiales
  if (f.sop.bought && f.sop.on) {
    f.sop.timer += 1;
    if (f.sop.timer >= SOP_REVIEW) {
      f.sop.timer = 0;
      const review = []; // compte rendu affiché dans l'usine (pourquoi un OF a été créé ou non)
      FACTORY_DEFS[fid].skus.filter((k) => s.launched[k]).forEach((sku) => {
        const upp = unitsPerPallet(sku);
        const rate = Object.keys(FILIALE_DEFS).filter((id) => s.filiales[id].unlocked).reduce((a, id) => a + baseRate(s, id, sku) * (1 + campaignBoost(s, id, sku)), 0);
        const line = { sku, rate, cover: 0, act: 'ok', pallets: 0 };
        review.push(line);
        if (f.queue.some((o) => o.sku === sku && o.stage === 'queued')) { line.act = 'waiting'; return; }
        const pipeline = s.factoryStock[sku].units + s.dc.stock[sku] + s.dc.buffer[sku] * upp
          + s.transit.reduce((a, t) => a + (t.lines[sku] || 0) * upp, 0)
          + s.dc.docked.reduce((a, t) => a + (t.lines[sku] || 0) * upp, 0) + s.dc.yard.reduce((a, t) => a + (t.lines[sku] || 0) * upp, 0)
          + f.queue.filter((o) => o.sku === sku).reduce((a, o) => a + o.qty - o.made, 0);
        line.cover = rate > 0 ? pipeline / rate : Infinity;
        const need = rate * f.sop.cover - pipeline;
        if (rate <= 0) { line.act = 'nodemand'; return; }
        if (need <= 0) return;
        // Taille de lot raisonnable : au plus la moitié de la zone d'appro (les composants sont partagés et arrivent au fil de l'eau)
        // et au plus ce que le stock usine de la référence peut recevoir. Le reste sera planifié aux revues suivantes.
        const maxP = maxPalletsFor(s, fid, sku);
        const lotCap = Math.floor(Math.min(maxP / 2, s.factoryStock[sku].max / upp) / ORDER_STEP) * ORDER_STEP;
        const capP = Math.min(maxP, Math.max(MIN_ORDER_PALLETS, lotCap));
        const pallets = Math.min(capP, Math.max(MIN_ORDER_PALLETS, Math.ceil(need / upp / ORDER_STEP) * ORDER_STEP));
        if (pallets >= MIN_ORDER_PALLETS) { f.queue.push(newOrder(s.nextId++, sku, pallets)); line.act = 'created'; line.pallets = pallets; } else line.act = 'noroom';
      });
      f.sop.last = review;
    }
  }
  // 3. Planification automatique
  if (f.autoUnlocked && f.auto) {
    f.queue.forEach((o) => { if (['queued', 'kitted', 'weighed', 'mixed'].includes(o.stage)) tryAdvance(s, fid, f, o, null); });
  }
  // 3a. Techniciens
  let freeTechs = f.techs - f.lines.filter((l) => l.byTech).length;
  f.lines.forEach((l) => {
    if (freeTechs > 0 && (l.status === 'broken' || l.status === 'maintenance') && !l.byTech) { l.byTech = true; freeTechs -= 1; }
  });
  [...f.lines].sort((a, b) => b.wear - a.wear).forEach((l) => {
    if (freeTechs <= 0 || l.byTech || (l.status !== 'idle' && l.status !== 'running') || l.wear < f.techThreshold) return;
    if (s.money < TECH_MAINT_COST) return;
    book(s, 'usine', -TECH_MAINT_COST);
    l.status = 'maintenance'; l.timeLeft = MAINTENANCE_TICKS; l.wear = 0; l.stall = null; l.byTech = true;
    freeTechs -= 1;
  });
  // 3b. Acheteurs
  const buyable = factoryComps(fid);
  f.buyers.forEach((b) => {
    b.timer += 1;
    if (b.timer < BUYER_PERIOD) return;
    b.timer = 0;
    const ratio = (c) => (s.components[c] + pendingOf(s, c)) / maxOf(s, c);
    const c = b.focus === 'AUTO' ? [...buyable].sort((x, y) => ratio(x) - ratio(y))[0] : b.focus;
    const def = COMPONENTS[c];
    if (ratio(c) >= BUYER_TARGET) { b.last = '💤 Stocks suffisants'; return; }
    if (s.components[c] + pendingOf(s, c) + def.lot > maxOf(s, c)) { b.last = `⚠️ Zone pleine : ${def.name}`; return; }
    const cost = def.lot * def.cost;
    if (s.money < cost) { b.last = '⚠️ Fonds insuffisants'; return; }
    book(s, 'achats', -cost);
    placePO(s, fid, c, def.lot);
    b.last = `🛒 +${def.lot} ${def.name}`;
  });
  // 4. Lignes
  f.lines.forEach((l) => tickLine(s, f, l, notify));
  // 5. Contrat d'appro
  const plan = f.plan;
  if (plan.active) {
    plan.timer += 1;
    if (plan.timer >= plan.frequency) {
      plan.timer = 0;
      // Chaque composant est commandé dans la limite de la place libre : une zone pleine n'en bloque plus aucun autre
      const kit = {};
      Object.entries(contractKit(fid, plan.qty, s)).forEach(([c, n]) => {
        const room = Math.floor(maxOf(s, c) - s.components[c] - pendingOf(s, c));
        const q = Math.min(n, room);
        if (q > 0) kit[c] = q;
      });
      const total = kitTotalCost(kit);
      if (total > 0 && s.money >= total) {
        book(s, 'achats', -total);
        Object.entries(kit).forEach(([c, n]) => placePO(s, fid, c, n));
      }
    }
  }
  // 6. Navette automatique vers la centrale
  // Elle part aussi si le stock usine d'une référence est presque plein (sinon la ligne s'arrête faute de place)
  const nearFull = FACTORY_DEFS[fid].skus.some((k) => s.factoryStock[k].units >= unitsPerPallet(k) && s.factoryStock[k].units >= s.factoryStock[k].max * 0.85);
  if (s.features.navette && f.shuttle.on && readyPalletsOf(s, fid) >= 1 && (readyPalletsOf(s, fid) >= f.shuttle.threshold || nearFull) && s.money >= TRUCK_COST) {
    const n = sendTruck(s, fid);
    notify(`🔁 Navette partie de ${FACTORY_DEFS[fid].name} : ${n} palettes`, 'info');
  }
}

/* ============================================================
   CENTRALE LOGISTIQUE : un tick
   cour → quais de réception → zone de réception → racks → préparation → zone d'expédition → quais d'expédition → transport
   ============================================================ */
function releaseOrder(s, o) {
  o.lines.forEach((l) => {
    const upc = PRODUCT_SPECS[l.sku].unitsPerCarton;
    l.alloc = Math.min(l.req, availCartons(s, l.sku));
    s.dc.stock[l.sku] -= l.alloc * upc;
    l.picked = 0;
  });
  o.inFull = o.lines.every((l) => l.alloc >= l.req);
  o.missing = o.lines.filter((l) => l.alloc < l.req).map((l) => l.sku); // pour le diagnostic OTIF
  o.releasedAt = s.t;
  o.status = 'picking';
}

function tickDC(s, notify) {
  const dc = s.dc;
  const blocks = { recv: null, putaway: null, pick: null, load: null };

  // 1. Camions usine en route : arrivée dans la cour
  s.transit = s.transit.filter((t) => {
    t.eta -= 1;
    if (t.eta > 0) return true;
    dc.yard.push({ ...t, wait: 0 });
    if (s.features.centrale) notify(`🚚 Camion de ${FACTORY_DEFS[t.fid].name} arrivé dans la cour de la centrale (${t.pallets} pal.)`, 'info');
    return false;
  });
  if (!s.features.centrale) { dc.yard = []; return; }
  dc.outage = eventActive(s, 'OUTAGE');
  if (dc.kaizenRun && s.t >= dc.kaizenRun.end) {
    const p = dc.kaizenRun.post;
    notify(`🔁 Chantier terminé au poste ${DC_POSTS[p].name} : « ${KAIZEN_TOPICS[p][dc.kaizen[p]]} ». Débit +${KAIZEN_GAIN * 100} % pour toujours.`, 'success');
    dc.kaizen[p] += 1;
    s.stats.kaizen += 1;
    dc.kaizenRun = null;
  }

  // 2. Mise à quai
  dc.zoneFill = zoneFillOf(dc);
  // Un camion se met à quai sur un quai libre, de préférence celui dont la zone au sol est la plus vide
  while (dc.docked.length < dc.recvDocks && dc.yard.length > 0) {
    const used = new Set(dc.docked.map((t) => t.dock));
    const free = dc.zoneFill.map((f, i) => i).filter((i) => !used.has(i)).sort((a, b) => dc.zoneFill[a] - dc.zoneFill[b]);
    if (free.length === 0) break;
    dc.docked.push({ ...dc.yard.shift(), done: 0, dock: free[0] });
  }
  dc.yard.forEach((t) => {
    t.wait += 1;
    if (t.wait > YARD_FREE_TICKS) { book(s, 'incidents', -DEMURRAGE); dc.demurrage += DEMURRAGE; }
  });

  // 3. Réception : déchargement + contrôle -> zone de réception
  // Chaque camion à quai est déchargé par 2 équipiers au plus : plus de quais = plus de camions en parallèle
  const perWorker = DC_POSTS.recv.rate * postMult(dc, 'recv');
  let freeWorkers = dc.assign.recv;
  let cap = 0;
  dc.docked.forEach((t) => {
    const w = Math.min(RECV_PER_TRUCK, freeWorkers); freeWorkers -= w;
    t.carry = (t.carry || 0) + w * perWorker;
    cap = t.carry;
    while (cap >= 1 && t.done < t.pallets) {
      if (dc.zoneFill[t.dock] >= RECV_ZONE_PER_DOCK) { blocks.recv = `zone du quai ${t.dock + 1} pleine`; break; }
      const sku = Object.keys(t.lines).find((k) => t.lines[k] > 0);
      t.lines[sku] -= 1;
      dc.buffer[sku] += 1;
      dc.zoneFill[t.dock] += 1;
      t.done += 1;
      cap -= 1;
    }
    t.carry = Math.min(cap, 1);
  });
  dc.carry.recv = 0;
  dc.docked = dc.docked.filter((t) => {
    if (t.done < t.pallets) return true;
    s.stats.trucksReceived += 1;
    notify(`📥 Camion réceptionné : ${t.pallets} palettes contrôlées`, 'success');
    return false;
  });
  if (dc.docked.length > 0 && dc.assign.recv === 0) blocks.recv = 'personne au poste';

  // 4. Rangement : zone de réception -> racks
  cap = dc.carry.putaway + (s.features.putaway ? postRate(dc, 'putaway') : 0);
  const capa = dcCapacity(dc);
  while (cap >= 1 && bufferTotal(dc) > 0) {
    const sku = SKUS.reduce((best, k) => (dc.buffer[k] > (best ? dc.buffer[best] : 0) ? k : best), null);
    const upp = unitsPerPallet(sku);
    const needed = Math.ceil((dc.stock[sku] + upp) / upp - 1e-9) - Math.ceil(dc.stock[sku] / upp - 1e-9);
    if (dcPallets(dc) + needed > capa) { blocks.putaway = 'racks pleins'; break; }
    dc.buffer[sku] -= 1;
    { const z = dc.zoneFill; const i = z.indexOf(Math.max(...z)); if (z[i] > 0) z[i] -= 1; } // on dégage d'abord la zone la plus chargée
    dc.stock[sku] += upp;
    s.stats.palletsPutaway += 1;
    cap -= 1;
  }
  dc.carry.putaway = Math.min(cap, 1);
  if (bufferTotal(dc) > 0 && dc.assign.putaway === 0 && s.features.putaway) blocks.putaway = 'personne au poste';

  // 5. Lancement automatique (WMS)
  if (dc.upgrades.WMS && dc.wmsAuto && !dc.outage) {
    [...dc.orders].filter((o) => o.status === 'open').sort((a, b) => a.due - b.due).forEach((o) => {
      const full = o.lines.every((l) => availCartons(s, l.sku) >= l.req);
      const some = o.lines.some((l) => availCartons(s, l.sku) > 0);
      const urgent = o.due - s.t <= orderMode(s, o).time + LOAD_ALLOW + Math.round(PICK_ALLOW * 0.6); // il reste juste le temps de préparer et charger
      if (full || (urgent && some)) releaseOrder(s, o);
    });
  }

  // 6. Préparation : les préparateurs prennent les missions (une par palette) dans l'ordre des commandes
  const pickPer = s.features.pick ? DC_POSTS.pick.rate * postMult(dc, 'pick') : 0;
  const alloc = pickAlloc(dc);
  dc.orders.filter((o) => o.status === 'picking').forEach((o) => {
    let w = alloc[o.id] || 0;
    let done = 0;
    missionsOf(o, dc).forEach((m, i) => { if (w > 0 && m > 1e-9) { const n = Math.min(m, pickPer); o.mis[i] -= n; done += n * ((o.misK && o.misK[i]) || 1); w -= 1; } });
    o.lines.forEach((l) => {
      const n = Math.min(done, l.alloc - l.picked);
      if (n > 0) { l.picked += n; done -= n; }
    });
    if (o.mis.every((m) => m <= 1e-9) || o.lines.every((l) => l.picked >= l.alloc - 1e-9)) {
      o.lines.forEach((l) => { l.picked = l.alloc; });
      o.status = 'packed';
      o.palEq = palletsEq(o, 'picked');
      o.loaded = 0;
    }
  });
  dc.carry.pick = 0;
  if (dc.orders.some((o) => o.status === 'picking') && pickTeam(dc) === 0) blocks.pick = 'personne au poste';
  if (dc.auto && !dc.auto.done && s.t >= dc.auto.end) {
    dc.auto.done = true; dc.auto.robots = AUTO_ROBOTS;
    notify(`🤖 Automatisation terminée : ${AUTO_ROBOTS} robots préparent maintenant les commandes, sans salaire.`, 'success');
  }

  // Les commandes prêtes sont posées devant le quai d'expédition le moins chargé
  assignShipDocks(dc);

  // 7. Chargement : un camion par quai, 2 équipiers au plus par camion
  for (let d = 0; d < dc.shipDocks; d++) {
    if (dc.orders.some((o) => o.status === 'loading' && o.dock === d)) continue;
    const next = dc.orders.find((o) => o.status === 'packed' && o.dock === d);
    if (next) next.status = 'loading';
  }
  if (dc.orders.some((o) => o.status === 'packed')) blocks.load = 'camion déjà à quai, la commande attend son tour';
  const loadPer = s.features.load ? DC_POSTS.load.rate * postMult(dc, 'load') : 0;
  let freeLoad = dc.assign.load;
  dc.orders.filter((o) => o.status === 'loading').forEach((o) => {
    const w = Math.min(PER_DOCK, freeLoad); freeLoad -= w;
    o.loaded += Math.min(w * loadPer, o.palEq - o.loaded);
    if (o.loaded >= o.palEq - 1e-9) {
      const mode = orderMode(s, o); const mk = orderModeKey(s, o);
      const cost = shipCostOf(mode, mk, o.palEq);
      book(s, 'transport', -cost);
      s.stats.transportCost += cost;
      s.stats.co2 += o.palEq * mode.co2;
      addCarbon(s, o.palEq * mode.co2, o.palEq, mk === 'air');
      if (mk === 'air') s.stats.palAir += o.palEq;
      if (mk === 'sea') s.stats.palSea += o.palEq;
      const inGreen = MILESTONES[s.msIndex] && MILESTONES[s.msIndex].id === 'green';
      if (inGreen && mk === 'air') s.stats.greenAir += o.palEq;
      if (inGreen && mk === 'sea') s.stats.greenSea += o.palEq;
      const delay = eventActive(s, 'PORT') && mk === 'sea' ? 90 : 0;
      const lines = {};
      o.lines.forEach((l) => { if (l.picked > 0) lines[l.sku] = (lines[l.sku] || 0) + l.picked * PRODUCT_SPECS[l.sku].unitsPerCarton; });
      s.shipments.push({ id: s.nextId++, no: o.no, fil: o.fil, lines, pallets: o.palEq, mode: mk, eta: mode.time + delay, maxEta: mode.time + delay, due: o.due, inFull: o.inFull,
        rel: (o.releasedAt ?? s.t) - o.created, prep: s.t - (o.releasedAt ?? s.t), missing: o.missing || [], depLate: s.t + mode.time + delay - o.due });
      o.status = 'shipped';
      notify(`🚛 Commande n°${o.no} partie vers ${FILIALE_DEFS[o.fil].name} (${o.palEq} pal., ${eur(cost)} de transport)`, 'info');
    }
  });
  if (dc.orders.some((o) => o.status === 'loading') && dc.assign.load === 0) blocks.load = 'personne au poste';
  dc.orders = dc.orders.filter((o) => o.status !== 'shipped');

  // 8. Loyer des racks
  book(s, 'racks', -capa * RACK_RENT);
  dc.blocks = blocks;
}

/* ============================================================
   FILIALES : ventes, réception des livraisons, commandes à la centrale
   ============================================================ */
function tickFiliales(s, notify) {
  // 1. Livraisons qui arrivent
  s.shipments = s.shipments.filter((sh) => {
    sh.eta -= 1;
    if (sh.eta > 0) return true;
    const f = s.filiales[sh.fil];
    Object.entries(sh.lines).forEach(([sku, u]) => { f.stock[sku] += u; });
    const onTime = s.t <= sh.due;
    const ok = onTime && sh.inFull;
    f.otifHist.push(ok);
    if (f.otifHist.length > 10) f.otifHist.shift();
    // Diagnostic : pourquoi la livraison n'est pas OTIF
    f.otifLog = [...(f.otifLog || []), { no: sh.no, ok, onTime, inFull: sh.inFull, lateBy: s.t - sh.due, rel: sh.rel, prep: sh.prep, missing: sh.missing || [], mode: sh.mode }].slice(-10);
    f.delivered += 1;
    s.stats.ordersDelivered += 1;
    if (ok) s.stats.otif += 1;
    if (Object.keys(sh.lines).some((k) => PRODUCT_SPECS[k].factory === 'SKINCARE')) s.stats.skinDelivered += 1;
    const why = ok ? 'OTIF ✔' : `${onTime ? '' : 'en retard'}${!onTime && !sh.inFull ? ' et ' : ''}${sh.inFull ? '' : 'incomplète'}`;
    notify(`${FILIALE_DEFS[sh.fil].flag} Commande n°${sh.no} livrée à ${FILIALE_DEFS[sh.fil].name} : ${why}`, ok ? 'success' : 'info');
    return false;
  });

  // 2. Ventes aux clients locaux
  const act = activeSkus(s);
  const mktOn = !!s.features.marketing;
  Object.entries(s.filiales).forEach(([id, f]) => {
    if (!f.unlocked) return;
    const def = FILIALE_DEFS[id];
    if (!f.des) f.des = {};
    const tgt = desTarget(apOf(f));
    f.svcD *= SVC_DECAY;
    f.svcS *= SVC_DECAY;
    act.forEach((sku) => {
      f.carry[sku] = (f.carry[sku] || 0) + liveRate(s, id, sku) * (0.4 + 1.2 * Math.random());
      const want = Math.floor(f.carry[sku]);
      f.carry[sku] -= want;
      const sold = Math.min(want, f.stock[sku]);
      f.stock[sku] -= sold;
      f.svcD += want;
      f.svcS += sold;
      f.lost += want - sold;
      const rev = sold * PRODUCT_SPECS[sku].sellingPricePerUnit * def.price * desPrice(f, sku);
      book(s, 'ventes', rev);
      book(s, 'commercial', -rev * commercialRate(s));
      if (mktOn) {
        // Budget A&P, désirabilité qui rejoint sa cible, rupture qui abîme l'image
        if (rev > 0) book(s, 'marketing', -rev * apOf(f) / 100);
        let d = desOf(f, sku);
        d += (tgt - d) * DES_SPEED;
        if (want > sold) d -= DES_RUPTURE;
        // Campagnes en cours : désirabilité gagnée au fil de la campagne, ventes en plus suivies pour le bilan
        const boost = campaignBoost(s, id, sku);
        s.campaigns.forEach((c) => {
          if (!c.lever || c.sku !== sku || !c.fils.includes(id) || !campActive(s, c)) return;
          const L = MKT_LEVERS[c.lever];
          d += L.des / L.duration;
          c.sold += sold; c.lost += want - sold;
          c.incr += rev * (L.boost / (1 + boost));
        });
        f.des[sku] = Math.max(0, Math.min(100, d));
      }
      s.stats.revenue += rev;
      s.hour.rev += rev;
      f.sales += rev;
    });
    // Coût de possession du stock local
    const units = SKUS.reduce((a, k) => a + f.stock[k], 0);
    book(s, 'stockfil', -units * HOLDING_COST);
    // Satisfaction : elle suit le taux de service et l'OTIF
    const svc = svcOf(f);
    const otif = otifOf(f);
    const target = 0.5 * (svc === null ? 0.8 : svc) + 0.5 * (otif === null ? 0.8 : otif);
    f.sat += (target - f.sat) * 0.002;

    // 3. Revue des besoins : stock cible = consommation prévue × couverture
    f.timer += 1;
    if (f.timer < periodOf(f)) return;
    f.timer = 0;
    const lines = [];
    act.forEach((sku) => {
      const upc = PRODUCT_SPECS[sku].unitsPerCarton;
      const targetU = baseRate(s, id, sku) * f.cover;
      const position = f.stock[sku] + transitUnits(s, id, sku) + openOrderUnits(s, id, sku);
      const need = targetU - position;
      if (need >= Math.max(5 * upc, 0.15 * targetU)) lines.push({ sku, req: Math.ceil(need / upc), alloc: 0, picked: 0 });
    });
    if (lines.length === 0) return;
    let mk = f.mode;
    if (hasSplit(id)) { f.airAcc = (f.airAcc || 0) + airPctOf(f); if (f.airAcc >= 100 - 1e-9) { f.airAcc -= 100; mk = 'air'; } else mk = 'sea'; }
    const o = { id: s.nextId++, no: s.nextOrderNo++, fil: id, mode: mk, created: s.t, due: s.t + PREP_ALLOW + FILIALE_DEFS[id].modes[mk].time, lines, status: 'open', palEq: 0, loaded: 0, inFull: true };
    s.dc.orders.push(o);
    notify(`${def.flag} Nouvelle commande de ${def.name} : n°${o.no}, ${orderCartons(o)} cartons`, 'info');
  });
}

/* ============================================================
   ÉVÉNEMENTS
   ============================================================ */
function tickEvents(s, notify) {
  if (!s.features.events) return;
  if (s.event && s.t >= s.event.end) s.event = null;
  if (s.t < s.nextEventAt || s.event) return;
  const trucks = [...s.transit.map((t) => ['transit', t]), ...s.shipments.map((t) => ['ship', t])];
  // Les aléas « terrain » (panne système, vol) reviennent plus souvent que les autres
  const keys = Object.keys(EVENT_DEFS).filter((k) => (k !== 'TRAFFIC' || s.filiales.AE.unlocked) && (k !== 'THEFT' || trucks.length > 0));
  const pool = [...keys, ...keys.filter((k) => k === 'OUTAGE' || k === 'THEFT')];
  const key = pool[Math.floor(Math.random() * pool.length)];
  const d = { ...EVENT_DEFS[key] };
  if (key === 'OUTAGE' && s.dc.upgrades.BACKUP) d.duration = Math.round(d.duration / 3);
  let theftText = '';
  if (key === 'THEFT') {
    const [kind, tr] = trucks[Math.floor(Math.random() * trucks.length)];
    const where = kind === 'transit' ? `entre ${FACTORY_DEFS[tr.fid].name} et la centrale`
      : tr.mode === 'road' ? `en route vers ${FILIALE_DEFS[tr.fil].name}` : `qui apportait la commande de ${FILIALE_DEFS[tr.fil].name} au ${tr.mode === 'sea' ? 'port' : 'fret de l\'aéroport'}`;
    const foiled = s.dc.upgrades.SECURITY && Math.random() < 0.75;
    s.incidents = [...(s.incidents || []).slice(-4), { t: s.t, kind, fid: tr.fid, fil: tr.fil, mode: kind === 'transit' ? null : tr.mode, p: 1 - tr.eta / (tr.maxEta || 1), lost: !foiled }];
    if (foiled) {
      theftText = `Tentative de vol sur un camion ${where} : le traceur GPS a permis à la police d'intervenir. Rien n'a été perdu.`;
    } else {
      const units = kind === 'transit'
        ? Object.entries(tr.lines).reduce((a, [k, n]) => a + n * unitsPerPallet(k) * unitCost(k), 0)
        : Object.entries(tr.lines).reduce((a, [k, u]) => a + u * unitCost(k), 0);
      const franchise = Math.round(units * 0.3);
      book(s, 'incidents', -franchise);
      if (kind === 'transit') s.transit = s.transit.filter((x) => x !== tr);
      else {
        s.shipments = s.shipments.filter((x) => x !== tr);
        const f = s.filiales[tr.fil];
        f.otifHist.push(false);
        if (f.otifHist.length > 10) f.otifHist.shift();
      }
      theftText = `Un camion ${where} a été braqué sur une aire de repos : toute la marchandise est perdue${kind === 'ship' ? ', la commande ne sera jamais livrée' : ''}. L'assurance rembourse, mais la franchise vous coûte ${eur(franchise)}. Pensez au transport sécurisé (Équipements de la centrale).`;
    }
  }
  const act = activeSkus(s);
  const sku = act[Math.floor(Math.random() * act.length)];
  const start = s.t + d.lead;
  const text = {
    VIRAL: `Une vidéo fait exploser les ventes de ${PRODUCT_SPECS[sku].name} : demande ×4 partout pendant ${fmtT(d.duration)}. Ceux qui ont du stock de sécurité vont en profiter.`,
    FESTIVE: `Les fêtes approchent : dans ${fmtT(d.lead)}, la demande sera ×1,6 dans toutes les filiales pendant ${fmtT(d.duration)}. Augmentez les couvertures et produisez d'avance !`,
    PORT: `Grève dans les ports : les envois maritimes qui partent pendant ${fmtT(d.duration)} auront 1h30 de retard. Passez en aérien les filiales urgentes ?`,
    TRAFFIC: `Le trafic des aéroports s'effondre : les ventes du Travel Retail chutent de 60 % pendant ${fmtT(d.duration)}. Un canal très rentable, mais volatil.`,
    OUTAGE: `Le WMS et l'ERP sont tombés : la réception et la préparation passent en mode dégradé, sur papier (débit −65 %) pendant ${fmtT(d.duration)}. Le lancement automatique des commandes est suspendu.${s.dc.upgrades.BACKUP ? ' Le serveur de secours a réduit la durée de la panne.' : ' Un serveur de secours réduirait la panne.'}`,
    THEFT: theftText,
    GLASS: `Pénurie de verre chez les fournisseurs : les flacons commandés pendant ${fmtT(d.duration)} mettent 3 fois plus de temps à arriver.`,
  }[key];
  s.event = { key, sku, start, end: start + d.duration, text };
  s.nextEventAt = s.t + d.lead + d.duration + 600 + Math.floor(Math.random() * 600);
  notify(`${d.icon} ${d.title} : ${text}`, 'info');
  s.popups.push({ kind: 'event', title: `${d.icon} ${d.title}`, text });
}

/* ============================================================
   OBJECTIFS
   ============================================================ */
function openFiliale(s, id) {
  const f = s.filiales[id];
  f.unlocked = true;
  f.timer = REVIEW_PERIOD - 1; // première revue des besoins tout de suite
}
function checkMilestones(s) {
  while (s.msIndex < MILESTONES.length && MILESTONES[s.msIndex].check(s)) {
    const m = MILESTONES[s.msIndex];
    book(s, 'primes', m.reward);
    m.unlocks.forEach((k) => { s.features[k] = true; });
    if (m.unlocks.includes('fil_FR')) openFiliale(s, 'FR');
    s.popups.push({ kind: 'milestone', id: m.id });
    s.msIndex += 1;
  }
}

/* ============================================================
   ÉTAT INITIAL
   ============================================================ */
const zeroStock = () => Object.fromEntries(SKUS.map((k) => [k, 0]));
const makeFactory = (unlocked) => ({
  unlocked, lines: [], queue: [], stations: 1, tanks: 1, level: 1, works: null, levelC: 1, worksC: null, stationT: [0], tankT: [0], supplyStaff: 1, techs: 0, techThreshold: 60, buyers: [], zone: 0, dock: [],
  autoUnlocked: false, auto: false, plan: { active: false, frequency: 30, timer: 0, qty: 500 }, shuttle: { on: false, threshold: 20 },
  sop: { bought: false, on: false, cover: 360, timer: 0 },
});
const initialComponents = () => ({
  ...Object.fromEntries(Object.keys(COMPONENTS).map((c) => [c, 0])),
  ALCOOL: 2000, ESSENCES: 2000, FLACON_50: 1800, FLACON_100: 600, BOUCHON: 2000,
  ETUI_PARF50: 1800, ETUI_PARF100: 600, CARTON_PARF: 400, PALETTE: 50,
});
const makeFiliale = (id) => {
  const mode = FILIALE_DEFS[id].defaultMode || Object.keys(FILIALE_DEFS[id].modes)[0];
  return { unlocked: false, stock: zeroStock(), pos: 1, mode, airPct: mode === 'air' ? 100 : 0, cover: defaultCover(id, mode), timer: 0, carry: {}, svcD: 0, svcS: 0, otifHist: [], sat: 0.8, delivered: 0, lost: 0, sales: 0 };
};

const initialState = {
  version: 5,
  grants: ['bonus-1M-2026-11-22'], // dotations ponctuelles déjà reçues (une nouvelle partie n'en profite pas)
  launched: { PARF_50: true },
  rd: { labs: 1, projects: [], developed: 0 },
  paused: false,
  t: 0,
  time: { hour: 6, minute: 0 },
  day: 1,
  money: 120000,
  nextId: 10,
  nextOrderNo: 1,
  toast: null,
  toastCount: 0,
  log: [],
  popups: [{ kind: 'welcome' }],
  msIndex: 0,
  features: {},
  stats: { ofDone: 0, trucksSent: 0, trucksReceived: 0, palletsPutaway: 0, ordersDelivered: 0, otif: 0, purchaseOrders: 0, revenue: 0, skinDelivered: 0, excellence: 0, kaizen: 0, transportCost: 0, truckFill: [], co2: 0, palAir: 0, palSea: 0, greenAir: 0, greenSea: 0 },
  hour: { rev: 0, money0: 120000 },
  history: [],

  factories: {
    PARFUM: { ...makeFactory(true), lines: [makeLine(1, 'Ligne 1', 'PARF_50')], queue: [newOrder(2, 'PARF_50', 5)] },
    SKINCARE: makeFactory(false),
    MAKEUP: makeFactory(false),
    PRESTIGE: makeFactory(false),
  },
  components: initialComponents(),
  purchaseOrders: [],
  factoryStock: Object.fromEntries(SKUS.map((k) => [k, { units: 0, max: 15 * unitsPerPallet(k) }])),
  transit: [],

  dc: {
    recvDocks: 1, shipDocks: 1, bufferMax: BUFFER_BASE,
    yard: [], docked: [],
    buffer: zeroStock(), stock: zeroStock(),
    cells: initialCells(),
    staff: 3, assign: { recv: 2, putaway: 1, pick: 0, load: 0 },
    carry: { recv: 0, putaway: 0, pick: 0, load: 0 },
    upgrades: {}, wmsAuto: true,
    kaizen: { recv: 0, putaway: 0, pick: 0, load: 0 }, kaizenRun: null, outage: false,
    orders: [], demurrage: 0, blocks: {},
  },
  shipments: [],
  filiales: Object.fromEntries(Object.keys(FILIALE_DEFS).map((id) => [id, makeFiliale(id)])),

  campaigns: [],
  event: null,
  incidents: [], // vols de camions, affichés sur le globe
  nextEventAt: 0,
  pl: { cur: {}, prev: null, total: {}, days: [], money0: null, hcur: {}, hprev: null, hmoney0: null },
  carbon: { start: null, co2: 0, pal: 0, airPal: 0, last: null, taxTotal: 0 },
};

/* Remet à niveau une sauvegarde v5 plus ancienne (champs ajoutés depuis) */
function migrate(data) {
  const d = { ...structuredClone(initialState), ...data, toast: null };
  if (!data.launched) d.launched = Object.fromEntries(SKUS.filter((k) => data.factories[PRODUCT_SPECS[k].factory]?.unlocked).map((k) => [k, true]));
  const rawFactories = { ...(data.factories || {}) }; // copie avant fusion (d.factories est le même objet que data.factories)
  Object.keys(FACTORY_DEFS).forEach((fid) => { d.factories[fid] = { ...makeFactory(false), ...(data.factories[fid] || {}) }; });
  // Bâtiment par niveaux : chaque usine démarre au niveau qui loge ses équipements actuels
  Object.entries(d.factories).forEach(([fid, f]) => {
    const raw = rawFactories[fid] || {};
    // Équipements : un rang de taille par poste et par cuve (réparé si une version précédente les avait perdus)
    if (!Array.isArray(raw.stationT) || raw.stationT.length !== f.stations) f.stationT = Array(f.stations).fill(0);
    if (!Array.isArray(raw.tankT) || raw.tankT.length !== f.tanks) f.tankT = Array(f.tanks).fill(0);
    // Niveau de chaque zone : au moins celui qui loge les équipements actuels
    const fit = (n, key) => { let lv = 1; while (lv < FACTORY_LEVELS.length && n > FACTORY_LEVELS[lv - 1][key]) lv += 1; return lv; };
    const fabFit = Math.max(fit(f.stations, 'st'), fit(f.tanks, 'tk'));
    const condFit = fit(f.lines.length, 'ln');
    f.level = Math.max(raw.level || 1, fabFit); f.works = raw.works || null;
    f.levelC = Math.max(raw.levelC || raw.level || 1, condFit); f.worksC = raw.worksC || null;
    ['weighing', 'mixing'].forEach((stg) => { const fld = stg === 'weighing' ? 'stIdx' : 'tkIdx'; f.queue.filter((o) => o.stage === stg).forEach((o, i) => { if (o[fld] == null) o[fld] = i; }); });
  });

  if (!d.rd) d.rd = { labs: 1, projects: [], developed: 0 };
  d.campaigns = (d.campaigns || []).filter((c) => c.lever); // anciennes campagnes globales abandonnées
  // Nouvelles références ajoutées depuis : on complète les stocks
  SKUS.forEach((k) => {
    if (!d.factoryStock[k]) d.factoryStock[k] = { units: 0, max: 15 * unitsPerPallet(k) };
    if (d.dc.stock[k] === undefined) d.dc.stock[k] = 0;
    if (d.dc.buffer[k] === undefined) d.dc.buffer[k] = 0;
    Object.values(d.filiales).forEach((f) => { if (f.stock[k] === undefined) f.stock[k] = 0; });
  });
  if (!data.features.launch && data.features.buyers) d.features.launch = true;
  if (!data.features.sop && data.features.aps) d.features.sop = true;
  if (data.features.centrale) d.features.globe = true; // v5.4 : globe des transports
  d.filiales = { ...structuredClone(initialState.filiales), ...data.filiales }; // nouvelles filiales (v5.6)
  MILESTONES.slice(0, d.msIndex || 0).forEach((m) => m.unlocks.forEach((k) => { if (k.startsWith('fil_')) d.features[k] = true; }));
  if (!Array.isArray(d.incidents)) d.incidents = [];
  // Délais de transport allongés (v5.5) : on remonte les couvertures filiales trop courtes
  Object.entries(d.filiales).forEach(([id, f]) => { if (FILIALE_DEFS[id].modes[f.mode]) f.cover = Math.max(f.cover, defaultCover(id, f.mode)); });
  // Capacité de la centrale revue à la hausse
  // Dotation ponctuelle demandée par le joueur : versée une seule fois par sauvegarde
  if (!Array.isArray(data.grants)) d.grants = [];
  if (!d.grants.includes('bonus-1M-2026-11-22')) {
    d.grants = [...d.grants, 'bonus-1M-2026-11-22'];
    d.money += 1000000;
    d.toast = { msg: '💶 Dotation du siège : +1 000 000 € versés sur le compte.', type: 'success' };
  }
  // v5.5 : la centrale passe à 8 cellules (échelle de la centrale)
  completeCells(d.dc.cells);
  const c1 = d.dc.cells[0];
  if (c1.racking < 200) c1.racking = 200;
  // v5.5 : zone de réception = 50 pal. par quai. Les agrandissements achetés avant sont remboursés une fois.
  if (d.dc.bufferMax > BUFFER_BASE) {
    const refund = Math.round((d.dc.bufferMax - BUFFER_BASE) / BUFFER_STEP) * BUFFER_COST;
    d.money += refund;
    if (refund > 0) d.toast = { msg: `🟫 Zone de réception : désormais 50 pal. par quai. Agrandissements remboursés : ${eur(refund)}.`, type: 'success' };
  }
  d.dc.bufferMax = BUFFER_BASE;
  // Zones par quai : on répartit les palettes déjà au sol, et chaque camion à quai reçoit un numéro de quai
  { // v5.6 : équipements de préparation retirés (inutiles dans cette centrale) : remboursés
    const gone = { CARTS: 90000, VOICE: 120000, CONVEYOR: 250000, AMR: 600000 };
    let back = 0;
    Object.entries(gone).forEach(([k, c]) => { if (d.dc.upgrades && d.dc.upgrades[k]) { back += c; delete d.dc.upgrades[k]; } });
    if (back > 0) { d.money += back; d.toast = { msg: `⚙️ Équipements de préparation retirés, remboursés : ${eur(back)}.`, type: 'success' }; }
  }
  if (!d.dc.dueV2) { // délais de préparation allongés : on repousse l'échéance des commandes en cours
    d.dc.dueV2 = true;
    d.dc.orders.forEach((o) => { const m = FILIALE_DEFS[o.fil].modes[d.filiales[o.fil].mode] || Object.values(FILIALE_DEFS[o.fil].modes)[0]; o.due = Math.max(o.due, o.created + PREP_ALLOW + m.time); });
  }
  if (!Array.isArray(d.dc.zoneFill)) {
    const tot = SKUS.reduce((a, k) => a + (d.dc.buffer[k] || 0), 0);
    d.dc.zoneFill = Array.from({ length: d.dc.recvDocks }, (_, i) => Math.floor(tot / d.dc.recvDocks) + (i < tot % d.dc.recvDocks ? 1 : 0));
  }
  d.dc.docked.forEach((t, i) => { if (t.dock === undefined) t.dock = i; });
  // Références retirées du catalogue : on les oublie partout (stocks, OF, commandes, campagnes…)
  purgeUnknownSkus(d, SKUS);
  return d;
}

/* ============================================================
   REDUCER
   ============================================================ */
function reducer(state, action) {
  const s = structuredClone(state);
  const notify = (msg, type = 'error') => {
    s.toastCount += 1;
    s.toast = { id: s.toastCount, msg, type };
    if (type !== 'error') {
      s.log.unshift({ id: s.toastCount, msg, type, at: `J${s.day} ${String(s.time.hour).padStart(2, '0')}:${String(s.time.minute).padStart(2, '0')}` });
      if (s.log.length > 30) s.log.pop();
    }
  };
  const fail = (msg) => { notify(msg, 'error'); return s; };
  const fac = () => s.factories[action.fid];
  const pay = (cost, cat = 'invest') => { if (s.money < cost) return false; book(s, cat, -cost); return true; };

  switch (action.type) {
    case 'TICK': {
      if (s.paused || s.popups.length > 0) return state;
      s.t += 1;
      if (s.pl && s.pl.money0 == null) s.pl.money0 = s.money;
      if (s.pl && !s.pl.hcur) { s.pl.hcur = {}; s.pl.hmoney0 = null; }
      if (s.pl && s.pl.hmoney0 == null) s.pl.hmoney0 = s.money;
      const hourEnded = s.time.minute + 1 >= 60;
      const endedHour = s.time.hour, endedDay = s.day;
      // Horloge, salaires (toutes les heures de jeu), bilan horaire
      s.time.minute += 1;
      if (s.time.minute >= 60) {
        s.time.minute = 0;
        s.time.hour += 1;
        book(s, 'salaires', -wageCosts(s));
        book(s, 'structure', -structureCost(s));
        if (s.money < 0) book(s, 'agios', s.money * OVERDRAFT_RATE);
        s.history.push({ label: `J${s.day} ${s.time.hour - 1}h`, rev: s.hour.rev, net: s.money - s.hour.money0 });
        if (s.history.length > 12) s.history.shift();
        s.hour = { rev: 0, money0: s.money };
      }
      if (s.time.hour >= 24) {
        s.time.hour = 0;
        // Bilan carbone du jour : taxe sur ce qui dépasse le quota (palettes × plafond)
        if (carbonOn(s)) {
          if (s.carbon.start == null) s.carbon.start = s.day;
          const cap = carbonCap(s); const quota = s.carbon.pal * cap; const excess = Math.max(0, s.carbon.co2 - quota);
          const tax = Math.round(excess * CARBON_TAX);
          book(s, 'carbone', -tax); s.carbon.taxTotal += tax;
          s.carbon.last = { day: s.day, co2: s.carbon.co2, pal: s.carbon.pal, cap, tax, air: s.carbon.pal ? s.carbon.airPal / s.carbon.pal : 0 };
          notify(tax > 0 ? `🌱 Bilan carbone J${s.day} : ${(s.carbon.co2 / 1000).toFixed(1)} t, ${Math.round(s.carbon.co2 / Math.max(1, s.carbon.pal))} kg/pal. pour ${cap} autorisés : taxe ${eur(tax)}.` : `🌱 Bilan carbone J${s.day} : ${Math.round(s.carbon.co2 / Math.max(1, s.carbon.pal))} kg/pal., sous le plafond de ${cap}. Pas de taxe.`, tax > 0 ? 'error' : 'success');
        }
        s.carbon.co2 = 0; s.carbon.pal = 0; s.carbon.airPal = 0;
        // Clôture du compte de résultat de la journée, puis impôt sur le résultat d'exploitation
        if (s.pl) {
          const c = s.pl.cur;
          if (s.pl.money0 != null) { const gap = s.money - s.pl.money0 - Object.values(c).reduce((a, v) => a + v, 0); if (Math.abs(gap) > 1) c.autres = (c.autres || 0) + gap; }
          const res = plOp(c); const it = dayTax(res);
          if (it > 0) book(s, 'impot', -it);
          s.pl.prev = { ...c, day: s.day };
          Object.entries(c).forEach(([k, v]) => { s.pl.total[k] = (s.pl.total[k] || 0) + v; });
          s.pl.days = [...(s.pl.days || []), { day: s.day, ca: c.ventes || 0, op: res, net: res - it }].slice(-14);
          notify(`📒 Clôture J${s.day} : CA ${eur(c.ventes || 0)}, résultat d'exploitation ${eur(res)}${it > 0 ? `, impôt ${eur(it)}` : ''}.`, res >= 0 ? 'info' : 'error');
          s.pl.cur = {}; s.pl.money0 = s.money;
        }
        s.day += 1;
      }
      // Clôture du compte de résultat de l'heure écoulée (la taxe carbone et l'impôt de la nuit tombent dans l'heure 23h)
      if (hourEnded && s.pl) {
        const h = s.pl.hcur;
        const gap = s.money - s.pl.hmoney0 - Object.values(h).reduce((a, v) => a + v, 0); if (Math.abs(gap) > 1) h.autres = (h.autres || 0) + gap;
        s.pl.hprev = { ...h, day: endedDay, hour: endedHour };
        s.pl.hours = [s.pl.hprev, ...(s.pl.hours || [])].slice(0, 3);
        s.pl.hcur = {}; s.pl.hmoney0 = s.money;
      }

      // Livraisons fournisseurs -> quai de l'usine
      s.purchaseOrders = s.purchaseOrders.filter((po) => {
        po.eta -= 1;
        if (po.eta > 0) return true;
        s.factories[po.fid].dock.push({ comp: po.comp, qty: po.qty });
        return false;
      });
      Object.entries(s.factories).forEach(([fid, f]) => { if (f.unlocked) tickFactory(s, fid, f, notify); });
      s.rd.projects = s.rd.projects.filter((pr) => {
        if (s.t < pr.end) return true;
        s.launched[pr.sku] = true;
        s.rd.developed += 1;
        notify(`🧪 Développement terminé : ${PRODUCT_SPECS[pr.sku].name} est lancé ! Les filiales vont le commander, pensez aux OF.`, 'success');
        return false;
      });
      tickDC(s, notify);
      tickFiliales(s, notify);
      tickEvents(s, notify);
      s.campaigns = s.campaigns.filter((c) => {
        if (s.t < c.end) return true;
        if (c.lever) {
          const L = MKT_LEVERS[c.lever]; const roi = c.cost > 0 ? c.incr / c.cost : 0;
          const b = { id: c.id, sku: c.sku, fils: c.fils, lever: c.lever, cost: c.cost, incr: Math.round(c.incr), sold: c.sold, lost: c.lost, roi, day: s.day };
          s.mktLog = [b, ...(s.mktLog || [])].slice(0, 8);
          notify(`${L.icon} Bilan ${L.name} · ${PRODUCT_SPECS[c.sku].name} : ${eur(b.incr)} de ventes en plus pour ${eur(c.cost)} (×${roi.toFixed(1)})${c.lost > 0 ? `, ${c.lost} ventes perdues en rupture` : ''}.`, roi >= 1 && c.lost === 0 ? 'success' : 'info');
        }
        return false;
      });

      // Excellence mondiale (dernier objectif)
      const open = Object.values(s.filiales).filter((f) => f.unlocked);
      const excellent = open.length >= 4 && open.every((f) => (svcOf(f) ?? 0) >= 0.95 && (otifOf(f) ?? 0) >= 0.9);
      s.stats.excellence = excellent ? s.stats.excellence + 1 : 0;

      checkMilestones(s);
      return s;
    }

    case 'LOAD':
      if (!action.data || action.data.version !== 5) return state;
      return migrate(action.data);
    case 'RESET':
      return structuredClone(initialState);
    case 'TOGGLE_PAUSE':
      s.paused = !s.paused;
      return s;
    case 'CLEAR_TOAST':
      s.toast = null;
      return s;
    case 'CLOSE_POPUP':
      s.popups.shift();
      return s;

    /* ---------- USINES ---------- */
    case 'BUY_FACTORY': {
      const def = FACTORY_DEFS[action.fid];
      const f = fac();
      if (f.unlocked) return state;
      if (!s.features[`factory_${action.fid}`]) return fail("Cette usine n'est pas encore disponible.");
      if (!pay(def.buyCost)) return fail(`Fonds insuffisants ! Il faut ${eur(def.buyCost)}.`);
      f.unlocked = true;
      s.launched[def.skus[0]] = true; // la nouvelle usine lance d'abord une seule référence
      f.lines.push(makeLine(s.nextId++, 'Ligne 1', null));
      // Livrée avec un petit stock de démarrage (lancement des produits)
      Object.entries(contractKit(action.fid, 1500)).forEach(([c, n]) => { s.components[c] = Math.min(maxOf(s, c), s.components[c] + n); });
      notify(`🏭 ${def.name} ouverte avec un stock de démarrage. Vos filiales vont commander ses produits !`, 'success');
      return s;
    }
    case 'BUY_LINE': case 'BUY_STATION': case 'BUY_TANK': case 'BUY_EQUIP': {
      const f = fac();
      const kind = action.kind || { BUY_LINE: 'line', BUY_STATION: 'station', BUY_TANK: 'tank' }[action.type];
      const tier = action.tier || 0; const E = EQUIP[kind]; const T = E.tiers[tier];
      if (facLevel(f, zoneOf(kind)) < T.lvl) return fail(`${T.name} : il faut la zone ${ZONES[zoneOf(kind)].name.toLowerCase()} au niveau ${T.lvl}. Lancez des travaux d'agrandissement.`);
      if (countOf(f, kind) >= capOf(f, kind)) return fail(`Bâtiment plein : ${capOf(f, kind)} ${E.label.toLowerCase()}s au plus au niveau ${facLevel(f, zoneOf(kind))}. Agrandissez la zone ou remplacez un équipement par un plus gros.`);
      if (!pay(T.cost)) return fail(`Fonds insuffisants ! Il faut ${eur(T.cost)}.`);
      if (kind === 'line') { const l = makeLine(s.nextId++, `Ligne ${f.lines.length + 1}`, null); l.tier = tier; f.lines.push(l); }
      else { f[E.key].push(tier); if (kind === 'station') f.stations = f.stationT.length; else f.tanks = f.tankT.length; }
      notify(`${E.icon} ${T.name} installée.`, 'success');
      return s;
    }
    case 'REPLACE_EQUIP': {
      const f = fac(); const E = EQUIP[action.kind]; const T = E.tiers[action.tier];
      if (facLevel(f, zoneOf(action.kind)) < T.lvl) return fail(`${T.name} : il faut la zone ${ZONES[zoneOf(action.kind)].name.toLowerCase()} au niveau ${T.lvl}.`);
      let oldTier;
      if (action.kind === 'line') {
        const l = f.lines.find((x) => x.id === action.lineId);
        if (!l || l.orderId || l.status !== 'idle') return fail('La ligne doit être à l\'arrêt, sans OF, pour être remplacée.');
        oldTier = l.tier || 0;
      } else {
        const field = action.kind === 'station' ? 'stIdx' : 'tkIdx';
        if (busyIdx(f, action.kind === 'station' ? 'weighing' : 'mixing', field).has(action.idx)) return fail("L'équipement doit être libre pour être remplacé.");
        oldTier = f[E.key][action.idx];
      }
      if (oldTier >= action.tier) return state;
      const net = T.cost - Math.round(E.tiers[oldTier].cost * EQUIP_REFUND);
      if (!pay(net)) return fail(`Fonds insuffisants ! Il faut ${eur(net)} (reprise de l'ancien déduite).`);
      if (action.kind === 'line') { const l = f.lines.find((x) => x.id === action.lineId); l.tier = action.tier; l.wear = 0; }
      else f[E.key][action.idx] = action.tier;
      notify(`${E.icon} ${E.tiers[oldTier].name} remplacée par : ${T.name}.`, 'success');
      return s;
    }
    case 'START_WORKS': {
      const z = action.zone || 'fab'; const Z = ZONES[z];
      const f = fac(); const lv = facLevel(f, z);
      if (f[Z.works] || lv >= FACTORY_LEVELS.length) return state;
      const N = FACTORY_LEVELS[lv]; const cost = zoneCost(N, z);
      if (s.msIndex < N.ms) return fail(`Agrandissement disponible plus tard dans la progression (après « ${MILESTONES[N.ms - 1].title} »).`);
      if (!pay(cost)) return fail(`Fonds insuffisants ! Les travaux coûtent ${eur(cost)}.`);
      f[Z.works] = { to: lv + 1, start: s.t, end: s.t + N.ticks };
      notify(`🏗 Travaux lancés : ${Z.name.toLowerCase()} de l'${FACTORY_DEFS[action.fid].name} → niveau ${lv + 1}, ${fmtT(N.ticks)} de chantier (${Z.what} à ${Math.round(WORKS_SPEED * 100)} % de cadence pendant les travaux).`, 'info');
      return s;
    }
    case 'MAINTENANCE': {
      const l = fac().lines.find((x) => x.id === action.lineId);
      if (!l || (l.status !== 'idle' && l.status !== 'running')) return fail('Maintenance impossible dans cet état.');
      if (!pay(MAINTENANCE_COST, 'usine')) return fail(`Fonds insuffisants ! Maintenance : ${eur(MAINTENANCE_COST)}.`);
      l.status = 'maintenance'; l.timeLeft = MAINTENANCE_TICKS; l.wear = 0; l.stall = null;
      return s;
    }
    case 'BUY_ZONE': {
      const f = fac();
      const cost = ZONE_COST * (f.zone + 1);
      if (!pay(cost)) return fail(`Fonds insuffisants ! Il faut ${eur(cost)}.`);
      f.zone += 1;
      notify(`📦 Zone d'appro agrandie (niveau ${f.zone}) : +50 % de capacité de stockage.`, 'success');
      return s;
    }
    case 'HIRE_TECH':
      fac().techs += 1;
      return s;
    case 'FIRE_TECH': {
      const f = fac();
      if (f.techs <= 0) return state;
      if (f.techs - 1 < f.lines.filter((l) => l.byTech).length) return fail('Impossible : tous les techniciens sont en intervention.');
      f.techs -= 1;
      return s;
    }
    case 'ADJUST_TECH_THRESHOLD': {
      const f = fac();
      f.techThreshold = Math.max(20, Math.min(90, f.techThreshold + action.amount));
      return s;
    }
    case 'HIRE_BUYER':
      fac().buyers.push({ id: s.nextId++, timer: 0, focus: 'AUTO', last: null });
      return s;
    case 'FIRE_BUYER':
      fac().buyers = fac().buyers.filter((b) => b.id !== action.buyerId);
      return s;
    case 'SET_BUYER_FOCUS': {
      const b = fac().buyers.find((x) => x.id === action.buyerId);
      if (!b) return state;
      b.focus = action.focus; b.timer = 0;
      return s;
    }
    case 'HIRE_SUPPLY':
      fac().supplyStaff += 1;
      return s;
    case 'FIRE_SUPPLY': {
      const f = fac();
      if (f.supplyStaff <= 1) return fail("Il faut au moins 1 agent d'appro.");
      if (f.supplyStaff - 1 < countStage(f, 'kitting')) return fail('Impossible : cet agent prépare un kit en ce moment.');
      f.supplyStaff -= 1;
      return s;
    }
    case 'CREATE_ORDER': {
      const f = fac();
      const { sku, pallets } = action;
      if (!FACTORY_DEFS[action.fid].skus.includes(sku)) return state;
      if (!s.launched[sku]) return fail("Cette référence n'est pas encore lancée.");
      if (pallets < MIN_ORDER_PALLETS) return fail(`Un OF doit faire au moins ${MIN_ORDER_PALLETS} palettes.`);
      if (pallets > maxPalletsFor(s, action.fid, sku)) return fail("OF trop gros pour la zone d'appro : agrandissez-la ou réduisez les palettes.");
      f.queue.push(newOrder(s.nextId++, sku, pallets));
      return s;
    }
    case 'CANCEL_ORDER': {
      const f = fac();
      const o = f.queue.find((x) => x.id === action.orderId);
      if (!o) return state;
      if (['weighing', 'mixing', 'running'].includes(o.stage)) return fail("Cet OF est en cours de fabrication : impossible de l'annuler.");
      if (['kitting', 'kitted', 'weighed', 'mixed'].includes(o.stage)) {
        Object.entries(kitNeeds(action.fid, o.sku, o.qty)).forEach(([c, n]) => { s.components[c] = Math.min(maxOf(s, c), s.components[c] + n); });
        notify("OF annulé : le kit d'appro est retourné en zone d'appro.", 'info');
      }
      f.queue = f.queue.filter((x) => x.id !== o.id);
      return s;
    }
    case 'MOVE_ORDER': {
      const f = fac();
      const i = f.queue.findIndex((o) => o.id === action.orderId);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= f.queue.length) return state;
      [f.queue[i], f.queue[j]] = [f.queue[j], f.queue[i]];
      return s;
    }
    case 'ADVANCE_ORDER': {
      const f = fac();
      const o = f.queue.find((x) => x.id === action.orderId);
      if (!o || !['queued', 'kitted', 'weighed', 'mixed'].includes(o.stage)) return state;
      if (!tryAdvance(s, action.fid, f, o, action.lineId || null)) return fail(`Impossible de lancer : ${o.wait || 'ressource indisponible'}.`);
      return s;
    }
    case 'BUY_AUTO': {
      const f = fac();
      if (f.autoUnlocked) return state;
      if (!pay(APS_COST)) return fail(`Fonds insuffisants ! Il faut ${eur(APS_COST)}.`);
      f.autoUnlocked = true; f.auto = true;
      notify("🤖 Planification automatique installée : les OF s'enchaînent seuls, étape par étape.", 'success');
      return s;
    }
    case 'BUY_SOP': {
      const f = fac();
      if (f.sop.bought) return state;
      if (!pay(SOP_COST)) return fail(`Fonds insuffisants ! Il faut ${eur(SOP_COST)}.`);
      f.sop.bought = true; f.sop.on = true; f.sop.timer = SOP_REVIEW - 1;
      notify('🧭 Module S&OP installé : les OF se créent seuls selon la demande des filiales.', 'success');
      return s;
    }
    case 'TOGGLE_SOP':
      fac().sop.on = !fac().sop.on;
      return s;
    case 'ADJUST_SOP': {
      const sp = fac().sop;
      sp.cover = Math.max(60, Math.min(4320, sp.cover + action.amount)); // jusqu'à 72 h
      return s;
    }
    case 'START_RD': {
      const sku = action.sku;
      const fidR = PRODUCT_SPECS[sku].factory;
      if (!s.features.launch) return fail('Le Développement se débloque au chapitre 3.');
      if (!s.factories[fidR].unlocked || s.launched[sku] || nextRdSku(s, fidR) !== sku) return state;
      if (s.rd.projects.some((p) => PRODUCT_SPECS[p.sku].factory === fidR)) return fail('Un projet est déjà en cours pour cette usine.');
      if (s.rd.projects.length >= s.rd.labs) return fail('Tous les laboratoires sont occupés : attendez ou ouvrez-en un autre.');
      const cost = rdCost(s, sku);
      if (!pay(cost, 'rd')) return fail(`Fonds insuffisants ! Il faut ${eur(cost)}.`);
      s.rd.projects.push({ sku, start: s.t, end: s.t + RD_TICKS[fidR] });
      notify(`🧪 Projet lancé : ${PRODUCT_SPECS[sku].name}, sortie dans ${fmtT(RD_TICKS[fidR])}.`, 'info');
      return s;
    }
    case 'BUY_LAB':
      if (!pay(LAB_COST * s.rd.labs, 'rd')) return fail(`Fonds insuffisants ! Il faut ${eur(LAB_COST * s.rd.labs)}.`);
      s.rd.labs += 1;
      return s;
    case 'LAUNCH_SKU': {
      const sku = action.sku;
      const fidL = PRODUCT_SPECS[sku].factory;
      if (s.launched[sku] || !s.factories[fidL].unlocked) return state;
      if (!s.features.launch) return fail('Les lancements se débloquent au chapitre 3.');
      if (!pay(LAUNCH_COST[fidL], 'rd')) return fail(`Fonds insuffisants ! Il faut ${eur(LAUNCH_COST[fidL])}.`);
      s.launched[sku] = true;
      notify(`🚀 Lancement de ${PRODUCT_SPECS[sku].name} : les filiales vont le commander dès leur prochaine revue.`, 'success');
      return s;
    }
    case 'TOGGLE_AUTO': {
      const f = fac();
      if (f.autoUnlocked) f.auto = !f.auto;
      return s;
    }
    case 'UPGRADE_FACTORY_STORAGE':
      if (!pay(FACTORY_STORAGE_COST)) return fail(`Fonds insuffisants ! Il faut ${eur(FACTORY_STORAGE_COST)}.`);
      s.factoryStock[action.sku].max += unitsPerPallet(action.sku) * 5;
      return s;
    case 'SEND_TRUCK': {
      if (readyPalletsOf(s, action.fid) < 1) return fail("Aucune palette prête à l'usine.");
      if (s.money < TRUCK_COST) return fail("Pas assez d'argent pour payer le camion !");
      const n = sendTruck(s, action.fid);
      notify(`🚛 Camion parti vers la centrale : ${n}/${TRUCK_MAX_PALLETS} palettes (remplissage ${Math.round((n / TRUCK_MAX_PALLETS) * 100)} %)`, 'info');
      return s;
    }
    case 'TOGGLE_SHUTTLE':
      fac().shuttle.on = !fac().shuttle.on;
      return s;
    case 'ADJUST_SHUTTLE': {
      const sh = fac().shuttle;
      sh.threshold = Math.max(5, Math.min(TRUCK_MAX_PALLETS, sh.threshold + action.amount));
      return s;
    }
    case 'ORDER_COMPONENT': {
      const c = COMPONENTS[action.comp];
      if (s.components[action.comp] + pendingOf(s, action.comp) + c.lot > maxOf(s, action.comp)) return fail(`Zone d'appro pleine pour : ${c.name}. Agrandissez la zone.`);
      if (!pay(c.lot * c.cost, 'achats')) return fail(`Fonds insuffisants ! Il faut ${eur(c.lot * c.cost)}.`);
      placePO(s, action.fid, action.comp, c.lot);
      return s;
    }
    case 'ACTIVATE_CONTRACT':
      if (!pay(CONTRACT_SIGN_COST)) return fail(`Fonds insuffisants ! Il faut ${eur(CONTRACT_SIGN_COST)} pour signer ce contrat.`);
      fac().plan.active = true; fac().plan.timer = 0;
      return s;
    case 'DEACTIVATE_CONTRACT':
      fac().plan.active = false; fac().plan.timer = 0;
      return s;
    case 'ADJUST_FREQUENCY': {
      const p = fac().plan;
      p.frequency = Math.max(10, Math.min(120, p.frequency + action.amount)); p.timer = 0;
      return s;
    }
    case 'ADJUST_QUANTITY': {
      const p = fac().plan;
      p.qty = Math.max(100, Math.min(1500, p.qty + action.amount));
      return s;
    }

    /* ---------- CENTRALE ---------- */
    case 'DC_HIRE':
      s.dc.staff += 1;
      return s;
    case 'DC_FIRE': {
      const dc = s.dc;
      if (dc.staff - assignedTotal(dc) < 1) return fail("Retirez d'abord un équipier d'un poste : tout le monde est affecté.");
      dc.staff -= 1;
      return s;
    }
    case 'DC_ASSIGN': {
      const dc = s.dc;
      const { post, delta } = action;
      if (delta > 0 && assignedTotal(dc) >= dc.staff) return fail('Aucun équipier libre : recrutez-en un.');
      if (delta < 0 && dc.assign[post] <= 0) return state;
      dc.assign[post] += delta;
      return s;
    }
    case 'DC_BUY_DOCK': {
      const key = action.kind === 'recv' ? 'recvDocks' : 'shipDocks';
      const cost = DOCK_COST * s.dc[key];
      if (!pay(cost)) return fail(`Fonds insuffisants ! Il faut ${eur(cost)}.`);
      s.dc[key] += 1;
      return s;
    }
    case 'DC_BUY_BUFFER': {
      return state; // plus d'agrandissement : la zone suit le nombre de quais
      return s;
    }
    case 'BUY_RACKING': {
      const cell = s.dc.cells.find((c) => c.id === action.cellId);
      const quote = rackingQuote(cell, action.bulk);
      if (!quote) return state;
      if (!pay(quote.cost)) return fail('Fonds insuffisants pour ajouter des emplacements !');
      addRacking(cell, quote.slots);
      return s;
    }
    case 'BUILD_CELL': {
      const cell = s.dc.cells.find((c) => c.id === action.cellId);
      const quote = cellQuote(cell);
      if (!quote) return state;
      if (!pay(quote.cost)) return fail("Fonds insuffisants pour construire cette cellule !");
      openCell(cell);
      return s;
    }
    case 'DC_UPGRADE': {
      const u = DC_UPGRADES[action.key];
      if (s.dc.upgrades[action.key]) return state;
      if (u.req && !s.dc.upgrades[u.req]) return fail(`Il faut d'abord installer : ${DC_UPGRADES[u.req].name}.`);
      if (!pay(u.cost)) return fail(`Fonds insuffisants ! Il faut ${eur(u.cost)}.`);
      s.dc.upgrades[action.key] = true;
      notify(`${u.icon} ${u.name} installé.`, 'success');
      return s;
    }
    case 'START_AUTOMATION': {
      if (s.dc.auto) return state;
      if (!pay(AUTO_COST)) return fail(`Fonds insuffisants ! Il faut ${eur(AUTO_COST)}.`);
      s.dc.auto = { done: false, end: s.t + AUTO_BUILD, robots: 0 };
      notify(`🏗 Projet d'automatisation lancé : ${fmtT(AUTO_BUILD)} de travaux.`, 'info');
      return s;
    }
    case 'BUY_ROBOT': {
      if (!s.dc.auto || !s.dc.auto.done) return state;
      const n = action.n || 1;
      if (!pay(ROBOT_COST * n)) return fail(`Fonds insuffisants ! Il faut ${eur(ROBOT_COST * n)}.`);
      s.dc.auto.robots += n;
      return s;
    }
    case 'START_KAIZEN': {
      const dc = s.dc;
      const lvl = dc.kaizen[action.post];
      if (dc.kaizenRun) return fail('Un chantier est déjà en cours : une chose à la fois !');
      if (lvl >= KAIZEN_MAX) return fail('Ce poste est déjà au meilleur niveau.');
      if (!pay(KAIZEN_COST * (lvl + 1), 'usine')) return fail(`Fonds insuffisants ! Il faut ${eur(KAIZEN_COST * (lvl + 1))}.`);
      dc.kaizenRun = { post: action.post, end: s.t + KAIZEN_TICKS };
      notify(`🔁 Chantier lancé au poste ${DC_POSTS[action.post].name} : « ${KAIZEN_TOPICS[action.post][lvl]} »`, 'info');
      return s;
    }
    case 'SET_PICK_SLOTS':
      s.dc.pickSlots = Math.max(1, Math.min(200, pickSlots(s.dc) + (Math.abs(action.delta) > 1 ? action.delta : pickSlots(s.dc) >= 20 ? action.delta * 5 : action.delta)));
      return s;
    case 'TOGGLE_WMS':
      s.dc.wmsAuto = !s.dc.wmsAuto;
      return s;
    case 'RELEASE_ORDER': {
      const o = s.dc.orders.find((x) => x.id === action.orderId);
      if (!o || o.status !== 'open') return state;
      if (o.lines.every((l) => availCartons(s, l.sku) === 0)) return fail('Aucun stock disponible en rack pour cette commande.');
      releaseOrder(s, o);
      if (!o.inFull) notify(`⚠️ Commande n°${o.no} lancée en partiel : elle ne sera pas OTIF.`, 'info');
      return s;
    }
    case 'MOVE_DC_ORDER': {
      const list = s.dc.orders;
      const i = list.findIndex((o) => o.id === action.orderId);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= list.length) return state;
      [list[i], list[j]] = [list[j], list[i]];
      return s;
    }

    /* ---------- FILIALES ---------- */
    case 'UNLOCK_FILIALE': {
      const def = FILIALE_DEFS[action.id];
      if (!s.features[`fil_${action.id}`]) return fail("Cette filiale n'est pas encore disponible.");
      if (!pay(def.unlockCost)) return fail(`Fonds insuffisants ! Il faut ${eur(def.unlockCost)}.`);
      openFiliale(s, action.id);
      notify(`${def.flag} Filiale ${def.name} ouverte ! Elle va passer sa première commande.`, 'success');
      return s;
    }
    case 'BUY_POS': {
      const f = s.filiales[action.id];
      const cost = Math.round(FILIALE_DEFS[action.id].posCost * 1.5 ** (f.pos - 1));
      if (!pay(cost)) return fail(`Fonds insuffisants ! Il faut ${eur(cost)}.`);
      f.pos += 1;
      notify(`🛍 Nouveau point de vente en ${FILIALE_DEFS[action.id].name} : la demande augmente de 60 %.`, 'success');
      return s;
    }
    case 'SET_PERIOD': {
      const f = s.filiales[action.id];
      const i = Math.max(0, Math.min(ORDER_PERIODS.length - 1, ORDER_PERIODS.indexOf(periodOf(f)) + action.dir));
      f.period = ORDER_PERIODS[i];
      return s;
    }
    case 'SET_COVER': {
      const f = s.filiales[action.id];
      f.cover = Math.max(30, Math.min(4000, f.cover + action.delta));
      return s;
    }
    case 'SET_MODE': {
      const f = s.filiales[action.id];
      f.mode = action.mode;
      if (hasSplit(action.id)) f.airPct = action.mode === 'air' ? 100 : 0;
      f.cover = Math.max(f.cover, defaultCover(action.id, action.mode)); // un mode plus lent demande plus de couverture
      return s;
    }
    case 'SET_AIR_PCT': {
      const f = s.filiales[action.id];
      if (!hasSplit(action.id)) return s;
      f.airPct = Math.max(0, Math.min(100, airPctOf(f) + action.delta));
      f.mode = f.airPct >= 50 ? 'air' : 'sea';
      f.cover = Math.max(f.cover, splitTime(action.id, f.airPct) + PREP_ALLOW + 90); // plus de bateau = plus de stock en route à couvrir
      return s;
    }
    case 'SET_ORDER_MODE': { // envoyer une commande précise par l'autre mode (urgence, ou au contraire économie)
      const o = s.dc.orders.find((x) => x.id === action.orderId);
      if (!o || o.status === 'loading' || !hasSplit(o.fil)) return s;
      o.mode = action.mode;
      return s;
    }

    /* ---------- MARKETING ---------- */
    case 'LAUNCH_CAMPAIGN': {
      const L = MKT_LEVERS[action.lever];
      if (!L || !s.launched[action.sku]) return state;
      const fils = (action.fil === 'ALL' ? Object.keys(s.filiales).filter((id) => s.filiales[id].unlocked) : [action.fil]).filter((id) => s.filiales[id] && s.filiales[id].unlocked);
      if (!fils.length) return state;
      if (s.campaigns.some((c) => c.lever === action.lever && c.sku === action.sku && c.fils.some((id) => fils.includes(id)))) return fail('Une campagne de ce type est déjà prévue sur cette référence et ce marché.');
      const cost = campaignCost(s, action.lever, action.sku, fils);
      if (!pay(cost, 'marketing')) return fail(`Fonds insuffisants ! Coût : ${eur(cost)}.`);
      s.campaigns.push({ id: s.nextId++, lever: action.lever, sku: action.sku, fils, cost, start: s.t + L.lead, end: s.t + L.lead + L.duration, sold: 0, lost: 0, incr: 0 });
      notify(`${L.icon} ${L.name} · ${PRODUCT_SPECS[action.sku].name} : démarrage dans ${fmtT(L.lead)} (${fils.length > 1 ? `${fils.length} marchés` : FILIALE_DEFS[fils[0]].name}). Prévenez la supply chain !`, 'success');
      return s;
    }
    case 'SET_AP': {
      const f = s.filiales[action.id];
      if (!f) return state;
      f.ap = Math.max(0, Math.min(AP_MAX, apOf(f) + action.delta));
      return s;
    }

    default:
      return state;
  }
}

/* ============================================================
   SAUVEGARDE
   ============================================================ */
const SAVE_KEY = 'supply-chain-tycoon-save-v5'; // v5 : progression, centrale en 4 postes, filiales (anciennes sauvegardes ignorées)
let memorySave = null;
const storage = {
  async load() {
    try {
      if (window.storage) {
        const r = await window.storage.get(SAVE_KEY);
        if (r && r.value) return JSON.parse(r.value);
        return null;
      }
    } catch (e) { /* pas de sauvegarde */ }
    try {
      const v = window.localStorage.getItem(SAVE_KEY);
      if (v) return JSON.parse(v);
    } catch (e) { /* localStorage indisponible */ }
    return null;
  },
  async save(data) {
    const text = JSON.stringify(data);
    try {
      if (window.storage) { await window.storage.set(SAVE_KEY, text); return true; }
    } catch (e) { /* on essaie localStorage */ }
    try { window.localStorage.setItem(SAVE_KEY, text); return true; } catch (e) { return false; }
  },
};

// Sauvegardes manuelles : fichier à télécharger, ou code à copier-coller (marche aussi entre la version en ligne et le fichier HTML)
const SavePanel = ({ g, dispatch, onClose }) => {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);
  const code = () => JSON.stringify({ ...g, popups: [], toast: null });
  const name = `supply-chain-tycoon-jour-${g.day}-${String(g.time.hour).padStart(2, '0')}h.json`;
  const download = async () => {
    // Dans la page publiée, le téléchargement passe par le visualiseur (confirmation) ; dans le fichier HTML, lien classique
    if (window.claude && window.claude.use) {
      try {
        const dl = await window.claude.use('downloads');
        if (dl) {
          try { await dl.save({ filename: name, data: code() }); setMsg(`Fichier ${name} enregistré.`); }
          catch (e) { setMsg(e && e.code === 'declined' ? 'Téléchargement annulé.' : 'Téléchargement impossible ici : utilisez « Copier le code ».'); }
          return;
        }
      } catch (e) { /* on tente le lien classique */ }
    }
    try {
      const url = URL.createObjectURL(new Blob([code()], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMsg(`Fichier ${name} téléchargé. Si rien ne se passe, utilisez « Copier le code ».`);
    } catch (e) { setMsg('Téléchargement impossible ici : utilisez « Copier le code ».'); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(code()); setMsg('Code de sauvegarde copié : collez-le dans une note ou un e-mail.'); }
    catch (e) { setText(code()); setMsg('Copie automatique bloquée : le code est dans la zone ci-dessous, sélectionnez-le et copiez-le.'); }
  };
  const load = (raw) => {
    try {
      const data = JSON.parse(raw);
      if (!data || data.version !== 5 || !data.factories) { setMsg("Ce n'est pas une sauvegarde valide de ce jeu."); return; }
      dispatch({ type: 'LOAD', data }); storage.save(data);
      setMsg(`Partie chargée : jour ${data.day}.`); setText('');
    } catch (e) { setMsg("Code illisible : vérifiez qu'il a été copié en entier."); }
  };
  const btn = { ...actionBtnStyle, background: 'transparent', color: '#c9a24b', border: '1px solid #c9a24b', padding: '5px 10px', fontSize: '0.78em' };
  return (
    <div style={{ background: '#151515', border: '1px solid #c9a24b', padding: 12, margin: '0 0 14px 0', color: '#e9e1cc', fontSize: '0.85em' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <strong style={{ color: '#c9a24b' }}>{deco('💾 ')}Sauvegardes</strong>
        <button onClick={onClose} style={{ ...btn, padding: '2px 8px' }}>✕</button>
      </div>
      <div style={{ fontSize: '0.85em', color: '#b9ae93', marginBottom: 8 }}>La partie s'enregistre seule dans ce navigateur toutes les 5 secondes. Pour la garder ailleurs ou la reprendre sur une autre version du jeu, exportez-la puis importez-la.</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <button onClick={download} style={btn}>⬇ Télécharger le fichier</button>
        <button onClick={copy} style={btn}>{deco('📋 ')}Copier le code</button>
        <button onClick={() => fileRef.current && fileRef.current.click()} style={btn}>⬆ Ouvrir un fichier</button>
        <input ref={fileRef} type="file" accept=".json,application/json,text/plain" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (!f) return; f.text().then(load); e.target.value = ''; }} />
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="… ou collez ici un code de sauvegarde" rows={3} style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.8em', background: '#0b0b0b', color: '#e9e1cc', border: '1px solid #3a3424', padding: 6 }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
        <button onClick={() => load(text)} disabled={!text.trim()} style={{ ...btn, opacity: text.trim() ? 1 : 0.4 }}>Charger ce code</button>
        {msg && <span style={{ color: '#e8c76a', fontSize: '0.85em' }}>{msg}</span>}
      </div>
      <div style={{ fontSize: '0.75em', color: '#8c8372', marginTop: 6 }}>Charger une sauvegarde remplace la partie en cours.</div>
    </div>
  );
};

/* ============================================================
   PETITS COMPOSANTS D'AFFICHAGE
   ============================================================ */
const Bar = ({ value, max, color, height = 6 }) => (
  <div style={{ width: '100%', height, background: '#e3dac2', borderRadius: 3, overflow: 'hidden' }}>
    <div style={{ width: `${Math.max(0, Math.min(100, (value / Math.max(max, 1e-9)) * 100))}%`, height: '100%', background: color, borderRadius: 3, transition: 'width var(--tick, 1000ms) linear, background-color 0.4s' }} />
  </div>
);
/* ============================================================
   ICÔNES DE LA MAISON : trait fin (1,5) en couleur du texte, avec un lavis doré (Art déco)
   Dessinées sur une grille de 24. Elles remplacent les émojis dans les titres, onglets et boutons.
   ============================================================ */
const GOLD_WASH = '#c9a24b';
const gearPath = (() => {
  const pts = []; const n = 8;
  for (let i = 0; i < n * 2; i++) {
    const a0 = (i / (n * 2)) * Math.PI * 2; const r = i % 2 === 0 ? 9 : 7;
    [-0.17, 0.17].forEach((d) => pts.push([12 + r * Math.cos(a0 + d), 12 + r * Math.sin(a0 + d)]));
  }
  return 'M' + pts.map((p) => p.map((v) => v.toFixed(2)).join(' ')).join('L') + 'Z';
})();
// Chaque icône : [traits, lavis doré] (chemins SVG)
const ICONS = {
  usine:      ['M2 20h20M3 20V10l5 3V10l5 3V10l5 3V5h3v15M7 17h2M12 17h2M17 17h2', 'M18 5h3v15h-3zM3 10l5 3v7H3z'],
  entrepot:   ['M2 20h20M3 20V9l9-5 9 5v11M7 20v-7h10v7M7 16.5h10', 'M3 9l9-5 9 5z'],
  globe:      ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 3c-2.8 2.5-4 5.6-4 9s1.2 6.5 4 9M12 3c2.8 2.5 4 5.6 4 9s-1.2 6.5-4 9M3.5 9h17M3.5 15h17', 'M12 3c-2.8 2.5-4 5.6-4 9s1.2 6.5 4 9c2.8-2.5 4-5.6 4-9s-1.2-6.5-4-9z'],
  reseau:     ['M12 7.5V11M12 11l-5.2 4.6M12 11l5.2 4.6M12 2.8a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6zM5 15.2a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6zM19 15.2a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6z', 'M12 2.8a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6zM5 15.2a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6zM19 15.2a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6z'],
  erlen:      ['M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3', 'M7.2 15h9.6l2 3.6a1 1 0 0 1-.9 1.4H6.1a1 1 0 0 1-.9-1.4z'],
  porte_voix: ['M3 10v4h3l8 5V5L6 10zM17 9.5a3.5 3.5 0 0 1 0 5M19.5 7a7 7 0 0 1 0 10', 'M6 10l8-5v14l-8-5z'],
  barres:     ['M4 3v17h17M8 20v-6M12.5 20v-10M17 20V6', 'M15.5 6h3v14h-3z'],
  livre:      ['M12 6.5C10 5 7 4.5 4 5v14c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v14', 'M4 5c3-.5 6 0 8 1.5v14C10 19 7 18.5 4 19z'],
  carton:     ['M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9M8 5.2l8 4.5', 'M12 3l8 4.5-8 4.5-8-4.5z'],
  camion:     ['M2 6.5h11v9.5H2zM13 9.5h4.2l3.3 3.5v3H13M4.5 17.5a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M15 17.5a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0', 'M2 6.5h11v9.5H2z'],
  grue:       ['M7 21V4M3.5 21h7M7 4h14M7 8l4-4M18 4v5M16.5 9h3v2.5h-3zM4 4h3', 'M16.5 9h3v2.5h-3z'],
  ancre:      ['M12 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM12 7v14M8 11h8M4 14a8 8 0 0 0 16 0M2.5 15.5L4 14l1.5 1.5M18.5 15.5L20 14l1.5 1.5', 'M12 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4z'],
  robot:      ['M7 8h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM12 8V5M12 3.2a1 1 0 1 0 0 2a1 1 0 1 0 0-2zM9.5 16.5h5M3 13v3M21 13v3', 'M9.5 11.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4zM14.5 11.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4z'],
  avion:      ['M21 15.5l-8-4.5V5a1.5 1.5 0 0 0-3 0v6l-8 4.5V17l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-4.5l8 2.5z', 'M10 11l-8 4.5V17l8-2.5zM13 11l8 4.5V17l-8-2.5z'],
  navire:     ['M3 15h18l-2.5 5h-13zM6 15V9.5h12V15M10 9.5V5.5h4v4M2 22c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1', 'M3 15h18l-2.5 5h-13z'],
  cadenas:    ['M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3M12 15v2.5', 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z'],
  panier:     ['M3.5 10h17l-1.8 10H5.3zM8 10l3.2-6M16 10l-3.2-6M9 13.5v3.5M12 13.5v3.5M15 13.5v3.5', 'M3.5 10h17l-.6 3.3H4.1z'],
  cycle:      ['M4 12a8 8 0 0 1 13.7-5.6M18 3v4h-4M20 12a8 8 0 0 1-13.7 5.6M6 21v-4h4', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'],
  disquette:  ['M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7', 'M8 14h8v7H8z'],
  coche:      ['M5 12.5l4.5 4.5L19 7', ''],
  fiole:      ['M10 3h4v3h-4zM10 6v2M14 6v2M8 8h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z', 'M6 14h12v5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z'],
  boussole:   ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM15.5 8.5l-2 5-5 2 2-5z', 'M15.5 8.5l-2 5-3-3z'],
  balance:    ['M12 5v15M8 20h8M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0zM12 2.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4z', 'M2 13a3 3 0 0 0 6 0zM16 13a3 3 0 0 0 6 0z'],
  cuve:       ['M6 5c0-1.1 2.7-2 6-2s6 .9 6 2v13c0 1.1-2.7 2-6 2s-6-.9-6-2zM6 5c0 1.1 2.7 2 6 2s6-.9 6-2M8 20v2M16 20v2', 'M6 11c0 1.1 2.7 2 6 2s6-.9 6-2v7c0 1.1-2.7 2-6 2s-6-.9-6-2z'],
  reception:  ['M4 13l2.5-8h11l2.5 8v6.5H4zM4 13h4.5a3.5 3.5 0 0 0 7 0H20M12 4v6M9.5 7.5L12 10l2.5-2.5', 'M4 13h4.5a3.5 3.5 0 0 0 7 0H20v6.5H4z'],
  cle:        ['M14.7 6.3a4 4 0 0 0-5.4 5.2L3.5 17.3a1.4 1.4 0 0 0 2 2l5.8-5.8a4 4 0 0 0 5.2-5.4l-2.4 2.4-2-.5-.5-2z', 'M3.5 17.3l2 2 3-3-2-2z'],
  engrenage:  [gearPath + 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'],
  sablier:    ['M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9', 'M9 20c0-2 3-3 3-4.5 0 1.5 3 2.5 3 4.5z'],
  chrono:     ['M12 5a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 13V9M10 2.5h4M18.5 5.5L20 4', 'M12 13V5a8 8 0 0 1 8 8z'],
  alerte:     ['M12 3.5l9.5 17h-19zM12 10v4.5M12 17.3v.4', 'M12 3.5l9.5 17h-19z'],
  feuille:    ['M5 19c0-8.5 5.5-14 15-14 0 9.5-5.5 15-14 15M5 19l8.5-8.5', 'M5 19c0-8.5 5.5-14 15-14 0 9.5-5.5 15-14 15z'],
  presse:     ['M7 4H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1M9 2.5h6v3H9zM8 11h8M8 14.5h8M8 18h5', 'M9 2.5h6v3H9z'],
  cible:      ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z', 'M12 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z'],
  interdit:   ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM7.5 12h9', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z'],
  parfum:     ['M11 2.5h2v2.5h-2zM9 5h6v3H9zM6.5 8h11l1.5 4v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7zM8.5 12.5v4', 'M5 12h14v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z'],
  pot:        ['M6 5h12v4H6zM5 9h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM9 14h6', 'M6 5h12v4H6z'],
  rouge:      ['M8.5 21h7v-9h-7zM9.5 12V7l5-3v8M7.5 21h9', 'M9.5 7l5-3v8h-5z'],
  diamant:    ['M6 4h12l4 5-10 12L2 9zM2 9h20M9 4l-2 5 5 12 5-12-2-5', 'M6 4h12l4 5H2z'],
  cadeau:     ['M4.5 10h15v11h-15zM3 7h18v3H3zM12 7v14M12 7c-1.5-3.5-6-3.5-5.5-1.2C7 7 10.5 7 12 7zM12 7c1.5-3.5 6-3.5 5.5-1.2C17 7 13.5 7 12 7z', 'M3 7h18v3H3z'],
  repere:     ['M12 21.5s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 6.8a2.7 2.7 0 1 0 0 5.4a2.7 2.7 0 1 0 0-5.4z', 'M12 6.8a2.7 2.7 0 1 0 0 5.4a2.7 2.7 0 1 0 0-5.4z'],
  chariot:    ['M2.5 4h2.5l2.2 11.5h10.6l2.2-8.5H6.2M8.5 19.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M15.5 19.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0', 'M6.2 7h14.3l-2.2 8.5H7.8z'],
  contrat:    ['M6 3h9l4 4v14H6zM15 3v4h4M9 11.5h7M9 15h7M9 18.5h3.5', 'M15 3v4h4z'],
  agenda:     ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2', 'M5 5h14a2 2 0 0 1 2 2v3H3V7a2 2 0 0 1 2-2z'],
  corbeille:  ['M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6', 'M6 7h12l-1 14H7z'],
  piece:      ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM14.5 9.3a3.2 3.2 0 1 0 0 5.4M8.5 11h5M8.5 13h5', 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z'],
  registre:   ['M6 3h13v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 3v18M11 8h5M11 11.5h5', 'M4 5a2 2 0 0 1 2-2h2v18H6a2 2 0 0 1-2-2z'],
  sac:        ['M5 8h14l-1 13H6zM9 8V6.5a3 3 0 0 1 6 0V8M9 11.5a3 3 0 0 0 6 0', 'M5 8h14l-.3 4H5.3z'],
  flamme:     ['M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10.5-2 2-3 4-3 6.5-1-1-1.5-2-1.5-3C7 10 6 12.5 6 15a6 6 0 0 0 6 6z', 'M12 21a3 3 0 0 0 3-3c0-2-1.5-3-2-5-1 1-1.5 2-1.5 3.2-.6-.5-.9-1-.9-1.6C9.5 15.5 9 16.8 9 18a3 3 0 0 0 3 3z'],
  eclat:      ['M11 3c.8 4.5 2.5 6.2 7 7-4.5.8-6.2 2.5-7 7-.8-4.5-2.5-6.2-7-7 4.5-.8 6.2-2.5 7-7zM18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z', 'M11 3c.8 4.5 2.5 6.2 7 7-4.5.8-6.2 2.5-7 7-.8-4.5-2.5-6.2-7-7 4.5-.8 6.2-2.5 7-7z'],
  ecran:      ['M4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6zM9 21h6M12 18v3M8 3l4 3 4-3', 'M5 8h14v8H5z'],
  mobile:     ['M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2', 'M7 6h10v10H7z'],
  courbe:     ['M3 20h18M4 16l5-5 4 3 7-8M15 6h5v5', 'M4 16l5-5 4 3 7-8v14H4z'],
  plus:       ['M12 5v14M5 12h14', ''],
  equipe:     ['M9 5a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM3 20a6 6 0 0 1 12 0M16.5 6.5a2.5 2.5 0 1 1 0 5M17 14.5a5 5 0 0 1 4.5 5', 'M9 5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'],
  recu:       ['M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 11.5h6M9 15h3.5', 'M6 3h12v3H6z'],
  barriere:   ['M3 8h18v6H3zM7 8l-3 6M12.5 8l-3 6M18 8l-3 6M6 14v6M18 14v6M4.5 20h3M16.5 20h3', 'M3 8h18v6H3z'],
  loupe:      ['M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13zM15.5 15.5L21 21', 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z'],
  journal:    ['M4 5h13v15H6a2 2 0 0 1-2-2zM17 9h3v9a2 2 0 0 1-2 2M7 8.5h7M7 12h7M7 15.5h4', 'M7 8.5h7v1.5H7z'],
  eclair:     ['M13 2.5L5 13.5h6l-1 8 8-11h-6z', 'M13 2.5L5 13.5h6l-1 8 8-11h-6z'],
  ampoule:    ['M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z'],
  convoyeur:  ['M3 15h18M5 18.5a1.5 1.5 0 1 0 0-.01M12 18.5a1.5 1.5 0 1 0 0-.01M19 18.5a1.5 1.5 0 1 0 0-.01M5 15V9h5v6M13 15v-4h5v4', 'M5 9h5v6H5zM13 11h5v4h-5z'],
  pause:      ['M9 5v14M15 5v14', ''],
  lecture:    ['M7 4.5v15l12-7.5z', 'M7 4.5v15l12-7.5z'],
  rideau:     ['M4 4h16M6 4v16M18 4v16M6 8c3 2 9 2 12 0', 'M6 4h12v4c-3 2-9 2-12 0z'],
  trophee:    ['M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 21h7M9.5 17h5v4h-5z', 'M8 4h8v5a4 4 0 0 1-8 0z'],
  lune:       ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z', 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  fusee:      ['M12 3c3 2.5 4.5 6 4.5 10l-2 3h-5l-2-3C7.5 9 9 5.5 12 3zM9.5 16l-2.5 3 1 2 2-2M14.5 16l2.5 3-1 2-2-2M12 9.2a1.3 1.3 0 1 0 0 2.6a1.3 1.3 0 1 0 0-2.6z', 'M12 3c3 2.5 4.5 6 4.5 10H7.5C7.5 9 9 5.5 12 3z'],
};
// Émoji → icône (les drapeaux et les émojis rares restent tels quels)
const EMOJI_ICON = {
  '🏭': 'usine', '🏢': 'entrepot', '🌐': 'globe', '🌍': 'reseau', '🧪': 'erlen', '📢': 'porte_voix', '📣': 'porte_voix', '📊': 'barres',
  '📘': 'livre', '📦': 'carton', '🚛': 'camion', '🚚': 'camion', '🏗': 'grue', '⚓': 'ancre', '🤖': 'robot', '🛬': 'avion', '🛫': 'avion',
  '✈': 'avion', '🚢': 'navire', '🔒': 'cadenas', '🧺': 'panier', '🔁': 'cycle', '🔄': 'cycle', '💾': 'disquette', '✔': 'coche', '✅': 'coche',
  '🍾': 'fiole', '🧭': 'boussole', '⚖': 'balance', '🛢': 'cuve', '📥': 'reception', '🔧': 'cle', '🛠': 'cle', '⚙': 'engrenage', '⏳': 'sablier',
  '⏱': 'chrono', '⚠': 'alerte', '🚨': 'alerte', '🌱': 'feuille', '📋': 'presse', '🎯': 'cible', '⛔': 'interdit', '🌸': 'parfum', '🧴': 'pot',
  '💄': 'rouge', '💎': 'diamant', '🎁': 'cadeau', '🛰': 'repere', '📍': 'repere', '🛒': 'chariot', '📝': 'contrat', '🗓': 'agenda', '📅': 'agenda',
  '🗑': 'corbeille', '💶': 'piece', '💰': 'piece', '📒': 'registre', '🛍': 'sac', '🔥': 'flamme', '✨': 'eclat', '📺': 'ecran', '🖥': 'ecran',
  '💻': 'ecran', '📱': 'mobile', '📈': 'courbe', '➕': 'plus', '👥': 'equipe', '👷': 'equipe', '🧾': 'recu', '🚧': 'barriere', '🔎': 'loupe',
  '📰': 'journal', '⚡': 'eclair', '💡': 'ampoule', '⏸': 'pause', '▶': 'lecture', '🏆': 'trophee', '🌙': 'lune', '🚀': 'fusee',
};
const Ico = ({ n, size = '1.3em', style }) => {
  const d = ICONS[n]; if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ display: 'inline-block', verticalAlign: '-0.2em', flex: '0 0 auto', overflow: 'visible', ...style }}>
      {d[1] && <path d={d[1]} fill={GOLD_WASH} fillOpacity="0.32" stroke="none" />}
      <path d={d[0]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};
const EMOJI_RE = new RegExp(`(${Object.keys(EMOJI_ICON).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\uFE0F? ?`, 'gu');
// Remplace les émojis connus d'un texte (ou des textes directs d'un groupe d'enfants) par les icônes de la maison
const deco = (node) => {
  if (typeof node === 'string') {
    if (!EMOJI_RE.test(node)) return node;
    EMOJI_RE.lastIndex = 0;
    const out = []; let last = 0; let m; let k = 0;
    while ((m = EMOJI_RE.exec(node))) {
      if (m.index > last) out.push(node.slice(last, m.index));
      const spaced = m[0].endsWith(' ');
      out.push(<Ico key={`i${k++}`} n={EMOJI_ICON[m[1]]} style={{ marginRight: spaced ? '0.4em' : 0 }} />);
      last = m.index + m[0].length;
    }
    if (last < node.length) out.push(node.slice(last));
    return out;
  }
  if (Array.isArray(node)) return node.map((c, i) => (typeof c === 'string' ? <React.Fragment key={`d${i}`}>{deco(c)}</React.Fragment> : c));
  return node;
};

// Montant qui défile doucement vers sa nouvelle valeur
const useRolling = (target, ms = 600) => {
  const [v, setV] = useState(target); const from = useRef(target); const raf = useRef(0);
  useEffect(() => {
    const start = performance.now(); const a = from.current; const b = target;
    if (Math.abs(b - a) < 1) { from.current = b; setV(b); return undefined; }
    const step = (now) => { const k = Math.min(1, (now - start) / ms); const e = 1 - Math.pow(1 - k, 3); const x = a + (b - a) * e; from.current = x; setV(x); if (k < 1) raf.current = requestAnimationFrame(step); };
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return v;
};
const Stepper = ({ label, display, onMinus, onPlus }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
    <span style={{ fontSize: '0.75em', color: '#6f6757' }}>{deco(label)}</span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={onMinus} className="step" style={freqQtyBtnStyle}>-</button>
      <strong style={{ fontSize: '0.85em', minWidth: 55, textAlign: 'center' }}>{display}</strong>
      <button onClick={onPlus} className="step" style={freqQtyBtnStyle}>+</button>
    </div>
  </div>
);
const Card = ({ title, children, right }) => (
  <div className="card" style={{ background: '#ffffff', padding: 18, borderRadius: 10, border: '1px solid #ebe2c9', boxShadow: 'inset 0 2px 0 #c9a24b, 0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.04)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #f0e9d6', gap: 8, flexWrap: 'wrap' }}>
      <h4 style={{ margin: 0, color: '#111111', display: 'flex', alignItems: 'center' }}><span style={{ color: '#a8842c', display: 'contents' }}>{deco(title)}</span></h4>
      {right}
    </div>
    {children}
  </div>
);
const Hint = ({ children }) => {
  const [open, setOpen] = useState(false);
  return <div className={`hint${open ? ' open' : ''}`} onClick={() => setOpen(!open)} style={{ fontSize: '0.76em', color: '#5f584a', background: '#faf8f3', borderLeft: '3px solid #c9a24b', borderRadius: '0 8px 8px 0', padding: '7px 12px', marginBottom: 12 }}>{deco(children)}</div>;
};
// Hiérarchie des boutons : doré = investissement (le bouton dépense de l'argent), noir = action principale,
// contour = action secondaire, rouge = supprimer / résilier
const textOf = (n) => (n == null || typeof n === 'boolean' ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(textOf).join('') : n.props ? textOf(n.props.children) : '');
const BTN_KINDS = {
  invest: { background: 'linear-gradient(180deg, #dcbb68 0%, #b8902f 100%)', color: '#111111', border: '1px solid #a8842c', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(120,90,20,0.25)' },
  dark:   { background: '#151515', color: '#ffffff', border: '1px solid #151515', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' },
  ghost:  { background: '#ffffff', color: '#111111', border: '1px solid #d6c592', boxShadow: 'none' },
  red:    { background: '#ffffff', color: '#a4262c', border: '1px solid #c98a8d', boxShadow: 'none' },
  green:  { background: 'linear-gradient(180deg, #3a8a64 0%, #2f7a57 100%)', color: '#ffffff', border: '1px solid #276a4a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2), 0 1px 2px rgba(20,80,50,0.25)' },
};
// Pourcentage qui défile en continu entre deux minutes de jeu (même durée que l'animation des barres).
let TICK_MS = 1000;
const SmoothPct = ({ value }) => {
  const [shown, setShown] = React.useState(value);
  const from = React.useRef(value);
  React.useEffect(() => {
    const start = from.current;
    if (value < start || typeof window === 'undefined' || !window.requestAnimationFrame) { from.current = value; setShown(value); return undefined; }
    const t0 = performance.now(); const dur = TICK_MS; let raf;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); const v = start + (value - start) * k; from.current = v; setShown(v); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{Math.round(shown * 100)}%</>;
};
const Btn = ({ onClick, children, kind = 'dark', disabled, style, title }) => {
  const k = kind === 'red' ? 'red' : kind === 'ghost' ? 'ghost' : /€/.test(textOf(children)) ? 'invest' : kind === 'green' ? 'green' : 'dark';
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{ ...actionBtnStyle, ...BTN_KINDS[k], fontSize: '0.78em', padding: '6px 11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0, opacity: disabled ? 0.45 : 1, ...style }}>
      {deco(children)}
    </button>
  );
};

const CompRow = ({ g, dispatch, id, per, fid }) => {
  const c = COMPONENTS[id];
  const stock = g.components[id];
  const inT = pendingOf(g, id);
  const cmax = maxOf(g, id);
  const lt = leadTimeOf(g, id);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2.2fr) minmax(0,1.8fr) auto', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid #f1ede2' }}>
      <div style={{ fontSize: '0.82em' }}>
        {deco(c.icon)} {c.name}
        <div style={{ fontSize: '0.8em', color: lt > c.leadTime ? '#a4262c' : '#8c8372' }}>{per} · délai {fmtT(lt)} · {c.cost} €/u</div>
      </div>
      <div>
        <Bar value={stock} max={cmax} color={stock < cmax * 0.15 ? '#a4262c' : '#a8842c'} />
        <div style={{ fontSize: '0.7em', color: '#6f6757', marginTop: 2 }}>
          {Math.floor(stock)} / {cmax}{inT > 0 && <span style={{ color: '#b8902f' }}> (+{inT} en route)</span>}
        </div>
      </div>
      <Btn kind="gold" onClick={() => dispatch({ type: 'ORDER_COMPONENT', fid, comp: id })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>
        +{c.lot} ({eur(c.lot * c.cost)})
      </Btn>
    </div>
  );
};

const LUXE_CSS = `
.lx h2, .lx h3, .lx h4 { font-family: Didot, "Bodoni MT", "Playfair Display", Georgia, serif; font-weight: 500; }
.lx h4 { font-size: 0.82em; letter-spacing: 0.14em; text-transform: uppercase; }
.lx button { font-family: inherit; cursor: pointer; border-radius: 6px; }
.lx select, .lx input, .lx textarea { border-radius: 6px; }
.lx button { transition: transform 0.12s ease, filter 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease; }
.lx button:not(:disabled):active { transform: translateY(1px) scale(0.98); }
.lx .card { transition: box-shadow 0.25s ease, transform 0.25s ease; }
.lx .card:hover { box-shadow: inset 0 2px 0 #c9a24b, 0 2px 4px rgba(17,17,17,0.05), 0 10px 26px rgba(17,17,17,0.07) !important; }
.lx .hint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: help; transition: background-color 0.2s ease; }
.lx .hint:hover, .lx .hint.open { white-space: normal; overflow: visible; background-color: #f6f1e4 !important; }
@keyframes lxfade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes lxtoast { from { opacity: 0; transform: translate(-50%, 14px); } to { opacity: 1; transform: translate(-50%, 0); } }
.lx .tabfade { animation: lxfade 0.35s ease both; }
.lx .toast { animation: lxtoast 0.35s cubic-bezier(.2,.8,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .lx *, .lx *::before, .lx *::after { animation: none !important; transition: none !important; } }
.lx button:not(:disabled):hover { filter: brightness(1.12); }
.lx button:disabled { cursor: not-allowed; }
.lx .g2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
.lx .g3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
@keyframes lxpulse { 0%,100% { box-shadow: 0 0 0 0 rgba(201,162,75,0.0); } 50% { box-shadow: 0 0 0 4px rgba(201,162,75,0.45); } }
.lx .pulse { animation: lxpulse 1.6s ease-in-out infinite; }
.lx { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; box-sizing: border-box; }
.lx *, .lx *::before, .lx *::after { box-sizing: inherit; }
.lx img, .lx canvas, .lx table { max-width: 100%; }
.lx .tabbar::-webkit-scrollbar, .lx .chips::-webkit-scrollbar { display: none; }
@media (max-width: 720px), (max-height: 500px) {
  .lx { padding: 0 8px calc(74px + env(safe-area-inset-bottom)) 8px !important; }
  .lx main { padding: 10px !important; min-height: 0 !important; }
  .lx .card { padding: 12px !important; }
  .lx .g2:not(.keep) { grid-template-columns: minmax(0, 1fr) !important; gap: 10px; }
  .lx .g3 { gap: 10px; }
  .lx .chips { flex-wrap: nowrap !important; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; margin-left: -10px !important; margin-right: -10px !important; padding: 0 10px 2px 10px; }
  .lx .chips > button { flex: 0 0 auto; white-space: nowrap; }
  .lx select, .lx input { font-size: 16px !important; }
  .lx h3 { font-size: 1.1em; }
}
@media (pointer: coarse) {
  .lx button { min-height: 34px; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .lx button.step { width: 34px !important; height: 34px !important; min-height: 34px; }
  .lx button:not(:disabled):hover { filter: none; }
}
`;

/* Téléphone ou ordinateur : mise en page téléphone sous 720 px de large (ou 500 px de haut, téléphone à l'horizontale) */
const MOBILE_QUERY = '(max-width: 720px), (max-height: 500px)';
const useIsMobile = () => {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(MOBILE_QUERY);
    const h = () => setM(mq.matches);
    h();
    if (mq.addEventListener) mq.addEventListener('change', h); else mq.addListener(h);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', h); else mq.removeListener(h); };
  }, []);
  return m;
};
const TOAST_COLORS = { error: '#a4262c', info: '#b4531a', success: '#2f7a57' };

/* ============================================================
   POPUPS : accueil, objectif atteint, événement, confirmation
   ============================================================ */
const Modal = ({ children }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,11,11,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40, padding: 'max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)) 12px' }}>
    <div style={{ background: '#ffffff', maxWidth: 560, width: '100%', maxHeight: '88vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid #c9a24b', borderTop: '3px solid #111111', padding: 'clamp(16px, 4vw, 24px)', boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>
      {children}
    </div>
  </div>
);
const PopupView = ({ popup, dispatch }) => {
  const close = <div style={{ textAlign: 'right', marginTop: 18 }}><Btn kind="dark" onClick={() => dispatch({ type: 'CLOSE_POPUP' })}>Continuer ▶</Btn></div>;
  if (popup.kind === 'welcome') {
    return (
      <Modal>
        <div style={{ fontSize: '0.7em', letterSpacing: 4, color: '#a8842c', textTransform: 'uppercase' }}>{BRAND.house} · Prise de poste</div>
        <h2 style={{ margin: '6px 0 12px 0' }}>Bienvenue, Directeur Supply Chain</h2>
        <p style={{ fontSize: '0.9em', color: '#3a352c', lineHeight: 1.5 }}>
          {BRAND.welcome}
          Votre mission : faire grandir la chaîne, de la matière première jusqu'aux boutiques du monde entier.
        </p>
        <p style={{ fontSize: '0.9em', color: '#3a352c', lineHeight: 1.5 }}>
          Les nouveaux métiers se débloquent au fil des <strong>objectifs</strong> (bandeau doré en haut). Chaque étape s'accompagne d'une fiche
          « Dans la vraie vie » que vous retrouverez dans l'onglet <strong>Guide</strong>.
        </p>
        <p style={{ fontSize: '0.82em', color: '#6f6757' }}>Le jeu est en pause tant qu'une fenêtre est ouverte. 1 seconde réelle = 1 minute de jeu.</p>
        {close}
      </Modal>
    );
  }
  if (popup.kind === 'event') {
    return (
      <Modal>
        <div style={{ fontSize: '0.7em', letterSpacing: 4, color: '#a4262c', textTransform: 'uppercase' }}>Aléa</div>
        <h2 style={{ margin: '6px 0 12px 0' }}>{popup.title}</h2>
        <p style={{ fontSize: '0.9em', color: '#3a352c', lineHeight: 1.5 }}>{popup.text}</p>
        {close}
      </Modal>
    );
  }
  const m = MILESTONES.find((x) => x.id === popup.id);
  return (
    <Modal>
      <div style={{ fontSize: '0.7em', letterSpacing: 4, color: '#2f7a57', textTransform: 'uppercase' }}>Chapitre {m.chapter} · {CHAPTERS[m.chapter]} · Objectif atteint</div>
      <h2 style={{ margin: '6px 0 4px 0' }}>🎉 {m.title}</h2>
      {m.reward > 0 && <div style={{ fontSize: '0.85em', color: '#a8842c', marginBottom: 12 }}>Prime de la direction : <strong>+{eur(m.reward)}</strong></div>}
      <div style={{ background: '#faf8f3', borderLeft: '3px solid #c9a24b', padding: '10px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: '0.7em', letterSpacing: 2, textTransform: 'uppercase', color: '#a8842c', marginBottom: 4 }}>{deco('📘 ')}Dans la vraie vie · {m.lesson[0]}</div>
        <div style={{ fontSize: '0.86em', color: '#3a352c', lineHeight: 1.5 }}>{m.lesson[1]}</div>
      </div>
      {m.unlocks.length > 0 && (
        <div>
          <div style={{ fontSize: '0.75em', letterSpacing: 2, textTransform: 'uppercase', color: '#111', marginBottom: 6 }}>Nouveau</div>
          {m.unlocks.map((k) => (
            <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: '0.85em', padding: '4px 0', borderBottom: '1px solid #f1ede2' }}>
              <span>{FEATURE_INFO[k][0]}</span>
              <span><strong>{FEATURE_INFO[k][1]}</strong> <span style={{ color: '#6f6757' }}>— {FEATURE_INFO[k][2]}</span></span>
            </div>
          ))}
        </div>
      )}
      {close}
    </Modal>
  );
};
const ConfirmView = ({ ask, onClose }) => (
  <Modal>
    <p style={{ fontSize: '0.95em', margin: '0 0 18px 0' }}>{ask.msg}</p>
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <Btn kind="ghost" onClick={onClose}>Annuler</Btn>
      <Btn kind="dark" onClick={() => { ask.yes(); onClose(); }}>Confirmer</Btn>
    </div>
  </Modal>
);

/* Bandeau d'objectif */
const ObjectiveBanner = ({ g, onGuide, mobile }) => {
  const [open, setOpen] = useState(false);
  const m = MILESTONES[g.msIndex];
  if (!m) {
    return (
      <div style={{ background: '#111', color: '#c9a24b', padding: '10px 16px', marginBottom: 16, fontSize: '0.85em', border: '1px solid #c9a24b' }}>
        🏆 Toutes les étapes sont franchies : vous êtes Directeur Supply Chain Monde. Optimisez service, coûts et stocks !
      </div>
    );
  }
  const [cur, target] = m.progress(g);
  const amount = target >= 1000 ? `${eur(Math.min(cur, target))} / ${eur(target)}` : `${Math.min(cur, target)} / ${target}`;
  if (mobile) {
    return (
      <div className="pulse" onClick={() => setOpen(!open)} style={{ background: '#111', color: '#fff', padding: '8px 12px', margin: '8px 0 10px 0', border: '1px solid #c9a24b', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.62em', letterSpacing: 2, color: '#c9a24b', whiteSpace: 'nowrap' }}>{deco('🎯 ')}{g.msIndex + 1}/{MILESTONES.length}</span>
          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '0.86em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</span>
          <span style={{ color: '#c9a24b', fontSize: '0.8em' }}>{open ? '▲' : '▼'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <div style={{ flex: 1 }}><Bar value={cur} max={target} color="#c9a24b" /></div>
          <span style={{ fontSize: '0.68em', color: '#c9a24b', whiteSpace: 'nowrap' }}>{amount}</span>
        </div>
        {open && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #3a3424' }}>
            <div style={{ fontSize: '0.62em', letterSpacing: 2, color: '#c9a24b', textTransform: 'uppercase', marginBottom: 4 }}>Chapitre {m.chapter} · {CHAPTERS[m.chapter]}</div>
            <div style={{ fontSize: '0.82em', color: '#d8cfb8', lineHeight: 1.4 }}>{m.goal}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
              <span style={{ fontSize: '0.74em', color: '#c9a24b' }}>Prime : {eur(m.reward)}</span>
              <button onClick={(e) => { e.stopPropagation(); onGuide(); }} style={{ ...actionBtnStyle, background: 'transparent', border: '1px solid #c9a24b', color: '#c9a24b', fontSize: '0.74em', padding: '6px 12px' }}>{deco('📘 ')}Guide</button>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="pulse" style={{ background: '#111', color: '#fff', padding: '10px 16px', marginBottom: 16, border: '1px solid #c9a24b', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ fontSize: '0.65em', letterSpacing: 3, color: '#c9a24b', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Chapitre {m.chapter} · {CHAPTERS[m.chapter]} · {g.msIndex + 1}/{MILESTONES.length}</div>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.92em' }}>{m.title}</div>
        <div style={{ fontSize: '0.78em', color: '#d8cfb8' }}>{m.goal}</div>
      </div>
      <div style={{ width: 160 }}>
        <div style={{ fontSize: '0.72em', color: '#c9a24b', textAlign: 'right', marginBottom: 3 }}>
          {amount} · prime {eur(m.reward)}
        </div>
        <Bar value={cur} max={target} color="#c9a24b" />
      </div>
      <button onClick={onGuide} style={{ ...actionBtnStyle, background: 'transparent', border: '1px solid #c9a24b', color: '#c9a24b', fontSize: '0.72em', padding: '4px 10px' }}>{deco('📘 ')}Guide</button>
    </div>
  );
};

/* ============================================================
   PANNEAU USINE
   ============================================================ */
const SUBTABS = [
  ['planning', '🗓 Planning', null],
  ['appro', '📦 Appro', 'appro'],
  ['process', '⚖️ Pesée & Cuve', null],
  ['cond', '🏭 Conditionnement', null],
  ['exp', '🚛 Expédition', 'exp'],
];

// Boutons d'achat d'un équipement, une taille par bouton (grisé si bâtiment trop petit ou plein)
const EquipBuy = ({ f, fid, kind, dispatch }) => {
  const E = EQUIP[kind]; const full = countOf(f, kind) >= capOf(f, kind); const zl = facLevel(f, zoneOf(kind));
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {E.tiers.map((T, t) => {
        const locked = zl < T.lvl;
        return (
          <Btn key={t} kind={t === 0 ? undefined : 'gold'} disabled={locked || full} title={locked ? `Zone ${ZONES[zoneOf(kind)].name.toLowerCase()} de niveau ${T.lvl} requise` : full ? 'Zone pleine : agrandissez ou remplacez' : `${T.name} : capacité ×${T.mult}`}
            onClick={() => dispatch({ type: 'BUY_EQUIP', fid, kind, tier: t })} style={{ fontSize: '0.68em', padding: '4px 7px', opacity: locked || full ? 0.45 : 1 }}>
            {locked ? '🔒 ' : '+ '}{T.name.replace(/^(Pesée|Ligne) /, '')} ×{T.mult} ({eur(T.cost)})
          </Btn>
        );
      })}
    </div>
  );
};
// Bouton « remplacer par plus gros » sur un équipement libre
const EquipUp = ({ f, fid, kind, cur, idx, lineId, free, dispatch }) => {
  const E = EQUIP[kind];
  const next = E.tiers.map((T, t) => [T, t]).filter(([T, t]) => t > cur && facLevel(f, zoneOf(kind)) >= T.lvl).pop();
  if (!next || !free) return null;
  const [T, t] = next; const net = T.cost - Math.round(E.tiers[cur].cost * EQUIP_REFUND);
  return <button onClick={() => dispatch({ type: 'REPLACE_EQUIP', fid, kind, tier: t, idx, lineId })} className="step" style={{ ...freqQtyBtnStyle, width: 'auto', padding: '0 6px', fontSize: '0.68em' }} title={`Remplacer par : ${T.name} (${eur(T.cost)}, reprise de l'ancien ${eur(Math.round(E.tiers[cur].cost * EQUIP_REFUND))})`}>⬆ {T.name} ({eur(net)})</button>;
};
// Bandeau du bâtiment : niveau, places occupées, travaux d'agrandissement
const BuildingBar = ({ g, f, fid, zone, dispatch }) => {
  const Z = ZONES[zone]; const lv = facLevel(f, zone); const L = levelDef(f, zone); const N = FACTORY_LEVELS[lv]; const w = f[Z.works];
  const cap = zone === 'fab' ? `pesées ${countOf(f, 'station')}/${L.st} · cuves ${countOf(f, 'tank')}/${L.tk}` : `lignes ${countOf(f, 'line')}/${L.ln}`;
  const capN = N ? (zone === 'fab' ? `${N.st} pesées et ${N.tk} cuves` : `${N.ln} lignes`) : '';
  return (
    <div style={{ background: '#faf8f3', borderLeft: '4px solid #c9a24b', padding: '8px 12px', marginBottom: 12, fontSize: '0.78em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span>{deco('🏗 ')}Zone {Z.name.toLowerCase()} : <strong>niveau {lv}/{FACTORY_LEVELS.length}</strong> · {cap}{zoneFixed(L, zone) > 0 && <span style={{ color: '#8c8372' }}> · frais fixes {eur(zoneFixed(L, zone))}/h</span>}</span>
      {w ? (
        <span style={{ minWidth: 200, flex: '0 1 260px' }}>
          <span style={{ color: '#b4531a' }}>{deco('🚧 ')}Travaux vers le niveau {w.to} : encore {fmtT(w.end - g.t)} ({Z.what} à {Math.round(WORKS_SPEED * 100)} %)</span>
          <Bar value={g.t - w.start} max={w.end - w.start} color="#b4531a" height={4} />
        </span>
      ) : N ? (
        g.msIndex < N.ms
          ? <span style={{ color: '#8c8372' }}>{deco('🔒 ')}Niveau {lv + 1} après l'objectif « {MILESTONES[N.ms - 1].title} »</span>
          : <Btn kind="gold" onClick={() => dispatch({ type: 'START_WORKS', fid, zone })} style={{ fontSize: '0.9em', padding: '4px 8px' }} title={`Jusqu'à ${capN}. Frais fixes ${eur(zoneFixed(N, zone))}/h.`}>{deco('🏗 ')}Agrandir au niveau {lv + 1} ({eur(zoneCost(N, zone))}, {fmtT(N.ticks)}) : {capN}</Btn>
      ) : <span style={{ color: '#2f7a57' }}>Taille maximale atteinte</span>}
    </div>
  );
};

const FactoryPanel = ({ g, dispatch, ui, setUi, ask }) => {
  const F = g.features;
  const fid = ui.fid;
  const def = FACTORY_DEFS[fid];
  const f = g.factories[fid];
  const visibleFactories = Object.keys(FACTORY_DEFS).filter((id) => g.factories[id].unlocked || F[`factory_${id}`]);

  const selector = visibleFactories.length > 1 && (
    <div className="chips" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
      {visibleFactories.map((id) => {
        const d = FACTORY_DEFS[id];
        return (
          <button key={id} onClick={() => setUi({ ...ui, fid: id })} style={{ ...actionBtnStyle, background: id === fid ? '#111111' : '#ffffff', color: id === fid ? '#c9a24b' : '#111111', border: `1px solid ${id === fid ? '#111111' : '#c9a24b'}`, fontSize: '0.85em' }}>
            {deco(d.icon)} {d.name} {!g.factories[id].unlocked && <Ico n="cadenas" style={{ marginLeft: 6 }} />}
          </button>
        );
      })}
    </div>
  );

  if (!f.unlocked) {
    return (
      <div>
        {selector}
        <div style={{ background: '#faf8f3', padding: 30, textAlign: 'center', border: '2px dashed #e3dac2' }}>
          <div style={{ fontSize: '2.5em' }}>{def.icon}</div>
          <h3 style={{ margin: '10px 0' }}>{def.name}</h3>
          <p style={{ color: '#6f6757', fontSize: '0.9em', margin: '0 0 6px 0' }}>Fabrique : {def.skus.map((k) => PRODUCT_SPECS[k].name).join(' et ')}.</p>
          <p style={{ color: '#6f6757', fontSize: '0.9em', margin: '0 0 16px 0' }}>
            Livrée avec 1 poste de pesée, 1 cuve, 1 ligne et un stock de démarrage. Dès l'ouverture, toutes vos filiales commanderont ces produits.
          </p>
          <Btn kind="green" onClick={() => dispatch({ type: 'BUY_FACTORY', fid })} style={{ fontSize: '0.9em', padding: '8px 16px' }}>Construire l'usine ({eur(def.buyCost)})</Btn>
        </div>
      </div>
    );
  }

  const subtabs = SUBTABS.filter(([, , feat]) => !feat || F[feat]);
  const sub = subtabs.some(([k]) => k === ui.sub) ? ui.sub : 'planning';
  const readyPallets = readyPalletsOf(g, fid);
  const running = f.lines.filter((l) => l.status === 'running' && !l.stall).length;
  const fk = kpiOf(sumStats(f.lines));
  const dockUnits = f.dock.reduce((a, d) => a + d.qty, 0);
  const freeAgents = Math.max(0, f.supplyStaff - countStage(f, 'kitting'));
  const flow = [
    ...(F.appro ? [['🚚 Quai', `${Math.floor(dockUnits)} u`, '#a8842c']] : []),
    ['📦 Kits', `${countStage(f, 'kitting') + countStage(f, 'kitted')} OF`, '#b4531a'],
    ['⚖️ Pesée', `${countStage(f, 'weighing')}/${f.stations}`, '#b8902f'],
    ['🛢 Cuves', `${countStage(f, 'mixing')}/${f.tanks}`, '#1a1a1a'],
    ['🏭 Lignes', `${running}/${f.lines.length}`, '#2f7a57'],
    ['🧾 Palettes prêtes', `${readyPallets}`, '#b4531a'],
  ];
  const perText = (id) => {
    if (def.raw[id]) return `×${def.raw[id]} / u de vrac`;
    if (id === 'PALETTE') return `1 / palette (${[...new Set(def.skus.map((k) => unitsPerPallet(k)))].join(' ou ')} u)`;
    if (id === def.carton) return `1 / carton (${[...new Set(def.skus.map((k) => PRODUCT_SPECS[k].unitsPerCarton))].join(' ou ')} u)`;
    return def.skus.filter((k) => PRODUCT_SPECS[k].comps[id]).map((k) => `${PRODUCT_SPECS[k].name} ×${PRODUCT_SPECS[k].comps[id]}`).join(', ');
  };
  const packIds = [...new Set(def.skus.flatMap((k) => Object.keys(PRODUCT_SPECS[k].comps)))];
  const ofSku = def.skus.includes(ui.ofSku) && g.launched[ui.ofSku] ? ui.ofSku : def.skus.find((k) => g.launched[k]) || def.skus[0];
  const maxPal = maxPalletsFor(g, fid, ofSku);
  const ofPallets = Math.max(MIN_ORDER_PALLETS, Math.min(ui.ofPallets, Math.max(maxPal, MIN_ORDER_PALLETS)));
  const plan = f.plan;
  const kit = contractKit(fid, plan.qty, g);
  const zoneCost = ZONE_COST * (f.zone + 1);
  const STAGE_IDX = { queued: 0, kitting: 1, kitted: 2, weighing: 3, weighed: 4, mixing: 5, mixed: 6, running: 7 };
  const NEXT_LABEL = { queued: '▶ Préparer le kit', kitted: '▶ Lancer la pesée', weighed: '▶ Lancer la cuve', mixed: '▶ Envoyer en ligne' };
  const stepsOf = (o) => {
    const i = STAGE_IDX[o.stage];
    const prog = o.maxTime > 0 ? (o.maxTime - o.timeLeft) / o.maxTime : 0;
    return [
      { label: '📦 Kit', state: i >= 2 ? 'done' : i === 1 ? 'active' : 'todo', prog },
      { label: '⚖️ Pesée', state: i >= 4 ? 'done' : i === 3 ? 'active' : 'todo', prog },
      { label: '🛢 Cuve', state: i >= 6 ? 'done' : i === 5 ? 'active' : 'todo', prog },
      { label: '🏭 Ligne', state: i === 7 ? 'active' : 'todo', prog: o.qty > 0 ? o.made / o.qty : 0 },
    ].map((st, k) => ({ ...st, waiting: ['queued', 'kitted', 'weighed', 'mixed'].includes(o.stage) && k === Math.floor(i / 2) }));
  };

  return (
    <div>
      {selector}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', background: '#faf8f3', padding: '10px 14px', marginBottom: 8 }}>
        {flow.map(([label, value, color], i) => (
          <React.Fragment key={label}>
            <div style={{ textAlign: 'center', minWidth: 70 }}>
              <div style={{ fontSize: '0.7em', color: '#6f6757' }}>{deco(label)}</div>
              <div style={{ fontWeight: 'bold', color, fontSize: '1.05em' }}>{value}</div>
            </div>
            {i < flow.length - 1 && <span style={{ color: '#b9ae93' }}>➔</span>}
          </React.Fragment>
        ))}
      </div>
      <div style={{ fontSize: '0.8em', color: '#6f6757', marginBottom: 14 }}>
        {deco('📊 ')}TRS usine <strong style={{ color: '#1a1a1a' }}>{pct(fk.trs)}</strong>
        <span style={{ color: '#8c8372' }}> (disponibilité {pct(fk.dispo)} · performance {pct(fk.perf)} · qualité {pct(fk.qual)})</span>
      </div>
      <div className="chips" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {subtabs.map(([key, label]) => (
          <button key={key} onClick={() => setUi({ ...ui, sub: key })} style={{ ...actionBtnStyle, background: sub === key ? '#111111' : 'transparent', color: sub === key ? '#c9a24b' : '#111111', border: `1px solid ${sub === key ? '#111111' : '#e6dcc0'}`, fontSize: '0.85em' }}>
            {deco(label)}
          </button>
        ))}
      </div>

      {sub === 'planning' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="g2">
            <Card title="🧭 Mode de planification">
              {!f.autoUnlocked ? (
                <div>
                  <div style={{ fontSize: '0.85em', fontWeight: 'bold', marginBottom: 6 }}>✋ Manuel</div>
                  <p style={{ margin: '0 0 10px 0', fontSize: '0.78em', color: '#6f6757' }}>Vous lancez chaque étape de chaque OF.</p>
                  {F.aps ? (
                    <Btn onClick={() => ask(`🤖 Installer la planification automatique ? Coût : ${eur(APS_COST)}.`, () => dispatch({ type: 'BUY_AUTO', fid }))} style={{ width: '100%' }}>
                      🤖 Installer la planification automatique ({eur(APS_COST)})
                    </Btn>
                  ) : <div style={{ fontSize: '0.72em', color: '#8c8372' }}>{deco('🔒 ')}La planification automatique se débloque au chapitre 3.</div>}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '0.85em', fontWeight: 'bold', marginBottom: 6, color: f.auto ? '#2f7a57' : '#b8902f' }}>
                    {deco(f.auto ? "🤖 Automatique : les OF s'enchaînent seuls" : 'Manuel (automatique en pause)')}
                  </div>
                  <Btn kind={f.auto ? 'ghost' : 'green'} onClick={() => dispatch({ type: 'TOGGLE_AUTO', fid })} style={{ width: '100%' }}>
                    {f.auto ? '✋ Repasser en manuel' : "🤖 Réactiver l'automatique"}
                  </Btn>
                </div>
              )}
              {F.sop && (
                <div style={{ borderTop: '1px solid #efe8d4', marginTop: 12, paddingTop: 10 }}>
                  {!f.sop.bought ? (
                    <div>
                      <div style={{ fontSize: '0.75em', color: '#6f6757', marginBottom: 8 }} title="Sales & Operations Planning : chaque mois, ventes, marketing et supply chain alignent prévisions et capacités.">
                        🧭 <strong>S&OP</strong> : les OF se créent seuls à partir de la demande prévue des filiales et du stock de tout le réseau.
                      </div>
                      <Btn onClick={() => dispatch({ type: 'BUY_SOP', fid })} style={{ width: '100%' }}>Installer le module S&OP ({eur(SOP_COST)})</Btn>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                        <span style={{ fontSize: '0.8em' }}>{deco('🧭 ')}OF automatiques (S&OP) : <strong style={{ color: f.sop.on ? '#2f7a57' : '#8c8372' }}>{f.sop.on ? 'actifs' : 'arrêtés'}</strong></span>
                        <Btn kind={f.sop.on ? 'ghost' : 'green'} onClick={() => dispatch({ type: 'TOGGLE_SOP', fid })}>{f.sop.on ? 'Arrêter' : 'Activer'}</Btn>
                      </div>
                      <Stepper label="Stock réseau visé :" display={fmtT(f.sop.cover)} onMinus={() => dispatch({ type: 'ADJUST_SOP', fid, amount: f.sop.cover > 720 ? -120 : -30 })} onPlus={() => dispatch({ type: 'ADJUST_SOP', fid, amount: f.sop.cover >= 720 ? 120 : 30 })} />
                      <div style={{ fontSize: '0.68em', color: '#8c8372', marginTop: -6 }}>Usine + transit + centrale, en temps de ventes des filiales. Trop haut : racks pleins. Trop bas : ruptures.</div>
                      <div style={{ fontSize: '0.7em', color: '#6f6757', marginTop: 8, background: '#faf8f3', padding: '6px 8px', lineHeight: 1.5 }}>
                        <div style={{ fontWeight: 600, color: '#111' }}>{deco('📋 ')}Revue S&OP toutes les {SOP_REVIEW} min{f.sop.on ? ` · prochaine dans ${SOP_REVIEW - f.sop.timer} min` : ''}</div>
                        {!f.sop.last && <div>Première revue en attente.</div>}
                        {(f.sop.last || []).map((r) => (
                          <div key={r.sku}>
                            <strong>{PRODUCT_SPECS[r.sku].name}</strong> : {r.act === 'nodemand' ? 'aucune filiale ne le vend encore'
                              : r.act === 'waiting' ? <span style={{ color: '#b4531a' }}>un OF attend déjà au planning (pas encore lancé), le S&OP n'en crée pas d'autre tant qu'il n'est pas démarré</span>
                              : r.act === 'created' ? <span style={{ color: '#2f7a57' }}>stock réseau {fmtT(Math.round(r.cover))} &lt; {fmtT(f.sop.cover)} visé → OF de {r.pallets} pal. créé</span>
                              : r.act === 'noroom' ? <span style={{ color: '#a4262c' }}>OF nécessaire mais la zone d'appro est trop petite pour un lot de {MIN_ORDER_PALLETS} pal.</span>
                              : <>stock réseau {fmtT(Math.round(r.cover))} ≥ {fmtT(f.sop.cover)} visé → pas besoin d'OF</>}
                          </div>
                        ))}
                        {!f.auto && <div style={{ marginTop: 4, color: '#8c8372' }}>En mode manuel, c'est à vous de lancer les OF créés (kit, pesée, cuve, ligne). Avec la planification automatique, ils s'enchaînent seuls.</div>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
            <Card title="➕ Nouvel ordre de fabrication">
              <p style={{ margin: '0 0 10px 0', fontSize: '0.78em', color: '#6f6757' }}>
                Un changement de référence sur une ligne coûte {eur(CHANGEOVER_COST)} et de {CHANGEOVER_TICKS} à {EQUIP.line.tiers[2].change} min selon la taille de la ligne.
              </p>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {def.skus.filter((sku) => g.launched[sku]).map((sku) => (
                  <button key={sku} title={skuTip(sku)} onClick={() => setUi({ ...ui, ofSku: sku })} style={{ ...actionBtnStyle, background: ofSku === sku ? '#111111' : '#ffffff', color: ofSku === sku ? '#c9a24b' : '#111111', border: `1px solid ${ofSku === sku ? '#111111' : '#c9a24b'}`, fontSize: '0.78em' }}>
                    {PRODUCT_SPECS[sku].name}
                  </button>
                ))}
                {F.launch && def.skus.some((sku) => !g.launched[sku]) && <span style={{ fontSize: '0.72em', color: '#8c8372', alignSelf: 'center' }}>Nouvelles références : onglet 🧪 Développement</span>}
              </div>
              <Stepper label="Taille :" display={`${ofPallets} pal. (${(ofPallets * unitsPerPallet(ofSku)).toLocaleString('fr-FR')} u)`}
                onMinus={() => setUi({ ...ui, ofPallets: Math.max(MIN_ORDER_PALLETS, ofPallets - ORDER_STEP) })}
                onPlus={() => setUi({ ...ui, ofPallets: Math.min(Math.max(maxPal, MIN_ORDER_PALLETS), ofPallets + ORDER_STEP) })} />
              <Btn kind="gold" onClick={() => dispatch({ type: 'CREATE_ORDER', fid, sku: ofSku, pallets: ofPallets })} style={{ width: '100%' }}>+ Ajouter au planning</Btn>
              <div style={{ fontSize: '0.72em', color: '#8c8372', marginTop: 6 }}>Taille maximale avec votre zone d'appro : <strong>{maxPal} palettes</strong>.</div>
            </Card>
          </div>
          <Card title={`🗓 Planning de l'usine (${f.queue.length} OF)`}>
            {f.queue.length === 0 ? (
              <div style={{ fontSize: '0.85em', color: '#8c8372', textAlign: 'center', padding: 14 }}>Aucun OF. Créez-en un ci-dessus.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {f.queue.map((o, idx) => {
                  const steps = stepsOf(o);
                  const canNext = NEXT_LABEL[o.stage];
                  const started = ['weighing', 'mixing', 'running'].includes(o.stage);
                  const ln = f.lines.find((l) => l.id === o.lineId);
                  return (
                    <div key={o.id} style={{ background: '#f1ede2', padding: 10, border: `1px solid ${o.wait ? '#b4531a' : '#e3dac2'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '0.88em' }}>
                          <strong>#{idx + 1}</strong> · <span title={skuTip(o.sku)} style={{ borderBottom: '1px dotted #b9ae93', cursor: 'help' }}>{PRODUCT_SPECS[o.sku].name}</span> — <strong>{o.pallets} pal.</strong>
                          <span style={{ color: '#6f6757' }}> ({o.qty.toLocaleString('fr-FR')} u)</span>
                          {ln && <span style={{ color: '#2f7a57' }}> · sur {ln.name}</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {canNext && !f.auto && (
                            <Btn kind="green" onClick={() => dispatch({ type: 'ADVANCE_ORDER', fid, orderId: o.id })} style={{ fontSize: '0.74em', padding: '4px 10px' }}>{NEXT_LABEL[o.stage]}</Btn>
                          )}
                          <button onClick={() => dispatch({ type: 'MOVE_ORDER', fid, orderId: o.id, dir: -1 })} disabled={idx === 0} className="step" style={{ ...freqQtyBtnStyle, opacity: idx === 0 ? 0.4 : 1 }}>↑</button>
                          <button onClick={() => dispatch({ type: 'MOVE_ORDER', fid, orderId: o.id, dir: 1 })} disabled={idx === f.queue.length - 1} className="step" style={{ ...freqQtyBtnStyle, opacity: idx === f.queue.length - 1 ? 0.4 : 1 }}>↓</button>
                          {!started && <span style={{ color: '#a4262c', cursor: 'pointer', fontWeight: 'bold', padding: '0 4px' }} onClick={() => dispatch({ type: 'CANCEL_ORDER', fid, orderId: o.id })}>✕</span>}
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 6 }}>
                        {steps.map((st, k) => {
                          const color = st.state === 'done' ? '#2f7a57' : st.state === 'active' ? '#a8842c' : st.waiting ? '#b4531a' : '#b9ae93';
                          return (
                            <div key={k} style={{ background: '#faf8f3', padding: '6px 8px', borderTop: `3px solid ${color}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72em', marginBottom: 4 }}>
                                <span>{st.label}</span>
                                <strong style={{ color }}>{st.state === 'done' ? '✔' : st.state === 'active' ? <SmoothPct value={st.prog} /> : st.waiting ? '⏳' : '—'}</strong>
                              </div>
                              <Bar value={st.state === 'done' ? 1 : st.state === 'active' ? st.prog : 0} max={1} color={color} height={4} />
                            </div>
                          );
                        })}
                      </div>
                      {o.wait && <div style={{ fontSize: '0.74em', color: '#b4531a', marginTop: 6 }}>{deco('⏳ ')}En attente : {o.wait}</div>}
                      {!o.wait && canNext && !f.auto && <div style={{ fontSize: '0.74em', color: '#6f6757', marginTop: 6 }}>Prêt : lancez l'étape suivante.</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {sub === 'appro' && (
        <div className="g2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Card title="🧪 Matières premières">{Object.keys(def.raw).map((id) => <CompRow key={id} g={g} fid={fid} dispatch={dispatch} id={id} per={perText(id)} />)}</Card>
            <Card title="🍾 Composants de conditionnement">{packIds.map((id) => <CompRow key={id} g={g} fid={fid} dispatch={dispatch} id={id} per={perText(id)} />)}</Card>
            <Card title="📦 Cartons & palettes">{[def.carton, 'PALETTE'].map((id) => <CompRow key={id} g={g} fid={fid} dispatch={dispatch} id={id} per={perText(id)} />)}</Card>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Card title="👷 Zone d'appro & personnel">
              <Stepper label={`Agents d'appro (${SUPPLY_STAFF_COST} €/h) :`} display={`${f.supplyStaff} (${freeAgents} libre${freeAgents > 1 ? 's' : ''})`}
                onMinus={() => dispatch({ type: 'FIRE_SUPPLY', fid })} onPlus={() => dispatch({ type: 'HIRE_SUPPLY', fid })} />
              <div style={{ fontSize: '0.72em', color: '#6f6757', marginBottom: 10 }}>
                Un agent range {RECEIVE_RATE} u / tick depuis le quai et prépare les kits des OF. Sans agent libre, les livraisons attendent sur le quai.
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', marginBottom: 3 }}><span>{deco('🚚 ')}Quai de réception</span><strong>{Math.floor(dockUnits)} u en attente</strong></div>
              <Bar value={Math.min(dockUnits, 5000)} max={5000} color={dockUnits > 3000 ? '#a4262c' : '#a8842c'} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', margin: '12px 0 6px 0' }}><span>{deco('🏗 ')}Zone d'appro : niveau {f.zone}</span><strong>capacité ×{zoneMult(f).toFixed(1)}</strong></div>
              <Btn onClick={() => dispatch({ type: 'BUY_ZONE', fid })} style={{ width: '100%' }}>Agrandir la zone (+50 %) — {eur(zoneCost)}</Btn>
            </Card>
            {F.buyers && (
              <Card title={`🛒 Acheteurs (${f.buyers.length})`} right={<Btn onClick={() => dispatch({ type: 'HIRE_BUYER', fid })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>+ Recruter ({BUYER_COST} €/h)</Btn>}>
                <div style={{ fontSize: '0.74em', color: '#6f6757', marginBottom: 10 }}>
                  Un acheteur commande <strong>un lot toutes les {BUYER_PERIOD}s</strong> dès qu'un stock passe sous {Math.round(BUYER_TARGET * 100)} % de la zone.
                </div>
                {f.buyers.map((b, i) => (
                  <div key={b.id} style={{ background: '#f1ede2', padding: 8, marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78em', marginBottom: 5, gap: 6 }}>
                      <strong>Acheteur {i + 1}</strong>
                      <select value={b.focus} onChange={(e) => dispatch({ type: 'SET_BUYER_FOCUS', fid, buyerId: b.id, focus: e.target.value })} style={{ flex: 1, minWidth: 0, fontSize: '0.95em', padding: '2px 4px', border: '1px solid #c9a24b', background: '#ffffff', color: '#111111' }}>
                        <option value="AUTO">🎯 Auto : le stock le plus bas</option>
                        {factoryComps(fid).map((c) => <option key={c} value={c}>{COMPONENTS[c].icon} {COMPONENTS[c].name}</option>)}
                      </select>
                      <span style={{ color: '#a4262c', cursor: 'pointer', fontWeight: 'bold' }} onClick={() => dispatch({ type: 'FIRE_BUYER', fid, buyerId: b.id })}>✕</span>
                    </div>
                    <Bar value={b.timer} max={BUYER_PERIOD} color="#c9a24b" height={4} />
                    <div style={{ fontSize: '0.7em', color: '#6f6757', marginTop: 3 }}>{b.last || `Prochaine commande dans ${BUYER_PERIOD - b.timer}s`}</div>
                  </div>
                ))}
              </Card>
            )}
            <Card title="💶 Coût matière par unité">
              {def.skus.map((sku) => (
                <div key={sku} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', padding: '4px 0' }}>
                  <span>{PRODUCT_SPECS[sku].name}</span>
                  <span><strong>{unitCost(sku).toFixed(2)} €</strong> <span style={{ color: '#8c8372' }}>→ vendu {PRODUCT_SPECS[sku].sellingPricePerUnit} €</span></span>
                </div>
              ))}
            </Card>
            {F.contract && (
              <Card title="📝 Contrat d'appro automatique">
                {!plan.active ? (
                  <div>
                    <div style={{ fontSize: '0.75em', color: '#6f6757', marginBottom: 8 }}>Il commande tout un kit d'un coup (matières, composants, cartons, palettes), à intervalle régulier.</div>
                    <Btn onClick={() => ask(`📝 Signer le contrat ? Frais de mise en service : ${eur(CONTRACT_SIGN_COST)}.`, () => dispatch({ type: 'ACTIVATE_CONTRACT', fid }))} style={{ width: '100%' }}>Signer le contrat ({eur(CONTRACT_SIGN_COST)})</Btn>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                      <span style={{ fontSize: '0.8em', color: '#2f7a57', fontWeight: 'bold' }}>{deco('🔄 ')}Contrat actif</span>
                      <span style={{ fontSize: '0.7em', color: '#a4262c', cursor: 'pointer', fontWeight: 'bold' }} onClick={() => dispatch({ type: 'DEACTIVATE_CONTRACT', fid })}>Résilier ❌</span>
                    </div>
                    <Stepper label="⏱ Fréquence :" display={`${plan.frequency}s`} onMinus={() => dispatch({ type: 'ADJUST_FREQUENCY', fid, amount: -5 })} onPlus={() => dispatch({ type: 'ADJUST_FREQUENCY', fid, amount: 5 })} />
                    <Stepper label="📦 Volume :" display={`${plan.qty} u`} onMinus={() => dispatch({ type: 'ADJUST_QUANTITY', fid, amount: -100 })} onPlus={() => dispatch({ type: 'ADJUST_QUANTITY', fid, amount: 100 })} />
                    <div style={{ fontSize: '0.7em', color: '#a8842c', textAlign: 'right' }}>Prochaine commande dans {plan.frequency - plan.timer}s · {eur(kitTotalCost(kit))} (composants limités à la place libre)</div>
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      )}

      {sub === 'process' && (
        <div>
          <BuildingBar g={g} f={f} fid={fid} zone="fab" dispatch={dispatch} />
          <Hint>Chaque OF passe par un <strong>poste de pesée</strong> puis une <strong>cuve</strong>. Les temps dépendent de la référence : survolez son nom pour les voir.</Hint>
          <div className="g2">
            {[['station', 'weighing', 'stIdx', '#b8902f', 'Poste'], ['tank', 'mixing', 'tkIdx', '#1a1a1a', 'Cuve']].map(([kind, stage, fld, col, nm]) => (
            <Card key={kind} title={`${EQUIP[kind].icon} ${kind === 'station' ? 'Pesée' : 'Cuves'} (${countOf(f, kind)}/${capOf(f, kind)})`}>
              <div style={{ marginBottom: 8 }}><EquipBuy f={f} fid={fid} kind={kind} dispatch={dispatch} /></div>
              {f[EQUIP[kind].key].map((tier, i) => {
                const o = f.queue.find((x) => x.stage === stage && x[fld] === i);
                const T = EQUIP[kind].tiers[tier];
                return (
                  <div key={i} style={{ background: '#f1ede2', padding: 8, marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, fontSize: '0.78em', marginBottom: 4, flexWrap: 'wrap' }}>
                      <span>{nm} {i + 1} · <strong>{T.name}</strong>{T.mult > 1 && <span style={{ color: '#8c8372' }}> ×{T.mult}</span>}</span>
                      <span style={{ color: o ? col : '#8c8372' }}>{o ? `${PRODUCT_SPECS[o.sku].name} · encore ${fmtT(o.timeLeft)}` : 'Libre'}</span>
                    </div>
                    <Bar value={o ? o.maxTime - o.timeLeft : 0} max={o ? o.maxTime : 1} color={col} />
                    <div style={{ textAlign: 'right', marginTop: 4 }}><EquipUp f={f} fid={fid} kind={kind} cur={tier} idx={i} free={!o} dispatch={dispatch} /></div>
                  </div>
                );
              })}
              {kind === 'tank' && <div style={{ fontSize: '0.72em', color: '#8c8372' }}>Une grosse cuve fait des lots plus gros mais un peu plus longs : idéale pour les gros OF, lente pour les petits. Chaque OF prend la cuve libre qui finit le plus vite.</div>}
              {kind === 'tank' && <div style={{ fontSize: '0.78em', color: '#6f6757', marginTop: 8 }}>OF prêts en attente de ligne : <strong style={{ color: '#2f7a57' }}>{countStage(f, 'mixed')}</strong></div>}
            </Card>
            ))}
          </div>
        </div>
      )}

      {sub === 'cond' && (
        <div>
          {F.techs && (
            <div style={{ marginBottom: 14 }}>
              <Card title={`🔧 Techniciens de maintenance (${f.techs})`} right={
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => dispatch({ type: 'FIRE_TECH', fid })} disabled={f.techs <= 0} className="step" style={{ ...freqQtyBtnStyle, opacity: f.techs <= 0 ? 0.4 : 1 }}>-</button>
                  <Btn onClick={() => dispatch({ type: 'HIRE_TECH', fid })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>+ Recruter ({TECH_COST} €/h)</Btn>
                </div>
              }>
                <div className="g2" style={{ alignItems: 'center' }}>
                  <div style={{ fontSize: '0.76em', color: '#6f6757' }}>
                    Un technicien <strong>double la vitesse</strong> des réparations et fait seul la <strong>maintenance préventive</strong> ({eur(TECH_MAINT_COST)} au lieu de {eur(MAINTENANCE_COST)}) dès que le seuil d'usure est atteint.
                  </div>
                  <Stepper label="Seuil d'usure :" display={`${f.techThreshold} %`} onMinus={() => dispatch({ type: 'ADJUST_TECH_THRESHOLD', fid, amount: -10 })} onPlus={() => dispatch({ type: 'ADJUST_TECH_THRESHOLD', fid, amount: 10 })} />
                </div>
              </Card>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <div style={{ width: '100%' }}><BuildingBar g={g} f={f} fid={fid} zone="cond" dispatch={dispatch} /></div>
            <h4 style={{ margin: 0, color: '#a8842c' }}>{deco('⚙ ')}Lignes de conditionnement ({f.lines.length}/{capOf(f, 'line')})</h4>
            <EquipBuy f={f} fid={fid} kind="line" dispatch={dispatch} />
          </div>
          <div className="g2">
            {f.lines.map((l) => {
              const [label, color] = lineStatusOf(l);
              const k = kpiOf(l.stats);
              const o = f.queue.find((x) => x.id === l.orderId);
              const wearColor = l.wear < 40 ? '#2f7a57' : l.wear < 70 ? '#b4531a' : '#a4262c';
              const canMaintain = l.status === 'idle' || l.status === 'running';
              return (
                <div key={l.id} style={{ background: '#faf8f3', padding: 14, borderLeft: `5px solid ${color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 6 }}>
                    <h4 style={{ margin: 0 }}>{l.name}</h4><span style={{ fontSize: '0.78em', fontWeight: 'bold', color }}>{label}</span>
                  </div>
                  <div style={{ fontSize: '0.78em', color: '#6f6757', marginBottom: 8 }}>
                    <strong>{lineTier(l).name}</strong> (×{lineTier(l).mult}, changement de série {lineTier(l).change} min) <EquipUp f={f} fid={fid} kind="line" cur={l.tier || 0} lineId={l.id} free={l.status === 'idle' && !l.orderId} dispatch={dispatch} /><br />
                    Réglée sur : <strong>{l.sku ? PRODUCT_SPECS[l.sku].name : 'aucune référence'}</strong>
                    {['changeover', 'broken', 'maintenance'].includes(l.status) && <span style={{ color }}> — encore {Math.max(0, l.timeLeft)}s{l.byTech ? ' 🔧' : ''}</span>}
                  </div>
                  <div style={{ background: '#f1ede2', padding: 8, marginBottom: 8 }}>
                    {o ? (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', marginBottom: 4 }}>
                          <span>{deco('📋 ')}{PRODUCT_SPECS[o.sku].name} ({o.pallets} pal.)</span><strong>{o.made} / {o.qty}</strong>
                        </div>
                        <Bar value={o.made} max={o.qty} color="#a8842c" height={8} />
                      </div>
                    ) : <span style={{ fontSize: '0.78em', color: '#8c8372' }}>{countStage(f, 'mixed') > 0 ? 'Un OF est prêt : envoyez-le en ligne depuis le Planning.' : "En attente d'un OF (kit → pesée → cuve)."}</span>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72em', color: '#6f6757', marginBottom: 3 }}>
                    <span>Usure (pannes, vitesse, rebuts)</span><strong style={{ color: wearColor }}>{l.wear.toFixed(0)} %</strong>
                  </div>
                  <Bar value={l.wear} max={100} color={wearColor} />
                  <Btn onClick={() => dispatch({ type: 'MAINTENANCE', fid, lineId: l.id })} disabled={!canMaintain} style={{ width: '100%', marginTop: 8, fontSize: '0.72em' }}>{deco('🛠 ')}Maintenance ({eur(MAINTENANCE_COST)}, {MAINTENANCE_TICKS}s)</Btn>
                  <div style={{ fontSize: '0.7em', color: '#6f6757', marginTop: 8 }}>TRS <strong style={{ color: '#1a1a1a' }}>{pct(k.trs)}</strong> · Pannes : <strong>{l.breakdowns}</strong></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sub === 'exp' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="🚛 Camion vers la centrale">
            <Hint>Un semi-remorque porte <strong>{TRUCK_MAX_PALLETS} palettes</strong> et coûte <strong>{eur(TRUCK_COST)}</strong>, plein ou vide. Il peut mélanger les références de l'usine. Trajet : {TRUCK_TRANSIT} min.</Hint>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.88em' }}>
                Palettes prêtes : <strong>{readyPallets}</strong> · remplissage si départ maintenant : <strong>{Math.round((Math.min(readyPallets, TRUCK_MAX_PALLETS) / TRUCK_MAX_PALLETS) * 100)} %</strong>
                <span style={{ color: '#8c8372' }}> ({readyPallets > 0 ? eur(TRUCK_COST / Math.min(readyPallets, TRUCK_MAX_PALLETS)) : '—'} / palette)</span>
              </div>
              <Btn kind="green" onClick={() => dispatch({ type: 'SEND_TRUCK', fid })} disabled={readyPallets < 1} style={{ fontSize: '0.85em', padding: '8px 14px' }}>{deco('🚛 ')}Faire partir le camion</Btn>
            </div>
            {F.navette && (
              <div style={{ borderTop: '1px solid #efe8d4', marginTop: 12, paddingTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.82em' }}>{deco('🔁 ')}Navette automatique : <strong style={{ color: f.shuttle.on ? '#2f7a57' : '#8c8372' }}>{f.shuttle.on ? 'active' : 'arrêtée'}</strong></span>
                  <Btn kind={f.shuttle.on ? 'ghost' : 'green'} onClick={() => dispatch({ type: 'TOGGLE_SHUTTLE', fid })}>{f.shuttle.on ? 'Arrêter' : 'Activer'}</Btn>
                </div>
                <Stepper label="Départ dès :" display={`${f.shuttle.threshold} pal.`} onMinus={() => dispatch({ type: 'ADJUST_SHUTTLE', fid, amount: -1 })} onPlus={() => dispatch({ type: 'ADJUST_SHUTTLE', fid, amount: 1 })} />
              </div>
            )}
          </Card>
          <div className="g2">
            {def.skus.filter((sku) => g.launched[sku]).map((sku) => {
              const upp = unitsPerPallet(sku);
              const fs = g.factoryStock[sku];
              return (
                <Card key={sku} title={PRODUCT_SPECS[sku].name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', marginBottom: 5 }}><span>{deco('📦 ')}Stock usine</span><strong>{fs.units} / {fs.max} u</strong></div>
                  <Bar value={fs.units} max={fs.max} height={10} color={fs.units > fs.max * 0.8 ? '#b4531a' : '#2f7a57'} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.82em', color: '#2f7a57', fontWeight: 'bold' }}>{Math.floor(fs.units / upp)} pal. (1 pal. = {upp} u)</span>
                    <Btn kind="ghost" onClick={() => dispatch({ type: 'UPGRADE_FACTORY_STORAGE', sku })} style={{ fontSize: '0.72em', padding: '4px 10px' }}>{deco('🏗 ')}Agrandir ({FACTORY_STORAGE_COST / 1000}k €)</Btn>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================================================
   PANNEAU CENTRALE LOGISTIQUE
   ============================================================ */
const STATUS_ORDER = { open: ['📋 À lancer', '#b4531a'], picking: ['🧺 En préparation', '#a8842c'], packed: ["📦 En zone d'expédition", '#1a1a1a'], loading: ['🚛 Au chargement', '#2f7a57'] };

// Jauge carbone : intensité du jour (kg de CO₂ par palette) face au plafond
const CarbonGauge = ({ g, compact }) => {
  if (!carbonOn(g) || !g.carbon) return null;
  const cap = carbonCap(g); const kpp = g.carbon.pal ? Math.round(g.carbon.co2 / g.carbon.pal) : 0; const r = kpp / cap;
  const color = r > 1 ? '#ff8a80' : r > 0.8 ? '#f0b35a' : '#8fd19e';
  const L = g.carbon.last;
  const tip = `Aujourd'hui : ${kpp} kg de CO₂ par palette pour ${cap} autorisés (plafond −3 %/jour). Au-delà : ${CARBON_TAX * 1000} €/t, prélevés à minuit.` + (L ? ` Hier (J${L.day}) : ${(L.co2 / 1000).toFixed(1)} t, ${Math.round(L.air * 100)} % des palettes en avion, taxe ${eur(L.tax)}.` : '') + ` Total payé : ${eur(g.carbon.taxTotal || 0)}.`;
  return (
    <span title={tip} style={{ whiteSpace: 'nowrap' }}>
      {' · '}<span style={{ color }}>●</span> {deco('🌱 ')}{compact ? `${kpp}/${cap}` : `${kpp} / ${cap} kg/pal.`}
      {!compact && L && L.tax > 0 && <span style={{ color: '#ff8a80' }}> (taxe hier {eur(L.tax)})</span>}
    </span>
  );
};

const DCPanel = ({ g, dispatch, ask }) => {
  const F = g.features;
  const dc = g.dc;
  const capa = dcCapacity(dc);
  const used = dcPallets(dc);
  const buf = bufferTotal(dc);
  const free = dc.staff - assignedTotal(dc);
  const posts = POSTS.filter((p) => F[DC_POSTS[p].feature]);
  const openOrders = dc.orders.filter((o) => o.status === 'open');
  const now = g.t;

  const flow = [
    ['🅿️ Cour', `${dc.yard.length} cam.`, dc.yard.length > 0 ? '#b4531a' : '#8c8372', null],
    ['📥 Quais récep.', `${dc.docked.length}/${dc.recvDocks}`, '#a8842c', 'recv'],
    ['🟫 Zone récep.', `${buf}/${bufferCap(dc)}`, buf >= bufferCap(dc) ? '#a4262c' : '#a8842c', null],
    ...(F.putaway ? [['🏗 Racks', `${used}/${capa}`, used >= capa ? '#a4262c' : '#2f7a57', 'putaway']] : []),
    ...(F.pick ? [['🧺 Préparation', `${dc.orders.filter((o) => o.status === 'picking').length} cde`, '#a8842c', 'pick']] : []),
    ...(F.load ? [['🚛 Quais expé.', `${dc.orders.filter((o) => o.status === 'loading').length}/${dc.shipDocks}`, '#1a1a1a', 'load']] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', background: '#faf8f3', padding: '10px 14px' }}>
        {flow.map(([label, value, color, post], i) => (
          <React.Fragment key={label}>
            <div style={{ textAlign: 'center', minWidth: 76 }}>
              <div style={{ fontSize: '0.7em', color: '#6f6757' }}>{deco(label)}</div>
              <div style={{ fontWeight: 'bold', color, fontSize: '1.02em' }}>{value}</div>
              {post && dc.blocks[post] && <div style={{ fontSize: '0.62em', color: '#a4262c' }}>{deco('⛔ ')}{dc.blocks[post]}</div>}
            </div>
            {i < flow.length - 1 && <span style={{ color: '#b9ae93' }}>➔</span>}
          </React.Fragment>
        ))}
      </div>

      <Card title={`👥 Équipe de la centrale (${dc.staff})`} right={
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn kind="ghost" onClick={() => dispatch({ type: 'DC_FIRE' })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>- Licencier</Btn>
          <Btn onClick={() => dispatch({ type: 'DC_HIRE' })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>+ Recruter ({DC_STAFF_COST} €/h)</Btn>
        </div>
      }>
        <Hint>Répartissez vos équipiers : le débit de la centrale est celui du <strong>poste le plus lent</strong>. Libres : <strong>{free}</strong>.</Hint>
        <div className="g3">
          {posts.map((p) => {
            const d = DC_POSTS[p];
            const mult = postMult(dc, p);
            return (
              <div key={p} style={{ background: '#f1ede2', padding: 10, borderTop: `3px solid ${dc.blocks[p] ? '#a4262c' : '#c9a24b'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <strong style={{ fontSize: '0.85em' }}>{deco(d.icon)} {d.name}</strong>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button onClick={() => dispatch({ type: 'DC_ASSIGN', post: p, delta: -1 })} className="step" style={freqQtyBtnStyle}>-</button>
                    <strong>{dc.assign[p]}</strong>
                    <button onClick={() => dispatch({ type: 'DC_ASSIGN', post: p, delta: 1 })} className="step" style={freqQtyBtnStyle}>+</button>
                  </div>
                </div>
                <div style={{ fontSize: '0.7em', color: '#6f6757' }}>Ils {d.job}.</div>
                <div style={{ fontSize: '0.72em', marginTop: 4 }}>
                  Débit : <strong>{postRate(dc, p).toFixed(1)} {d.unit}/min</strong>
                  <span style={{ color: '#8c8372' }}> ({(d.rate * mult).toFixed(2)} par équipier{dc.kaizen[p] > 0 ? `, amélioration niv. ${dc.kaizen[p]}` : ''}{equipMult(dc, p) > 1 ? ', équipé' : ''})</span>
                </div>
                {p === 'recv' && dc.assign.recv > usefulStaff(dc, 'recv') && <div style={{ fontSize: '0.7em', color: '#b4531a', marginTop: 3 }}>{deco('⚠ ')}{RECV_PER_TRUCK} équipiers max par camion : {usefulStaff(dc, 'recv')} utiles sur {dc.assign.recv} avec {dc.recvDocks} quai(s). Ajoutez un quai pour décharger plus de camions en même temps.</div>}
                {p === 'load' && dc.assign.load > usefulStaff(dc, 'load') && <div style={{ fontSize: '0.7em', color: '#b4531a', marginTop: 3 }}>{deco('⚠ ')}{PER_DOCK} chargeurs max par camion : {usefulStaff(dc, 'load')} utiles sur {dc.assign.load} avec {dc.shipDocks} quai(s) d'expé.</div>}
                {p === 'pick' && pickTeam(dc) > 0 && (() => { const al = pickAlloc(dc); return <div style={{ fontSize: '0.7em', color: '#6f6757', marginTop: 3 }}>{robotsOf(dc) > 0 ? `🤖 ${robotsOf(dc)} robots en renfort · ` : ''}👷 {pickTeam(dc) - al.idle} en mission{al.idle > 0 ? `, ${al.idle} en attente de mission` : ''}</div>; })()}
                {dc.outage && (p === 'recv' || p === 'pick') && <div style={{ fontSize: '0.7em', color: '#a4262c', marginTop: 3 }}>{deco('💻 ')}Panne système : travail sur papier</div>}
                {dc.blocks[p] && <div style={{ fontSize: '0.7em', color: '#a4262c', marginTop: 3 }}>{deco('⛔ ')}Bloqué : {dc.blocks[p]}</div>}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="g2">
        <Card title="📥 Réception" right={<Btn onClick={() => dispatch({ type: 'DC_BUY_DOCK', kind: 'recv' })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>+ Quai et {RECV_ZONE_PER_DOCK} pal. de zone ({eur(DOCK_COST * dc.recvDocks)})</Btn>}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '0.8em', marginBottom: 4 }}>
            <span>🟫 Zones au sol : <strong>{buf} / {bufferCap(dc)}</strong> pal.</span>
            <span style={{ fontSize: '0.85em', color: '#8c8372' }}>{RECV_ZONE_PER_DOCK} pal. par quai · {RECV_PER_TRUCK} équipiers max par camion</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6, marginBottom: 6 }}>
            {zoneFillOf(dc).map((fill, i) => {
              const t = dc.docked.find((x) => x.dock === i);
              const full = fill >= RECV_ZONE_PER_DOCK;
              return (
                <div key={i} style={{ background: '#f1ede2', padding: 8, borderLeft: `3px solid ${full ? '#a4262c' : t ? '#2f7a57' : '#c9a24b'}`, fontSize: '0.76em' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                    <strong>Quai {i + 1}</strong>
                    <span style={{ color: t ? '#111' : '#8c8372' }}>{t ? `🚚 ${FACTORY_DEFS[t.fid].icon} ${t.done}/${t.pallets} pal.` : 'libre'}</span>
                  </div>
                  <Bar value={t ? t.done : 0} max={t ? t.pallets : 1} color="#2f7a57" />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, color: full ? '#a4262c' : '#6f6757' }}>
                    <span>🟫 Zone au sol</span><strong>{fill} / {RECV_ZONE_PER_DOCK}</strong>
                  </div>
                  <Bar value={fill} max={RECV_ZONE_PER_DOCK} color={full ? '#a4262c' : fill > RECV_ZONE_PER_DOCK * 0.8 ? '#b4531a' : '#a8842c'} height={4} />
                  {full && t && <div style={{ color: '#a4262c', marginTop: 3 }}>{deco('⛔ ')}Déchargement arrêté : zone pleine</div>}
                </div>
              );
            })}
          </div>
          {dc.blocks.putaway && buf > 0 && <div style={{ fontSize: '0.72em', color: '#a4262c', marginTop: 4 }}>{deco('⛔ ')}Rangement bloqué : {dc.blocks.putaway}. Agrandir la zone ne fait que repousser le problème.</div>}
          <details style={{ fontSize: '0.72em', color: '#6f6757', marginTop: 4 }}>
            <summary style={{ cursor: 'pointer' }}>Détail par produit</summary>
            {SKUS.filter((k) => dc.buffer[k] > 0).map((k) => `${PRODUCT_SPECS[k].name} : ${dc.buffer[k]} pal.`).join(' · ') || 'Vide'}
          </details>
          <div style={{ fontSize: '0.78em', margin: '10px 0 6px 0', lineHeight: 1.5 }}>
            <div>🛣 En route : {g.transit.length === 0 ? 'aucun camion' : `${g.transit.length} camion(s), ${g.transit.reduce((a, t) => a + t.pallets, 0)} pal. · prochain dans ${fmtT(Math.min(...g.transit.map((t) => t.eta)))}`}</div>
            <div style={{ color: dc.yard.some((t) => t.wait > YARD_FREE_TICKS) ? '#a4262c' : '#6f6757' }}>
              🅿️ Cour : {dc.yard.length === 0 ? 'vide' : `${dc.yard.length} camion(s), ${dc.yard.reduce((a, t) => a + t.pallets, 0)} pal. · attente max ${fmtT(Math.max(...dc.yard.map((t) => t.wait)))}${dc.yard.some((t) => t.wait > YARD_FREE_TICKS) ? ` · ${dc.yard.filter((t) => t.wait > YARD_FREE_TICKS).length} payent ${DEMURRAGE} €/min` : ''}`}
            </div>
          </div>
          {dc.demurrage > 0 && <div style={{ fontSize: '0.7em', color: '#a4262c', marginTop: 6 }}>Frais d'immobilisation payés : {eur(dc.demurrage)}</div>}
        </Card>

        {F.putaway && (
          <Card title={`🏗 Stockage en racks (${used.toLocaleString('fr-FR')} / ${capa.toLocaleString('fr-FR')} emplacements)`}>
            <Bar value={used} max={capa} color={used >= capa ? '#a4262c' : '#2f7a57'} height={8} />
            <div style={{ fontSize: '0.7em', color: '#8c8372', margin: '4px 0 10px 0' }}>Une palette entamée occupe toujours un emplacement entier. Loyer : {RACK_RENT * 60} €/h par emplacement.</div>
            <div className="g2 keep" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              {activeSkus(g).map((sku) => {
                const { pallets, cartons, units } = getStockDisplay(sku, dc.stock[sku]);
                return (
                  <div key={sku} style={{ background: '#f1ede2', padding: 8, fontSize: '0.78em' }}>
                    <strong title={skuTip(sku)}>{PRODUCT_SPECS[sku].name}</strong>
                    <div style={{ color: '#6f6757' }}>🟦 {pallets} pal. · 📦 {cartons} cartons · {units} u</div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 10, fontSize: '0.72em', color: '#6f6757' }}>
              Bâtiment : {dc.cells.filter((c) => c.unlocked).length} / {DC_CELLS} cellules · {capa.toLocaleString('fr-FR')} / {(DC_CELLS * MAX_RACK_PER_CELL).toLocaleString('fr-FR')} emplacements possibles. On équipe chaque cellule en palettier petit à petit.
            </div>
            <div style={{ marginTop: 6 }}>
              {dc.cells.map((cell) => {
                const prev = dc.cells.find((c) => c.id === cell.id - 1);
                const canBuild = !prev || prev.unlocked;
                if (!cell.unlocked && !canBuild) return null;
                return (
                  <div key={cell.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1ede2', fontSize: '0.8em' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>Cellule {cell.id} {cell.unlocked ? `: ${cell.racking.toLocaleString('fr-FR')} / ${MAX_RACK_PER_CELL.toLocaleString('fr-FR')} empl.` : '(à construire)'}</span>
                      {cell.unlocked ? (
                        cell.racking < MAX_RACK_PER_CELL && (
                          <span style={{ display: 'flex', gap: 6 }}>
                            <Btn onClick={() => dispatch({ type: 'BUY_RACKING', cellId: cell.id })} style={{ fontSize: '0.72em', padding: '3px 8px' }}>+{RACK_STEP} ({eur(RACK_COST)})</Btn>
                            {canBuyBulk(cell) && <Btn kind="ghost" onClick={() => dispatch({ type: 'BUY_RACKING', cellId: cell.id, bulk: true })} style={{ fontSize: '0.72em', padding: '3px 8px' }}>+{RACK_BULK.toLocaleString('fr-FR')} ({eur(RACK_BULK_PRICE)})</Btn>}
                          </span>
                        )
                      ) : <Btn kind="green" onClick={() => dispatch({ type: 'BUILD_CELL', cellId: cell.id })} style={{ fontSize: '0.72em', padding: '3px 8px' }}>Construire ({eur(cellCost(cell.id))})</Btn>}
                    </div>
                    {cell.unlocked && <div style={{ marginTop: 4 }}><Bar value={cell.racking} max={MAX_RACK_PER_CELL} color="#a8842c" height={4} /></div>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {F.pick && (
        <Card title={`🧺 Commandes filiales (${dc.orders.length})`} right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {dc.upgrades.WMS && <Btn kind={dc.wmsAuto ? 'green' : 'ghost'} onClick={() => dispatch({ type: 'TOGGLE_WMS' })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>{deco('🖥 ')}WMS : {dc.wmsAuto ? 'lancement auto' : 'manuel'}</Btn>}
            <Btn onClick={() => dispatch({ type: 'DC_BUY_DOCK', kind: 'ship' })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>+ Quai d'expé. ({eur(DOCK_COST * dc.shipDocks)})</Btn>
          </div>
        }>
          <Hint>
            Lancer une commande <strong>réserve le stock</strong>. En partiel, elle part à l'heure mais n'est pas <strong title="On Time In Full : livrée à l'heure ET complète">OTIF</strong> (à l'heure et complète). {openOrders.length} à lancer.
          </Hint>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: '0.72em', color: '#8c8372', margin: '6px 0 4px' }}>
            <span>{deco('🧺 ')}Préparation : une mission par palette, un préparateur par mission, {fmtT(PICK_ALLOW)} prévues. Puis chaque quai charge un camion à la fois ({fmtT(LOAD_ALLOW)} prévues).</span>
            <span>{PER_DOCK} chargeurs max par camion</span>
          </div>
          {(() => {
            const al = pickAlloc(dc); const pk = dc.orders.filter((o) => o.status === 'picking'); const act = pickActive(dc);
            const miss = act.reduce((a, o) => a + pickMissions(o), 0); const queued = pk.length - act.length;
            return (
              <div style={{ fontSize: '0.76em', background: '#f1ede2', padding: '6px 8px', marginBottom: 6, borderLeft: `3px solid ${pk.length && pickTeam(dc) === 0 ? '#a4262c' : '#a8842c'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>
                  🧺 <strong>{act.length}</strong> commande{act.length > 1 ? 's' : ''} en préparation{queued > 0 ? ` (+${queued} lancée${queued > 1 ? 's' : ''} en file)` : ''} · <strong>{miss}</strong> mission{miss > 1 ? 's' : ''} palette · <strong>{pickTeam(dc) - al.idle}</strong> / {pickTeam(dc)} préparateur{pickTeam(dc) > 1 ? 's' : ''}{robotsOf(dc) ? ` (dont ${robotsOf(dc)} robots)` : ''} en mission{miss > pickTeam(dc) ? ` · ${miss - pickTeam(dc)} mission${miss - pickTeam(dc) > 1 ? 's' : ''} en attente d'un préparateur` : ''}
                </span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  En même temps :
                  <button onClick={() => dispatch({ type: 'SET_PICK_SLOTS', delta: -1 })} className="step" style={freqQtyBtnStyle}>-</button>
                  <strong>{pickSlots(dc)}</strong>
                  <button onClick={() => dispatch({ type: 'SET_PICK_SLOTS', delta: 1 })} className="step" style={freqQtyBtnStyle}>+</button>
                  commande{pickSlots(dc) > 1 ? 's' : ''}
                </span>
              </div>
            );
          })()}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6, marginBottom: 8 }}>
            {Array.from({ length: dc.shipDocks }, (_, i) => {
              const mine = dc.orders.filter((o) => o.dock === i && SHIP_ACTIVE.includes(o.status));
              const waiting = mine.filter((o) => o.status === 'packed');
              const ld = mine.find((o) => o.status === 'loading');
              const busyBefore = Array.from({ length: i }, (_, d) => dc.orders.some((o) => o.dock === d && o.status === 'loading')).filter(Boolean).length;
              const loaders = ld ? Math.max(0, Math.min(PER_DOCK, dc.assign.load - PER_DOCK * busyBefore)) : 0;
              return (
                <div key={i} style={{ background: '#f1ede2', padding: 8, borderLeft: `3px solid ${ld ? '#2f7a57' : waiting.length ? '#1a1a1a' : '#c9c1ae'}`, fontSize: '0.76em' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                    <strong>Quai d'expé. {i + 1}</strong>
                    <span style={{ color: '#8c8372' }}>{mine.length === 0 ? 'libre' : `${mine.length} commande${mine.length > 1 ? 's' : ''}`}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: ld && loaders === 0 ? '#a4262c' : '#3a352c' }}>
                    <span>{deco('🚛 ')}Camion {ld ? `n°${ld.no} ${FILIALE_DEFS[ld.fil].flag} (${loaders} 👷)` : ''}</span>
                    <strong>{ld ? `${Math.floor(ld.loaded)}/${ld.palEq} pal.` : 'pas de camion'}</strong>
                  </div>
                  <Bar value={ld ? ld.loaded : 0} max={ld ? ld.palEq : 1} color="#2f7a57" height={4} />
                  <div style={{ color: '#6f6757', marginTop: 3 }}>{deco('📦 ')}{waiting.length ? `${waiting.length} commande${waiting.length > 1 ? 's' : ''} prête${waiting.length > 1 ? 's' : ''} en attente` : 'aucune commande en attente'}</div>
                </div>
              );
            })}
          </div>
          {dc.orders.length === 0 && <div style={{ fontSize: '0.85em', color: '#8c8372', textAlign: 'center', padding: 10 }}>Aucune commande en cours. Les filiales commandent toutes les heures selon leurs besoins.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dc.orders.map((o, idx) => {
              const pickAllocUI = pickAlloc(dc);
              const fd = FILIALE_DEFS[o.fil];
              const [label, color] = STATUS_ORDER[o.status];
              const mode = orderMode(g, o);
              const slack = o.due - now - mode.time; // temps restant avant de devoir partir
              const late = slack < 0;
              const avail = o.lines.map((l) => Math.min(l.req, availCartons(g, l.sku)));
              const full = o.lines.every((l, i) => avail[i] >= l.req);
              const none = avail.every((a) => a === 0);
              const prog = o.status === 'picking' ? orderCartons(o, 'picked') / Math.max(1, orderCartons(o, 'alloc')) : o.status === 'loading' ? o.loaded / o.palEq : o.status === 'packed' ? 1 : 0;
              return (
                <div key={o.id} style={{ background: '#f1ede2', padding: 10, borderLeft: `4px solid ${late && o.status !== 'loading' ? '#a4262c' : color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.85em' }}>
                      {fd.flag} <strong>n°{o.no} · {fd.name}</strong> <span style={{ color }}>{label}</span>{SHIP_ACTIVE.includes(o.status) && o.dock != null && <span style={{ color: '#6f6757' }}> · quai {o.dock + 1}</span>}{o.status === 'picking' && <span style={{ color: '#6f6757' }}> · {o.id in pickAllocUI ? `${pickAllocUI[o.id]}/${pickMissions(o)} 👷` : 'en file, attend un créneau de préparation'}</span>}
                      <span style={{ color: late ? '#a4262c' : '#6f6757', marginLeft: 8 }}>
                        {late ? `⚠️ départ en retard de ${fmtT(-slack)}` : `départ avant ${fmtT(slack)}`} · {MODE_LABELS[orderModeKey(g, o)]} {fmtT(mode.time)}
                      </span>
                      {!o.inFull && o.status !== 'open' && <span style={{ color: '#a4262c' }}> · partielle</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {hasSplit(o.fil) && o.status !== 'loading' && (() => { const other = orderModeKey(g, o) === 'air' ? 'sea' : 'air'; return (
                        <Btn kind="ghost" onClick={() => dispatch({ type: 'SET_ORDER_MODE', orderId: o.id, mode: other })} style={{ fontSize: '0.7em', padding: '4px 8px' }} title={`${MODE_LABELS[other]} : ${fmtT(FILIALE_DEFS[o.fil].modes[other].time)}, ${FILIALE_DEFS[o.fil].modes[other].cost} €/pal.`}>
                          {other === 'air' ? '✈️ Passer en aérien' : '🚢 Passer en maritime'}
                        </Btn>
                      ); })()}
                      {o.status === 'open' && (
                        <Btn kind={full ? 'green' : 'gold'} disabled={none} onClick={() => dispatch({ type: 'RELEASE_ORDER', orderId: o.id })} style={{ fontSize: '0.74em', padding: '4px 10px' }}>
                          {full ? '▶ Lancer la préparation' : none ? 'Stock absent' : '▶ Lancer en partiel'}
                        </Btn>
                      )}
                      <button onClick={() => dispatch({ type: 'MOVE_DC_ORDER', orderId: o.id, dir: -1 })} disabled={idx === 0} className="step" style={{ ...freqQtyBtnStyle, opacity: idx === 0 ? 0.4 : 1 }}>↑</button>
                      <button onClick={() => dispatch({ type: 'MOVE_DC_ORDER', orderId: o.id, dir: 1 })} disabled={idx === dc.orders.length - 1} className="step" style={{ ...freqQtyBtnStyle, opacity: idx === dc.orders.length - 1 ? 0.4 : 1 }}>↓</button>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.74em', color: '#3a352c', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {o.lines.map((l, i) => (
                      <span key={l.sku}>
                        {PRODUCT_SPECS[l.sku].name} : <strong>{o.status === 'open' ? l.req : `${Math.floor(l.picked)}/${l.alloc}`}</strong> cartons
                        {o.status === 'open' && avail[i] < l.req && <span style={{ color: '#a4262c' }}> (dispo {avail[i]})</span>}
                        {o.status !== 'open' && l.alloc < l.req && <span style={{ color: '#a4262c' }}> (sur {l.req})</span>}
                      </span>
                    ))}
                    {o.palEq > 0 && <span>· {o.palEq} pal. · transport {eur(shipCostOf(mode, orderModeKey(g, o), o.palEq))}</span>}
                  </div>
                  {o.status !== 'open' && <div style={{ marginTop: 5 }}><Bar value={prog} max={1} color={color} height={4} /></div>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {F.kaizen && (
        <Card title="🔁 Amélioration continue" right={dc.kaizenRun ? <span style={{ fontSize: '0.75em', color: '#a8842c' }}>Chantier en cours : {DC_POSTS[dc.kaizenRun.post].name}, encore {fmtT(dc.kaizenRun.end - g.t)}</span> : null}>
          <Hint>
            On observe le poste, on chasse le gaspillage, on change le standard. Pendant {fmtT(KAIZEN_TICKS)}, le poste perd 20 % de débit, puis gagne <strong>+{KAIZEN_GAIN * 100} % pour toujours</strong>. Un chantier à la fois.
          </Hint>
          <div className="g3">
            {posts.map((p) => {
              const lvl = dc.kaizen[p];
              const running = dc.kaizenRun && dc.kaizenRun.post === p;
              return (
                <div key={p} style={{ background: '#f1ede2', padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82em', marginBottom: 4 }}>
                    <strong>{deco(DC_POSTS[p].icon)} {DC_POSTS[p].name}</strong><span>Niveau {lvl}/{KAIZEN_MAX}</span>
                  </div>
                  <Bar value={running ? lvl + (KAIZEN_TICKS - (dc.kaizenRun.end - g.t)) / KAIZEN_TICKS : lvl} max={KAIZEN_MAX} color="#2f7a57" />
                  <div style={{ fontSize: '0.7em', color: '#6f6757', margin: '6px 0' }}>
                    {lvl > 0 && <div>✔ {KAIZEN_TOPICS[p].slice(0, lvl).join(' · ')}</div>}
                    {lvl < KAIZEN_MAX && <div>Prochain : <strong>{KAIZEN_TOPICS[p][lvl]}</strong></div>}
                  </div>
                  {lvl < KAIZEN_MAX && !running && <Btn kind="green" disabled={!!dc.kaizenRun} onClick={() => dispatch({ type: 'START_KAIZEN', post: p })} style={{ width: '100%', fontSize: '0.72em' }}>Lancer le chantier ({eur(KAIZEN_COST * (lvl + 1))})</Btn>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {F.dc_upgrades && (
        <Card title="⚙️ Équipements">
          <div className="g3">
            {Object.entries(DC_UPGRADES).map(([k, u]) => (
              <div key={k} style={{ background: '#f1ede2', padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <strong style={{ fontSize: '0.85em' }}>{deco(u.icon)} {u.name}</strong>
                  <div style={{ fontSize: '0.72em', color: '#6f6757', marginTop: 4 }}>{u.desc}</div>
                </div>
                {dc.upgrades[k] ? <span style={{ fontSize: '0.78em', color: '#2f7a57', fontWeight: 'bold' }}>✔ Installé</span>
                  : u.req && !dc.upgrades[u.req] ? <span style={{ fontSize: '0.72em', color: '#8c8372' }}>{deco('🔒 ')}Après : {DC_UPGRADES[u.req].name}</span>
                  : <Btn onClick={() => dispatch({ type: 'DC_UPGRADE', key: k })}>Installer ({eur(u.cost)})</Btn>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {F.dc_upgrades && (
        <Card title="🤖 Automatisation de la préparation">
          {!dc.auto && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.78em', color: '#3a352c', flex: '1 1 300px' }}>
                Un grand projet : on installe une zone de préparation automatisée. {fmtT(AUTO_BUILD)} de travaux, puis <strong>{AUTO_ROBOTS} robots</strong> préparent les missions comme des préparateurs, <strong>sans salaire</strong>. Ensuite, chaque robot en plus coûte {eur(ROBOT_COST)}.
              </div>
              <Btn kind="gold" onClick={() => ask(`Lancer le projet d'automatisation pour ${eur(AUTO_COST)} ? (${fmtT(AUTO_BUILD)} de travaux)`, () => dispatch({ type: 'START_AUTOMATION' }))}>Lancer le projet ({eur(AUTO_COST)})</Btn>
            </div>
          )}
          {dc.auto && !dc.auto.done && (
            <div style={{ fontSize: '0.8em' }}>
              🏗 Travaux en cours : encore <strong>{fmtT(Math.max(0, dc.auto.end - g.t))}</strong>
              <div style={{ marginTop: 6 }}><Bar value={AUTO_BUILD - Math.max(0, dc.auto.end - g.t)} max={AUTO_BUILD} color="#a8842c" /></div>
            </div>
          )}
          {dc.auto && dc.auto.done && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: '0.8em' }}>
              <span>{deco('🤖 ')}<strong>{dc.auto.robots}</strong> robots en préparation · économie de {eur(dc.auto.robots * DC_STAFF_COST)}/h de salaires</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <Btn onClick={() => dispatch({ type: 'BUY_ROBOT', n: 1 })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>+1 robot ({eur(ROBOT_COST)})</Btn>
                <Btn kind="ghost" onClick={() => dispatch({ type: 'BUY_ROBOT', n: 10 })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>+10 ({eur(ROBOT_COST * 10)})</Btn>
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

/* ============================================================
   PANNEAU FILIALES
   ============================================================ */
/* Diagnostic OTIF : pourquoi les dernières livraisons n'ont pas été à l'heure et complètes */
const OtifDiag = ({ f }) => {
  const [open, setOpen] = useState(false);
  const log = (f.otifLog || []).filter((x) => x.rel !== undefined);
  if (log.length === 0) return null;
  const bad = log.filter((x) => !x.ok);
  const partial = bad.filter((x) => !x.inFull);
  const late = bad.filter((x) => !x.onTime);
  const avg = (arr, k) => Math.round(arr.reduce((a, x) => a + x[k], 0) / Math.max(1, arr.length));
  const missCount = {};
  partial.forEach((x) => x.missing.forEach((k) => { missCount[k] = (missCount[k] || 0) + 1; }));
  const topMiss = Object.entries(missCount).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => PRODUCT_SPECS[k].name);
  const relLate = late.filter((x) => x.rel > PICK_ALLOW * 0.5);
  const tips = [];
  if (partial.length) tips.push(<div key="p">{deco('📦 ')}<strong>{partial.length} incomplète(s)</strong> : il manquait du stock en racks au lancement{topMiss.length ? ` (surtout ${topMiss.join(', ')})` : ''}. → Produire plus (ligne en plus, stock visé S&OP plus haut), faire partir la navette plus souvent, bien staffer réception et rangement. Si l'échéance le permet, attendez le stock au lieu de lancer en partiel.</div>);
  if (relLate.length) tips.push(<div key="r">{deco('⏳ ')}<strong>{relLate.length} lancée(s) trop tard</strong> : en moyenne {fmtT(avg(relLate, 'rel'))} après la commande, alors que préparation ({fmtT(PICK_ALLOW)}) et chargement ({fmtT(LOAD_ALLOW)}) doivent tenir en {fmtT(PREP_ALLOW)}. → Lancez dès réception, ou activez le WMS.</div>);
  if (late.length > relLate.length) tips.push(<div key="l">🐢 <strong>{late.length - relLate.length} en retard malgré un lancement rapide</strong> : préparation + chargement ont pris {fmtT(avg(late.filter((x) => x.rel <= PICK_ALLOW * 0.5), 'prep'))} en moyenne (budget {fmtT(PREP_ALLOW)}). → Plus de préparateurs (une mission par palette), assez de chargeurs, un quai d'expédition en plus.</div>);
  return (
    <div style={{ marginBottom: 10, fontSize: '0.74em', background: bad.length ? '#fff4e6' : '#eef6f0', borderLeft: `3px solid ${bad.length ? '#b4531a' : '#2f7a57'}`, padding: '6px 8px' }}>
      <div onClick={() => setOpen(!open)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{deco('🔎 ')}<strong>Diagnostic OTIF</strong> : {log.length - bad.length}/{log.length} OK{bad.length ? ` · ${partial.length} incomplète(s) · ${late.length} en retard` : ''}</span>
        <span style={{ color: '#a8842c' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 6, lineHeight: 1.5, display: 'grid', gap: 4 }}>
          {tips.length ? tips : <div>✔ Les dernières livraisons sont toutes à l'heure et complètes.</div>}
          <div style={{ color: '#8c8372' }}>
            {log.slice().reverse().slice(0, 5).map((x) => (
              <div key={x.no}>n°{x.no} : {x.ok ? '✔ OTIF' : [!x.inFull && 'incomplète', !x.onTime && `retard ${fmtT(x.lateBy)}`].filter(Boolean).join(' + ')} · lancée après {fmtT(x.rel)} · prépa + chargement {fmtT(x.prep)}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const FilialesPanel = ({ g, dispatch, ask }) => {
  const F = g.features;
  const act = activeSkus(g);
  const ids = Object.keys(FILIALE_DEFS).filter((id) => F[`fil_${id}`]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Hint>
        Chaque filiale vend sur son marché et <strong>commande à la centrale</strong> toutes les heures pour remonter son stock à sa <strong>couverture cible</strong>.
        Plus de couverture = moins de ruptures, mais plus de stock à payer ({HOLDING_COST * 60} €/h par unité).
        Elle vous juge sur l'<strong>OTIF</strong> (On Time In Full : part des commandes livrées à l'heure <em>et</em> complètes) et sur son taux de service (part de la demande servie).
      </Hint>
      {g.shipments.length > 0 && (
        <Card title={`🌍 Livraisons en route (${g.shipments.length})`}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {g.shipments.map((sh) => (
              <div key={sh.id} style={{ background: '#f1ede2', padding: 8, minWidth: 150, fontSize: '0.78em' }}>
                <div>{FILIALE_DEFS[sh.fil].flag} n°{sh.no} · {MODE_LABELS[sh.mode]}</div>
                <div style={{ color: g.t + sh.eta > sh.due ? '#a4262c' : '#2f7a57' }}>Arrivée dans {fmtT(sh.eta)}{g.t + sh.eta > sh.due ? ' (en retard)' : ''}</div>
                <Bar value={sh.maxEta - sh.eta} max={sh.maxEta} color="#b8902f" height={4} />
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="g2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {ids.map((id) => {
          const d = FILIALE_DEFS[id];
          const f = g.filiales[id];
          if (!f.unlocked) {
            return (
              <Card key={id} title={`${d.flag} ${d.name} · ${d.city}`}>
                <p style={{ fontSize: '0.82em', color: '#6f6757', margin: '0 0 8px 0' }}>{d.blurb}</p>
                <div style={{ fontSize: '0.75em', color: '#6f6757', marginBottom: 10 }}>
                  Marché ×{d.size} · prix ×{d.price} · transport : {Object.entries(d.modes).map(([m, v]) => `${MODE_LABELS[m]} ${fmtT(v.time)} (${shipPriceTxt(v, m)})`).join(' ou ')}
                </div>
                <Btn kind="green" onClick={() => ask(`Ouvrir la filiale ${d.name} pour ${eur(d.unlockCost)} ? (création de la société, recrutement, référencement chez les distributeurs)`, () => dispatch({ type: 'UNLOCK_FILIALE', id }))} style={{ width: '100%' }}>
                  Ouvrir la filiale ({eur(d.unlockCost)})
                </Btn>
              </Card>
            );
          }
          const svc = svcOf(f);
          const otif = otifOf(f);
          const posCost = Math.round(d.posCost * 1.5 ** (f.pos - 1));
          const satColor = f.sat > 0.85 ? '#2f7a57' : f.sat > 0.6 ? '#b8902f' : '#a4262c';
          return (
            <Card key={id} title={`${d.flag} ${d.name} · ${d.city}`} right={<span style={{ fontSize: '0.75em', color: satColor }}>Satisfaction {Math.round(f.sat * 100)} %</span>}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6, marginBottom: 10, textAlign: 'center' }}>
                {[['Taux de service', pct(svc), svc !== null && svc < 0.9, 'Part de la demande des clients servie (le reste est perdu en rupture)'], ['OTIF (10 dern.)', pct(otif), otif !== null && otif < 0.8, "On Time In Full : part des 10 dernières commandes livrées à l'heure ET complètes"], ['CA cumulé', eur(f.sales), false, '']].map(([l, v, bad, tip]) => (
                  <div key={l} title={tip} style={{ background: '#faf8f3', padding: 6 }}>
                    <div style={{ fontSize: '0.62em', color: '#6f6757', textTransform: 'uppercase' }}>{l}</div>
                    <div style={{ fontWeight: 'bold', fontSize: '0.92em', color: bad ? '#a4262c' : '#111' }}>{v}</div>
                  </div>
                ))}
              </div>
              <OtifDiag f={f} />
              <div style={{ fontSize: '0.74em', color: '#6f6757', marginBottom: 4 }}>Stock local et couverture (temps avant rupture au rythme actuel) :</div>
              {act.map((sku) => {
                const rate = liveRate(g, id, sku);
                const cov = rate > 0 ? f.stock[sku] / rate : 0;
                const tr = transitUnits(g, id, sku);
                return (
                  <div key={sku} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr) auto', gap: 8, alignItems: 'center', fontSize: '0.76em', padding: '3px 0' }}>
                    <span>{PRODUCT_SPECS[sku].name}</span>
                    <Bar value={cov} max={f.cover} color={cov < 30 ? '#a4262c' : cov < f.cover * 0.4 ? '#b4531a' : '#2f7a57'} />
                    <span style={{ color: f.stock[sku] === 0 ? '#a4262c' : '#111', whiteSpace: 'nowrap' }}>
                      {f.stock[sku]} u · {f.stock[sku] === 0 ? 'RUPTURE' : fmtT(cov)}{tr > 0 && <span style={{ color: '#b8902f' }}> (+{tr})</span>}
                    </span>
                  </div>
                );
              })}
              <div style={{ borderTop: '1px solid #efe8d4', marginTop: 10, paddingTop: 10 }}>
                {(() => {
                  const per = periodOf(f);
                  const palH = act.reduce((a, sku) => a + baseRate(g, id, sku) / unitsPerPallet(sku), 0);
                  const pal = Math.max(1, Math.ceil(palH * per));
                  const mk = hasSplit(id) ? (airPctOf(f) >= 50 ? 'air' : 'sea') : f.mode; const md = d.modes[mk] || modeOf(g, id);
                  const c = shipCostOf(md, mk, pal);
                  return (<>
                    <Stepper label="📦 Commande toutes les :" display={fmtT(per)} onMinus={() => dispatch({ type: 'SET_PERIOD', id, dir: -1 })} onPlus={() => dispatch({ type: 'SET_PERIOD', id, dir: 1 })} />
                    <div style={{ fontSize: '0.68em', color: '#8c8372', marginTop: -6, marginBottom: 8 }}>
                      ≈ {pal} pal. par envoi · {eur(c)} soit <strong>{Math.round(c / pal)} €/pal.</strong> ({shipPriceTxt(md, mk)}). Commander moins souvent remplit mieux les envois mais demande plus de couverture.
                    </div>
                  </>);
                })()}
                <Stepper label="🎯 Couverture cible :" display={fmtT(f.cover)} onMinus={() => dispatch({ type: 'SET_COVER', id, delta: f.cover > 600 ? -120 : -30 })} onPlus={() => dispatch({ type: 'SET_COVER', id, delta: f.cover >= 600 ? 120 : 30 })} />
                <div style={{ fontSize: '0.68em', color: '#8c8372', marginTop: -6, marginBottom: 8 }}>
                  Délai total commande → livraison ≈ {fmtT(PREP_ALLOW + (hasSplit(id) ? splitTime(id, airPctOf(f)) : modeOf(g, id).time))}{hasSplit(id) ? ' en moyenne' : ''}, plus {fmtT(periodOf(f))} entre deux commandes : la couverture doit dépasser la somme des deux.
                </div>
                {hasSplit(id) && (() => {
                  const ap = airPctOf(f); const sea = d.modes.sea; const air = d.modes.air;
                  return (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '0.78em' }}>
                        <span>Split transport : <strong>{deco('🚢 ')}{100 - ap} %</strong> · <strong>{deco('✈ ')}{ap} %</strong></span>
                        <span style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => dispatch({ type: 'SET_AIR_PCT', id, delta: -10 })} disabled={ap <= 0} className="step" style={freqQtyBtnStyle}>🚢+</button>
                          <button onClick={() => dispatch({ type: 'SET_AIR_PCT', id, delta: 10 })} disabled={ap >= 100} className="step" style={freqQtyBtnStyle}>✈️+</button>
                        </span>
                      </div>
                      <div style={{ display: 'flex', height: 6, margin: '4px 0', background: '#efe8d4' }}>
                        <div style={{ width: `${100 - ap}%`, background: '#2c5d8a' }} /><div style={{ width: `${ap}%`, background: '#c9a24b' }} />
                      </div>
                      <div style={{ fontSize: '0.68em', color: '#8c8372' }}>
                        🚢 {fmtT(sea.time)} · {shipPriceTxt(sea, 'sea')} · {sea.co2} kg CO₂/pal. — ✈️ {fmtT(air.time)} · {shipPriceTxt(air, 'air')} · {air.co2} kg CO₂/pal. Chaque commande part dans un mode ; vous pouvez en basculer une à la centrale.
                      </div>
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78em' }}>{deco('🛍 ')}Points de vente : <strong>{f.pos}</strong> <span style={{ color: '#8c8372' }}>(demande ×{posMult(f).toFixed(1)})</span></span>
                  <Btn kind="gold" onClick={() => dispatch({ type: 'BUY_POS', id })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>+ Point de vente ({eur(posCost)})</Btn>
                </div>
                {f.lost > 0 && <div style={{ fontSize: '0.7em', color: '#a4262c', marginTop: 6 }}>Ventes perdues par rupture : {Math.round(f.lost).toLocaleString('fr-FR')} unités</div>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

/* ============================================================
   MARKETING, TABLEAU DE BORD, GUIDE
   ============================================================ */
const desColor = (d) => (d >= 70 ? '#2f7a57' : d >= 45 ? '#b8902f' : '#a4262c');
const MarketingPanel = ({ g, dispatch }) => {
  const open = Object.keys(FILIALE_DEFS).filter((id) => g.filiales[id].unlocked);
  const skus = activeSkus(g);
  const [sku, setSku] = useState(skus[0]);
  const [fil, setFil] = useState('ALL');
  const [lever, setLever] = useState('DIGITAL');
  const curSku = skus.includes(sku) ? sku : skus[0];
  const fils = fil === 'ALL' ? open : open.includes(fil) ? [fil] : open;
  const cost = curSku ? campaignCost(g, lever, curSku, fils) : 0;
  const L = MKT_LEVERS[lever];
  // ventes de l'heure estimées par filiale (pour chiffrer le budget A&P)
  const hourSales = (id) => skus.reduce((a, k) => a + baseRate(g, id, k) * 60 * PRODUCT_SPECS[k].sellingPricePerUnit * FILIALE_DEFS[id].price * desPrice(g.filiales[id], k), 0);
  const sel = { fontSize: '0.85em', padding: '4px 6px', border: '1px solid #c9a24b', background: '#fff', color: '#111', minWidth: 0, maxWidth: '100%' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Hint>
        Dans le luxe, le marketing est le premier poste de dépense. Chaque référence a une <strong>désirabilité</strong> sur chaque marché : elle fixe la demande de fond et le prix que vous pouvez tenir. Le <strong>budget publicité et promotion</strong> l'entretient, les <strong>campagnes</strong> la font grimper. Une rupture de stock l'abîme.
      </Hint>

      <Card title="💰 Budget publicité et promotion (A&amp;P)">
        <div style={{ fontSize: '0.74em', color: '#6f6757', marginBottom: 8 }}>
          En % des ventes de chaque filiale. Plus le budget est haut, plus la désirabilité visée est haute, avec des rendements décroissants : 0 % → {Math.round(desTarget(0))}, 5 % → {Math.round(desTarget(5))}, 10 % → {Math.round(desTarget(10))}, 20 % → {Math.round(desTarget(20))}, 30 % → {Math.round(desTarget(30))}. Les grandes maisons investissent autour de 30 % de leur chiffre d'affaires.
        </div>
        {open.map((id) => {
          const f = g.filiales[id]; const d = FILIALE_DEFS[id];
          const avg = skus.length ? skus.reduce((a, k) => a + desOf(f, k), 0) / skus.length : DES0;
          return (
            <div key={id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) auto minmax(0,1fr)', gap: 10, alignItems: 'center', padding: '4px 0', borderTop: '1px solid #f1ede2', fontSize: '0.8em' }}>
              <span>{d.flag} {d.name} <span style={{ color: '#8c8372' }}>≈ {eur(Math.round(hourSales(id) * apOf(f) / 100))}/h</span></span>
              <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button className="step" style={freqQtyBtnStyle} onClick={() => dispatch({ type: 'SET_AP', id, delta: -2 })}>-</button>
                <strong style={{ minWidth: 38, textAlign: 'center' }}>{apOf(f)} %</strong>
                <button className="step" style={freqQtyBtnStyle} onClick={() => dispatch({ type: 'SET_AP', id, delta: 2 })}>+</button>
              </span>
              <span title="Désirabilité moyenne actuelle → cible du budget">
                <Bar value={avg} max={100} color={desColor(avg)} height={5} />
                <span style={{ fontSize: '0.85em', color: '#6f6757' }}>désirabilité {Math.round(avg)} → {Math.round(desTarget(apOf(f)))}</span>
              </span>
            </div>
          );
        })}
      </Card>

      <Card title="✨ Désirabilité par référence et par marché">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.72em', width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left', padding: '3px 6px' }}>Référence</th>{open.map((id) => <th key={id} title={FILIALE_DEFS[id].name} style={{ padding: '3px 4px' }}>{FILIALE_DEFS[id].flag}</th>)}</tr></thead>
            <tbody>
              {skus.map((k) => (
                <tr key={k} style={{ borderTop: '1px solid #f1ede2' }}>
                  <td style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}>{PRODUCT_SPECS[k].name}{g.campaigns.some((c) => c.sku === k && campActive(g, c)) && ' 🔥'}</td>
                  {open.map((id) => { const v = desOf(g.filiales[id], k); return <td key={id} style={{ textAlign: 'center', padding: '3px 4px', color: desColor(v), fontWeight: 600 }} title={`Demande ×${desDemand(g.filiales[id], k).toFixed(2)} · prix ×${desPrice(g.filiales[id], k).toFixed(2)}`}>{Math.round(v)}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: '0.7em', color: '#8c8372', marginTop: 6 }}>50 = neutre. 100 : demande ×1,5 et prix +10 %. 0 : demande ×0,5 et prix −10 %. Survolez une case pour le détail.</div>
      </Card>

      <Card title="📣 Nouvelle campagne">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center', fontSize: '0.85em' }}>
          <label>Référence <select value={curSku} onChange={(e) => setSku(e.target.value)} style={sel}>{skus.map((k) => <option key={k} value={k}>{PRODUCT_SPECS[k].name}</option>)}</select></label>
          <label>Marché <select value={fil} onChange={(e) => setFil(e.target.value)} style={sel}><option value="ALL">Toutes les filiales ({open.length})</option>{open.map((id) => <option key={id} value={id}>{FILIALE_DEFS[id].flag} {FILIALE_DEFS[id].name}</option>)}</select></label>
        </div>
        <div className="g3">
          {Object.entries(MKT_LEVERS).map(([k, v]) => (
            <div key={k} onClick={() => setLever(k)} style={{ cursor: 'pointer', background: '#faf8f3', padding: 12, border: `2px solid ${lever === k ? '#c9a24b' : '#e3dac2'}` }}>
              <div style={{ fontWeight: 700, fontSize: '0.88em', marginBottom: 4 }}>{deco(v.icon)} {v.name}</div>
              <div style={{ fontSize: '0.74em', color: '#6f6757', marginBottom: 6 }}>{v.desc}</div>
              <div style={{ fontSize: '0.74em' }}>{deco('📈 ')}Ventes <strong>+{Math.round(v.boost * 100)} %</strong> pendant {fmtT(v.duration)} · ✨ désirabilité <strong>+{v.des}</strong> · ⏳ annoncée {fmtT(v.lead)} avant</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <span style={{ fontSize: '0.75em', color: '#6f6757' }}>Coût : {L.hours} h de ventes de cette référence sur ces marchés ({eur(Math.round(curSku ? skuHourSales(g, curSku, fils) : 0))}/h). Rentable si le stock suit : les filiales n'anticipent pas, montez leurs couvertures et produisez d'avance.</span>
          <Btn kind="gold" onClick={() => dispatch({ type: 'LAUNCH_CAMPAIGN', sku: curSku, fil, lever })}>{L.icon} Lancer ({eur(cost)})</Btn>
        </div>
      </Card>

      {g.campaigns.some((c) => c.lever) && (
        <Card title="🔥 Campagnes prévues et en cours">
          {g.campaigns.filter((c) => c.lever).map((c) => {
            const v = MKT_LEVERS[c.lever]; const on = campActive(g, c);
            return (
              <div key={c.id} style={{ background: '#f1ede2', padding: 8, marginBottom: 6, fontSize: '0.78em' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span>{v.icon} <strong>{PRODUCT_SPECS[c.sku].name}</strong> · {c.fils.length > 1 ? `${c.fils.length} marchés` : `${FILIALE_DEFS[c.fils[0]].flag} ${FILIALE_DEFS[c.fils[0]].name}`}</span>
                  <span style={{ color: on ? '#2f7a57' : '#b8902f' }}>{on ? `en cours, encore ${fmtT(c.end - g.t)}` : `démarre dans ${fmtT(c.start - g.t)}`}</span>
                </div>
                {on && <div style={{ color: '#6f6757', marginTop: 3 }}>Ventes en plus : <strong>{eur(Math.round(c.incr))}</strong> pour {eur(c.cost)}{c.lost > 0 && <span style={{ color: '#a4262c' }}> · {c.lost} ventes perdues en rupture</span>}</div>}
                <Bar value={on ? g.t - c.start : 0} max={c.end - c.start} color="#2f7a57" height={4} />
              </div>
            );
          })}
        </Card>
      )}

      {(g.mktLog || []).length > 0 && (
        <Card title="📊 Bilans des dernières campagnes">
          {g.mktLog.map((b) => (
            <div key={b.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) repeat(3, auto)', gap: 10, fontSize: '0.76em', padding: '4px 0', borderTop: '1px solid #f1ede2', alignItems: 'center' }}>
              <span>{deco(MKT_LEVERS[b.lever].icon)} {PRODUCT_SPECS[b.sku].name} · {b.fils.length > 1 ? `${b.fils.length} marchés` : FILIALE_DEFS[b.fils[0]].name}</span>
              <span>{eur(b.incr)} / {eur(b.cost)}</span>
              <strong style={{ color: b.roi >= 1 ? '#2f7a57' : '#a4262c' }}>×{b.roi.toFixed(1)}</strong>
              <span style={{ color: b.lost > 0 ? '#a4262c' : '#2f7a57' }}>{b.lost > 0 ? `${b.lost} perdues` : 'sans rupture'}</span>
            </div>
          ))}
          <div style={{ fontSize: '0.7em', color: '#8c8372', marginTop: 6 }}>×1 = la campagne a rapporté en ventes ce qu'elle a coûté. Le gain de désirabilité, lui, dure bien après.</div>
        </Card>
      )}
    </div>
  );
};

// Compte de résultat : dernière heure complète et dernier jour complet
const PLCard = ({ g }) => {
  const [view, setView] = useState('h0');
  if (!g.pl) return null;
  const hs = g.pl.hours || (g.pl.hprev ? [g.pl.hprev] : []); const dp = g.pl.prev;
  const cols = {};
  [0, 1, 2].forEach((i) => { const h = hs[i]; cols[`h${i}`] = [h ? `${h.hour}h-${h.hour + 1}h` : `H-${i + 1}`, h]; });
  cols.day = [dp ? `Jour J${dp.day}` : 'Dernier jour', dp];
  const isHour = view !== 'day';
  const empty = !cols[view][1];
  const c = cols[view][1] || {}; const ca = c.ventes || 0; const op = plOp(c);
  // Sur une heure, l'impôt est estimé : le barème de la nuit appliqué à cette heure répétée 24 fois
  const tax = (isHour ? -dayTax(op * 24) / 24 : c.impot) || 0; const net = op + tax;
  const pctCa = (v) => (ca > 0 ? `${Math.round((v / ca) * 1000) / 10} %` : '');
  const row = (label, v, opts = {}) => (
    <div key={label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px 60px', gap: 8, padding: opts.total ? '6px 0' : '3px 0', borderTop: opts.total ? '1px solid #c9a24b' : '1px solid #f1ede2', fontWeight: opts.total ? 700 : 400, fontSize: opts.total ? '0.85em' : '0.78em', color: opts.muted ? '#8c8372' : '#1a1a1a' }}>
      <span style={{ paddingLeft: opts.indent ? 12 : 0 }}>{label}</span>
      <span style={{ textAlign: 'right', color: v < 0 && !opts.total ? '#a4262c' : undefined }}>{eur(Math.round(v))}</span>
      <span style={{ textAlign: 'right', color: '#8c8372', fontWeight: 400 }}>{pctCa(v)}</span>
    </div>
  );
  return (
    <Card title="📒 Compte de résultat" right={
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {Object.entries(cols).map(([k, [label]]) => (
          <button key={k} onClick={() => setView(k)} style={{ ...actionBtnStyle, fontSize: '0.68em', padding: '3px 8px', background: view === k ? '#111' : '#fff', color: view === k ? '#c9a24b' : '#111', border: '1px solid #c9a24b' }}>{label}</button>
        ))}
      </div>
    }>
      {empty ? <div style={{ fontSize: '0.8em', color: '#8c8372' }}>{isHour ? "Cette heure n'est pas encore clôturée : les comptes se ferment à chaque heure pile." : 'Le premier jour complet se clôture à minuit. En attendant, regardez la dernière heure.'}</div> : (
        <div>
          {row("Chiffre d'affaires", ca, { total: true })}
          {PL_LINES.filter(([k]) => k !== 'ventes' && (c[k] || 0) !== 0).map(([k, label]) => row(label, c[k], { indent: true }))}
          {row("Résultat d'exploitation", op, { total: true })}
          {row(isHour ? 'Impôt sur les bénéfices (estimé)' : 'Impôt sur les bénéfices', tax, { indent: true })}
          {row('Résultat net', net, { total: true })}
          <div style={{ marginTop: 8, fontSize: '0.72em', color: '#6f6757' }}>Hors résultat : investissements {eur(Math.abs(Math.round(c.invest || 0)))} · primes d'objectifs {eur(Math.round(c.primes || 0))}</div>
          <div style={{ marginTop: 6, fontSize: '0.7em', color: '#8c8372' }}>
            Frais commerciaux : {Math.round(commercialRate(g) * 1000) / 10} % des ventes avec {openFilialesCount(g)} filiale{openFilialesCount(g) > 1 ? 's' : ''} (0 % jusqu'à 2, +2,5 points par filiale, 30 % au plus).
            Structure : {eur(structureCost(g))}/h. Impôt chaque nuit sur le résultat de la journée : 0 % jusqu'à 50 000 €, 15 % jusqu'à 250 000 €, 25 % jusqu'à 1 M€, 33 % au-delà.
          </div>
          {g.pl.days && g.pl.days.length > 1 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: '0.7em' }}>
              {g.pl.days.slice(-7).map((d) => (
                <div key={d.day} style={{ background: '#f1ede2', padding: '4px 8px' }}>J{d.day} : <strong style={{ color: d.net < 0 ? '#a4262c' : '#2f7a57' }}>{eur(Math.round(d.net))}</strong> <span style={{ color: '#8c8372' }}>({d.ca > 0 ? Math.round((d.net / d.ca) * 100) : 0} %)</span></div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

const DashboardPanel = ({ g }) => {
  const open = Object.entries(g.filiales).filter(([, f]) => f.unlocked);
  const otifG = g.stats.ordersDelivered ? g.stats.otif / g.stats.ordersDelivered : null;
  const fill = g.stats.truckFill.length ? g.stats.truckFill.reduce((a, b) => a + b, 0) / g.stats.truckFill.length : null;
  const maxRev = Math.max(1, ...g.history.map((h) => h.rev));
  const tiles = [
    ["CA cumulé", eur(g.stats.revenue)],
    ['Charges fixes', `${eur(hourlyCosts(g))}/h`],
    ['OTIF global (à l\'heure et complet)', pct(otifG)],
    ['Remplissage camions', pct(fill)],
    ['Stock centrale', `${dcPallets(g.dc)} pal.`],
    ['Transport filiales', eur(g.stats.transportCost)],
    ["Chantiers d'amélioration", `${g.stats.kaizen}`],
    ['Empreinte transport', `${(g.stats.co2 / 1000).toFixed(1)} t CO₂`],
    ['Part avion (export)', pct(g.stats.palAir + g.stats.palSea > 0 ? g.stats.palAir / (g.stats.palAir + g.stats.palSea) : null)],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="g3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {tiles.map(([l, v]) => (
          <div key={l} style={{ background: '#faf8f3', padding: 12, borderTop: '2px solid #c9a24b' }}>
            <div style={{ fontSize: '0.65em', color: '#6f6757', textTransform: 'uppercase', letterSpacing: 1 }}>{l}</div>
            <div style={{ fontSize: '1.25em', fontFamily: 'Didot, Georgia, serif' }}>{v}</div>
          </div>
        ))}
      </div>
      <PLCard g={g} />
      <Card title="⏱ Heure par heure (CA et résultat)">
        {g.history.length === 0 ? <div style={{ fontSize: '0.8em', color: '#8c8372' }}>Le premier bilan arrive à la prochaine heure pile.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {g.history.map((h, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px minmax(0,1fr) 100px', gap: 8, alignItems: 'center', fontSize: '0.75em' }}>
                <span style={{ color: '#6f6757' }}>{h.label}</span>
                <Bar value={h.rev} max={maxRev} color="#c9a24b" height={10} />
                <span style={{ textAlign: 'right', color: h.net >= 0 ? '#2f7a57' : '#a4262c' }}>{h.net >= 0 ? '+' : ''}{eur(h.net)}</span>
              </div>
            ))}
            <div style={{ fontSize: '0.68em', color: '#8c8372' }}>Barre dorée : chiffre d'affaires de l'heure. À droite : variation de trésorerie (après investissements).</div>
          </div>
        )}
      </Card>
      <Card title="🌍 Filiales">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.78em', borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', color: '#6f6757' }}>{['Filiale', 'Service', 'OTIF', 'Satisf.', 'Ventes perdues', 'CA'].map((h) => <th key={h} style={{ padding: 4, borderBottom: '1px solid #e6dcc0' }}>{h}</th>)}</tr></thead>
            <tbody>
              {open.map(([id, f]) => (
                <tr key={id}>
                  <td style={{ padding: 4 }}>{FILIALE_DEFS[id].flag} {FILIALE_DEFS[id].name}</td>
                  <td style={{ padding: 4 }}>{pct(svcOf(f))}</td>
                  <td style={{ padding: 4 }}>{pct(otifOf(f))}</td>
                  <td style={{ padding: 4 }}>{Math.round(f.sat * 100)} %</td>
                  <td style={{ padding: 4 }}>{Math.round(f.lost).toLocaleString('fr-FR')} u</td>
                  <td style={{ padding: 4 }}>{eur(f.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

const RDPanel = ({ g, dispatch, ask }) => {
  const rd = g.rd;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Hint>
        Chaque nouvelle référence est un <strong>projet de développement</strong> : formule, tests de stabilité et de tolérance, packaging, réglementaire.
        C'est long et cher, et chaque projet coûte 30 % de plus que le précédent. Une fois sortie, toutes les filiales la commandent : il faudra la produire.
      </Hint>
      <Card title={`🧪 Laboratoires (${rd.projects.length}/${rd.labs} occupés)`} right={<Btn onClick={() => dispatch({ type: 'BUY_LAB' })} style={{ fontSize: '0.72em', padding: '4px 8px' }}>+ Laboratoire ({eur(LAB_COST * rd.labs)})</Btn>}>
        {rd.projects.length === 0 && <div style={{ fontSize: '0.82em', color: '#8c8372' }}>Aucun projet en cours.</div>}
        {rd.projects.map((pr) => (
          <div key={pr.sku} style={{ background: '#f1ede2', padding: 8, marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', marginBottom: 4 }}>
              <span title={skuTip(pr.sku)}>{deco(FACTORY_DEFS[PRODUCT_SPECS[pr.sku].factory].icon)} {PRODUCT_SPECS[pr.sku].name}</span><strong>sortie dans {fmtT(pr.end - g.t)}</strong>
            </div>
            <Bar value={g.t - pr.start} max={pr.end - pr.start} color="#2f7a57" />
          </div>
        ))}
      </Card>
      <div className="g2">
        {Object.keys(FACTORY_DEFS).filter((fid) => g.factories[fid].unlocked).map((fid) => {
          const def = FACTORY_DEFS[fid];
          const next = nextRdSku(g, fid);
          const busy = g.rd.projects.some((p) => PRODUCT_SPECS[p.sku].factory === fid);
          return (
            <Card key={fid} title={`${def.icon} ${def.name}`}>
              {def.skus.map((sku) => {
                const st = g.launched[sku] ? ['✔ En gamme', '#2f7a57'] : g.rd.projects.some((p) => p.sku === sku) ? ['🧪 En développement', '#a8842c'] : sku === next ? ['Prochain projet', '#111'] : ['🔒 Plus tard', '#b9ae93'];
                return (
                  <div key={sku} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.8em', padding: '4px 0', borderBottom: '1px solid #f1ede2' }}>
                    <span title={skuTip(sku)} style={{ cursor: 'help', color: st[1] === '#b9ae93' ? '#8c8372' : '#111' }}>{PRODUCT_SPECS[sku].name} <span style={{ color: '#8c8372' }}>· {PRODUCT_SPECS[sku].sellingPricePerUnit} €</span></span>
                    <span style={{ color: st[1], whiteSpace: 'nowrap' }}>{st[0]}</span>
                  </div>
                );
              })}
              {next && !busy && (
                <Btn kind="green" onClick={() => ask(`🧪 Développer ${PRODUCT_SPECS[next].name} pour ${eur(rdCost(g, next))} ? Sortie dans ${fmtT(RD_TICKS[fid])}.`, () => dispatch({ type: 'START_RD', sku: next }))} style={{ width: '100%', marginTop: 10 }}>
                  Développer {PRODUCT_SPECS[next].name} ({eur(rdCost(g, next))}, {fmtT(RD_TICKS[fid])})
                </Btn>
              )}
              {!next && !busy && <div style={{ fontSize: '0.75em', color: '#2f7a57', marginTop: 8 }}>Gamme complète pour cette usine.</div>}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

const GuidePanel = ({ g }) => {
  const done = MILESTONES.slice(0, g.msIndex);
  const next = MILESTONES[g.msIndex];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {next && (
        <Card title={`🎯 Objectif en cours · chapitre ${next.chapter}`}>
          <div style={{ fontWeight: 600 }}>{next.title}</div>
          <div style={{ fontSize: '0.85em', color: '#3a352c', marginTop: 4 }}>{next.goal}</div>
          <div style={{ fontSize: '0.75em', color: '#a8842c', marginTop: 6 }}>Ce qui se débloque ensuite : {next.unlocks.map((k) => FEATURE_INFO[k][1]).join(', ') || 'le titre final'}.</div>
        </Card>
      )}
      <Card title={`📘 Dans la vraie vie (${done.length} fiche${done.length > 1 ? 's' : ''})`}>
        {done.length === 0 && <div style={{ fontSize: '0.82em', color: '#8c8372' }}>Les fiches apparaissent au fil des objectifs atteints.</div>}
        {done.map((m) => (
          <div key={m.id} style={{ padding: '10px 0', borderBottom: '1px solid #f1ede2' }}>
            <div style={{ fontSize: '0.68em', letterSpacing: 2, textTransform: 'uppercase', color: '#a8842c' }}>Chapitre {m.chapter} · {CHAPTERS[m.chapter]}</div>
            <div style={{ fontWeight: 600, margin: '2px 0 4px 0' }}>{m.lesson[0]}</div>
            <div style={{ fontSize: '0.84em', color: '#3a352c', lineHeight: 1.5 }}>{m.lesson[1]}</div>
          </div>
        ))}
      </Card>
      <Card title="📰 Journal des événements">
        {g.log.length === 0 && <div style={{ fontSize: '0.82em', color: '#8c8372' }}>Rien pour l'instant.</div>}
        {g.log.map((e) => (
          <div key={e.id} style={{ fontSize: '0.76em', padding: '3px 0', borderBottom: '1px solid #f6f2e7' }}>
            <span style={{ color: '#8c8372', marginRight: 8 }}>{e.at}</span><span style={{ color: TOAST_COLORS[e.type] }}>{deco(e.msg)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
};

/* ============================================================
   COMPOSANT PRINCIPAL
   ============================================================ */
/* ============================================================
   GLOBE 3D DES TRANSPORTS (v5.4)
   Un globe en projection orthographique dessiné sur un <canvas>, sans bibliothèque :
   on le fait tourner à la souris (ou au doigt), on zoome à la molette (ou en pinçant).
   Chaque camion, bateau et avion du jeu y avance en direct, à sa vraie position.

   Les usines et la centrale sont des sites placés sur la carte, dans l'Yonne et ses environs.
   Voir GEO_SITES pour l'adresse et la fiche de chaque site.
   ============================================================ */
const D2R = Math.PI / 180;

/* --- Les sites de la maison --- */
const GEO_SITES_BASE = {
  PARFUM: {
    lat: 47.760, lon: 4.060, town: 'Orvelle-sur-Serein', dept: 'Yonne',
    addr: 'Zone du Moulin-Neuf, Orvelle-sur-Serein',
    facts: "Le berceau de la maison, ouvert en 1987 au bord du Serein : 18 000 m², 14 lignes de conditionnement, environ 180 personnes. Eaux de parfum et eaux de toilette.",
    sources: [],
    note: 'Emplacement indicatif sur la carte.',
  },
  SKINCARE: {
    lat: 47.940, lon: 3.400, town: 'Saint-Ambrel', dept: 'Yonne',
    addr: 'Zone des Grands-Prés, Saint-Ambrel',
    facts: "Usine de soin ouverte en 1998 : 32 000 m², environ 320 personnes, 20 lignes et une salle blanche pour les sérums. Environ 90 millions d'unités par an.",
    sources: [],
    note: 'Emplacement indicatif sur la carte.',
  },
  MAKEUP: {
    lat: 47.560, lon: 3.980, town: 'Clairmoutier', dept: "Côte-d'Or",
    addr: "Route de l'Auxois, Clairmoutier",
    facts: 'Usine de maquillage de 26 000 m² ouverte en 2006 : rouges coulés, mascaras et fonds de teint, environ 250 personnes.',
    sources: [],
    note: 'Emplacement indicatif sur la carte.',
  },
  PRESTIGE: {
    lat: 47.980, lon: 2.930, town: "Val-d'Aurenne", dept: 'Loiret',
    addr: "Domaine des Tilleuls, Val-d'Aurenne",
    facts: 'Un atelier de 6 000 m² : extraits et éditions limitées, flacons remplis et polis à la main par une soixantaine d\'artisans.',
    sources: [],
    note: 'Emplacement indicatif sur la carte.',
  },
  DC: {
    lat: 47.700, lon: 3.770, town: 'Montrésin', dept: 'Yonne',
    addr: "Parc logistique des Vaux, Montrésin (Yonne), au bord de l'A6",
    facts: 'La plateforme de la maison : elle reçoit la production des quatre usines et expédie vers les filiales du monde entier. Bâtie cellule par cellule, elle peut monter à 8 cellules et environ 55 000 emplacements palettes.',
    sources: [],
    note: 'Emplacement indicatif sur la carte.',
  },
};
// La marque peut compléter les fiches (faits, liens) : voir BRAND.sites
const GEO_SITES = Object.fromEntries(Object.entries(GEO_SITES_BASE).map(([k, v]) => [k, { ...v, ...(BRAND.sites[k] || {}) }]));
/* Filiales : le jeu livre l'entrepôt de la filiale, placé dans sa ville */
const FIL_GEO = {
  FR: { lat: 48.857, lon: 2.352 },
  DE: { lat: 51.228, lon: 6.774 },
  US: { lat: 40.713, lon: -74.006 },
  AE: { lat: 25.205, lon: 55.271 },
  CN: { lat: 31.230, lon: 121.474 },
  ES: { lat: 40.417, lon: -3.704 },
  UK: { lat: 51.507, lon: -0.128 },
  IT: { lat: 45.464, lon: 9.190 },
  BR: { lat: -23.550, lon: -46.633 },
  ZA: { lat: -26.204, lon: 28.047 },
  KR: { lat: 37.566, lon: 126.978 },
  JP: { lat: 35.676, lon: 139.650 },
  SG: { lat: 1.352, lon: 103.820 },
  AU: { lat: -33.869, lon: 151.209 },
};
/* Ports, aéroports et fournisseurs (réels, pour le décor) */
const HUBS = {
  HAVRE:  { lat: 49.467, lon: 0.155,   name: 'Port du Havre (Port 2000)', icon: '⚓' },
  CDG:    { lat: 49.010, lon: 2.548,   name: 'Aéroport Paris-CDG (fret)', icon: '🛫' },
  NEWARK: { lat: 40.684, lon: -74.152, name: 'Port de New York-Newark', icon: '⚓' },
  JFK:    { lat: 40.641, lon: -73.778, name: 'Aéroport JFK', icon: '🛬' },
  JEBEL:  { lat: 25.011, lon: 55.061,  name: 'Port de Jebel Ali', icon: '⚓' },
  DXB:    { lat: 25.253, lon: 55.366,  name: 'Aéroport de Dubaï', icon: '🛬' },
  YANGSHAN: { lat: 30.626, lon: 122.065, name: 'Port de Yangshan (Shanghai)', icon: '⚓' },
  PVG:    { lat: 31.144, lon: 121.808, name: 'Aéroport de Shanghai-Pudong', icon: '🛬' },
  SANTOS: { lat: -23.980, lon: -46.300, name: 'Port de Santos', icon: '⚓' },
  GRU:    { lat: -23.435, lon: -46.473, name: 'Aéroport de São Paulo-Guarulhos', icon: '🛬' },
  DURBAN: { lat: -29.870, lon: 31.030,  name: 'Port de Durban', icon: '⚓' },
  JNB:    { lat: -26.139, lon: 28.246,  name: 'Aéroport de Johannesburg', icon: '🛬' },
  BUSAN:  { lat: 35.080, lon: 129.040,  name: 'Port de Busan', icon: '⚓' },
  ICN:    { lat: 37.460, lon: 126.440,  name: "Aéroport d'Incheon", icon: '🛬' },
  YOKOHAMA: { lat: 35.450, lon: 139.660, name: 'Port de Yokohama', icon: '⚓' },
  NRT:    { lat: 35.772, lon: 140.393,  name: 'Aéroport de Tokyo-Narita', icon: '🛬' },
  PSA:    { lat: 1.264, lon: 103.840,   name: 'Port de Singapour', icon: '⚓' },
  SIN:    { lat: 1.364, lon: 103.990,   name: 'Aéroport de Singapour-Changi', icon: '🛬' },
  BOTANY: { lat: -33.970, lon: 151.210, name: 'Port Botany (Sydney)', icon: '⚓' },
  SYD:    { lat: -33.940, lon: 151.175, name: 'Aéroport de Sydney', icon: '🛬' },
  BRESLE: { lat: 49.950, lon: 1.560,   name: 'Vallée de la Bresle : verriers (flacons)', icon: '🍾' },
  GRASSE: { lat: 43.658, lon: 6.923,   name: 'Grasse : essences et concentrés', icon: '🌸' },
};
const pt = (o) => [o.lat, o.lon];
const DCP = pt(GEO_SITES.DC);
/* Grands axes routiers (A6, A19, A10…), en points de passage approximatifs */
/* La centrale de Montrésin est au bord de l'A6 : on rejoint Paris et l'ouest par l'A6 et l'A19 */
const A6_AUXERRE = [47.80, 3.57];
const A19_A6 = [48.04, 3.12];
const FAC_WPS = {
  PARFUM:   [pt(GEO_SITES.PARFUM), [47.73, 3.92], DCP],
  SKINCARE: [pt(GEO_SITES.SKINCARE), [47.87, 3.50], A6_AUXERRE, DCP],
  MAKEUP:   [pt(GEO_SITES.MAKEUP), [47.62, 3.88], DCP],
  PRESTIGE: [pt(GEO_SITES.PRESTIGE), A19_A6, [47.90, 3.40], A6_AUXERRE, DCP],
};
const TO_HAVRE = [DCP, A6_AUXERRE, A19_A6, [48.08, 1.88], [48.45, 1.49], [49.02, 1.15], [49.44, 1.10], [49.47, 0.47], pt(HUBS.HAVRE)];
const TO_CDG = [DCP, A6_AUXERRE, A19_A6, [48.40, 2.70], [48.62, 2.62], [48.85, 2.62], pt(HUBS.CDG)];
const CHANNEL_OUT = [pt(HUBS.HAVRE), [49.75, -0.5], [50.0, -2.0], [49.6, -5.4]];
const TO_SUEZ = [...CHANNEL_OUT, [48.3, -6.2], [43.6, -9.7], [36.9, -9.6], [35.95, -5.7], [36.8, 0], [37.4, 10.5], [34.6, 20], [31.7, 32.2], [30.0, 32.57], [27.8, 33.8], [20.5, 38.6], [12.6, 43.35], [12.0, 46.5]];
const SEA_WPS = {
  US: [...CHANNEL_OUT, [45.0, -40.0], [40.45, -73.6], pt(HUBS.NEWARK)],
  AE: [...TO_SUEZ, [14.5, 53.0], [22.6, 60.2], [26.4, 56.7], pt(HUBS.JEBEL)],
  CN: [...TO_SUEZ, [8.5, 70], [5.6, 80.5], [5.9, 95.0], [3.0, 100.6], [1.2, 103.9], [5.0, 106.5], [12.0, 110.6], [22.0, 116.3], [25.5, 120.3], [30.0, 122.6], pt(HUBS.YANGSHAN)],
  SG: [...TO_SUEZ, [8.5, 70], [5.6, 80.5], [5.9, 95.0], [3.0, 100.6], pt(HUBS.PSA)],
  KR: [...TO_SUEZ, [8.5, 70], [5.6, 80.5], [5.9, 95.0], [3.0, 100.6], [1.2, 103.9], [5.0, 106.5], [12.0, 110.6], [22.0, 116.3], [25.5, 120.3], [30.0, 124.0], [33.0, 127.8], [34.6, 128.9], pt(HUBS.BUSAN)],
  JP: [...TO_SUEZ, [8.5, 70], [5.6, 80.5], [5.9, 95.0], [3.0, 100.6], [1.2, 103.9], [5.0, 106.5], [12.0, 110.6], [22.0, 116.3], [24.0, 119.5], [25.8, 121.2], [30.0, 130.5], [32.5, 134.0], [33.3, 136.5], [34.8, 139.8], pt(HUBS.YOKOHAMA)],
  AU: [...TO_SUEZ, [5.0, 60.0], [-10.0, 85.0], [-30.0, 108.0], [-35.6, 114.8], [-36.5, 122.0], [-39.5, 141.0], [-39.6, 146.6], [-38.3, 150.2], [-34.5, 151.4], pt(HUBS.BOTANY)],
  BR: [...CHANNEL_OUT, [48.3, -6.2], [43.6, -9.7], [28.0, -17.0], [15.0, -26.0], [0.0, -30.0], [-8.0, -33.5], [-20.0, -38.5], [-24.3, -45.8], pt(HUBS.SANTOS)],
  ZA: [...CHANNEL_OUT, [48.3, -6.2], [43.6, -9.7], [28.0, -17.0], [15.0, -20.0], [0.0, -5.0], [-15.0, 8.0], [-30.0, 14.0], [-35.3, 19.0], [-34.7, 26.0], [-31.5, 31.0], pt(HUBS.DURBAN)],
};
const AIR_END = { US: 'JFK', AE: 'DXB', CN: 'PVG', BR: 'GRU', ZA: 'JNB', KR: 'ICN', JP: 'NRT', SG: 'SIN', AU: 'SYD' };
const SEA_END = { US: 'NEWARK', AE: 'JEBEL', CN: 'YANGSHAN', BR: 'SANTOS', ZA: 'DURBAN', KR: 'BUSAN', JP: 'YOKOHAMA', SG: 'PSA', AU: 'BOTANY' };
const ROAD_WPS = {
  FR: [DCP, A6_AUXERRE, A19_A6, [48.40, 2.70], [48.75, 2.35], pt(FIL_GEO.FR)],
  DE: [DCP, [48.30, 4.08], [48.96, 4.36], [49.12, 6.17], [49.6, 6.1], [50.36, 7.59], [50.94, 6.96], pt(FIL_GEO.DE)],
  UK: [DCP, A6_AUXERRE, A19_A6, [48.40, 2.70], [48.85, 2.62], [49.20, 2.60], [50.00, 2.85], [50.33, 2.80], [50.75, 2.25], [50.92, 1.82], [51.08, 1.17], [51.27, 0.52], pt(FIL_GEO.UK)],
  ES: [DCP, A6_AUXERRE, A19_A6, [47.90, 1.90], [47.39, 0.69], [46.58, 0.34], [44.84, -0.58], [43.35, -1.75], [42.85, -2.67], [41.65, -3.69], pt(FIL_GEO.ES)],
  IT: [DCP, [47.45, 4.20], [47.02, 4.84], [46.31, 4.83], [46.20, 5.60], [46.20, 6.14], [45.92, 6.87], [45.74, 7.32], [45.47, 8.6], pt(FIL_GEO.IT)],
};

/* --- Géométrie sur la sphère --- */
const toVec = ([la, lo]) => { const p = la * D2R; const l = lo * D2R; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };
const angDist = (a, b) => { const u = toVec(a); const v = toVec(b); return Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))); };
const slerp = (a, b, t) => {
  const u = toVec(a); const v = toVec(b);
  const d = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])));
  if (d < 1e-9) return a;
  const s1 = Math.sin((1 - t) * d) / Math.sin(d); const s2 = Math.sin(t * d) / Math.sin(d);
  const x = s1 * u[0] + s2 * v[0]; const y = s1 * u[1] + s2 * v[1]; const z = s1 * u[2] + s2 * v[2];
  return [Math.asin(Math.max(-1, Math.min(1, z))) / D2R, Math.atan2(y, x) / D2R];
};
/* Densifie une suite de points de passage en arcs de grand cercle (un point tous les ~0,4°) */
const buildPath = (wps, alt = 0) => {
  const pts = [wps[0]]; const cum = [0];
  for (let i = 1; i < wps.length; i++) {
    const d = angDist(wps[i - 1], wps[i]);
    const n = Math.max(1, Math.ceil(d / (0.4 * D2R)));
    for (let k = 1; k <= n; k++) { pts.push(slerp(wps[i - 1], wps[i], k / n)); cum.push(cum[cum.length - 1] + d / n); }
  }
  const len = cum[cum.length - 1] || 1e-9;
  const peak = alt ? Math.min(0.09, 0.015 + len * 0.035) : 0;
  return { pts: pts.map((p, i) => [p[0], p[1], peak * Math.sin(Math.PI * (cum[i] / len))]), cum, len };
};
const pathAt = (path, u) => {
  const target = Math.max(0, Math.min(1, u)) * path.len;
  let lo = 0; let hi = path.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.cum[m] <= target) lo = m; else hi = m; }
  const seg = path.cum[hi] - path.cum[lo] || 1e-9;
  const t = (target - path.cum[lo]) / seg;
  const a = path.pts[lo]; const b = path.pts[hi];
  const [la, lo2] = slerp([a[0], a[1]], [b[0], b[1]], t);
  return [la, lo2, a[2] + (b[2] - a[2]) * t];
};
/* Un itinéraire = plusieurs tronçons (route, mer, air), chacun avec sa part du temps de trajet */
const buildRoute = (legs) => {
  let acc = 0;
  return legs.map(([kind, wps, share]) => { const leg = { kind, path: buildPath(wps, kind === 'air' ? 1 : 0), w0: acc, w1: acc + share }; acc += share; return leg; });
};
const routeAt = (route, p) => {
  const leg = route.find((l) => p <= l.w1) || route[route.length - 1];
  const u = (p - leg.w0) / (leg.w1 - leg.w0 || 1);
  const [lat, lon, h] = pathAt(leg.path, u);
  return { lat, lon, h, kind: leg.kind };
};
let ROUTES_CACHE = null;
const getRoutes = () => {
  if (ROUTES_CACHE) return ROUTES_CACHE;
  const fac = {}; Object.keys(FAC_WPS).forEach((fid) => { fac[fid] = buildRoute([['road', FAC_WPS[fid], 1]]); });
  const fil = {};
  Object.keys(FILIALE_DEFS).forEach((id) => {
    fil[id] = {};
    if (ROAD_WPS[id]) fil[id].road = buildRoute([['road', ROAD_WPS[id], 1]]);
    if (SEA_WPS[id]) fil[id].sea = buildRoute([['road', TO_HAVRE, 0.06], ['sea', SEA_WPS[id], 0.88], ['road', [pt(HUBS[SEA_END[id]]), pt(FIL_GEO[id])], 0.06]]);
    if (AIR_END[id]) fil[id].air = buildRoute([['road', TO_CDG, 0.15], ['air', [pt(HUBS.CDG), pt(HUBS[AIR_END[id]])], 0.75], ['road', [pt(HUBS[AIR_END[id]]), pt(FIL_GEO[id])], 0.10]]);
  });
  const sup = {};
  Object.keys(FAC_WPS).forEach((fid) => {
    const f = pt(GEO_SITES[fid]);
    sup[`BRESLE_${fid}`] = buildRoute([['road', [pt(HUBS.BRESLE), [49.43, 2.08], [48.85, 2.62], [48.40, 2.70], A19_A6, f], 1]]);
    sup[`GRASSE_${fid}`] = buildRoute([['road', [pt(HUBS.GRASSE), [43.53, 5.45], [43.95, 4.81], [45.76, 4.84], [46.31, 4.83], [47.02, 4.84], f], 1]]);
  });
  ROUTES_CACHE = { fac, fil, sup };
  return ROUTES_CACHE;
};
/* Quel fournisseur livre quel composant (seuls le verre et les essences sont cartographiés) */
const supplierOf = (comp) => (/FLACON|POT_CREME/.test(comp) ? 'BRESLE' : comp === 'ESSENCES' ? 'GRASSE' : null);

/* --- Contours des terres et frontières (Natural Earth 1:50m, simplifiés) --- */
let GEO_CACHE = null;
const decodeLine = (str) => {
  const a = str.split(',').map(Number); const out = [];
  let x = 0; let y = 0;
  for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; out.push([x / 20, y / 20]); }
  return out;
};
const getGeo = () => {
  if (!GEO_CACHE) {
    GEO_CACHE = {
      land: { type: 'MultiPolygon', coordinates: GEO_DATA.L.split(';').map((poly) => poly.split('|').map((r) => { const ring = decodeLine(r); ring.push(ring[0]); return ring; })) },
      borders: { type: 'MultiLineString', coordinates: GEO_DATA.B.split(';').map(decodeLine) },
      graticule: geoGraticule10(),
    };
  }
  return GEO_CACHE;
};

/* --- Habillage du globe (v5.6) : vue spatiale de loin, carte détaillée de près --- */
const glClamp = (t) => Math.max(0, Math.min(1, t));
const glSmooth = (t) => { const x = glClamp(t); return x * x * (3 - 2 * x); };
const glMix = (a, b, t) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
const glMixA = (a, b, t) => `rgba(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)},${(a[3] + (b[3] - a[3]) * t).toFixed(3)})`;
/* Ciel étoilé : positions fixes (tirage pseudo-aléatoire reproductible) + une bande de Voie lactée */
const GL_STARS = (() => {
  let seed = 20261123; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const cols = ['#ffffff', '#ffffff', '#fff4dc', '#dce8ff', '#ffe2b8'];
  const out = [];
  for (let i = 0; i < 950; i++) {
    const big = rnd() < 0.06;
    out.push([rnd(), rnd(), big ? 0.75 + rnd() * 0.25 : 0.25 + rnd() * 0.5, rnd() < 0.25 ? rnd() : 0, cols[Math.floor(rnd() * cols.length)], big ? 1.6 + rnd() * 0.9 : 0.6 + rnd() * 0.7]);
  }
  for (let i = 0; i < 900; i++) { // Voie lactée : étoiles fines le long d'une diagonale
    const x = rnd(); const g = (rnd() + rnd() + rnd() - 1.5) * 0.09;
    out.push([x, (0.5 + (x - 0.5) * 0.42 + g + 1) % 1, 0.12 + rnd() * 0.3, 0, '#e6ecff', 0.5 + rnd() * 0.5]);
  }
  return out;
})();
/* Villes : [lat, lon, nom, rang]. Rang 1 = grandes métropoles (lumières vues de l'espace),
   2 = grandes villes, 3 = villes régionales autour des usines (visibles de près) */
const GL_CITIES = [
  [35.68, 139.69, 'Tokyo', 1], [40.71, -74.01, 'New York', 1], [51.51, -0.13, 'Londres', 1], [48.86, 2.35, 'Paris', 1], [31.23, 121.47, 'Shanghai', 1],
  [39.90, 116.40, 'Pékin', 1], [55.76, 37.62, 'Moscou', 1], [30.04, 31.24, 'Le Caire', 1], [19.08, 72.88, 'Bombay', 1], [28.61, 77.21, 'Delhi', 1],
  [-23.55, -46.63, 'São Paulo', 1], [19.43, -99.13, 'Mexico', 1], [34.05, -118.24, 'Los Angeles', 1], [41.88, -87.63, 'Chicago', 1], [41.01, 28.98, 'Istanbul', 1],
  [6.52, 3.38, 'Lagos', 1], [37.57, 126.98, 'Séoul', 1], [-6.21, 106.85, 'Jakarta', 1], [13.76, 100.50, 'Bangkok', 1], [22.32, 114.17, 'Hong Kong', 1],
  [-34.60, -58.38, 'Buenos Aires', 1], [25.20, 55.27, 'Dubaï', 1], [-26.20, 28.05, 'Johannesburg', 1], [-33.87, 151.21, 'Sydney', 1], [1.35, 103.82, 'Singapour', 1],
  [35.69, 51.39, 'Téhéran', 1], [24.86, 67.00, 'Karachi', 1], [23.81, 90.41, 'Dacca', 1], [14.60, 120.98, 'Manille', 1], [34.69, 135.50, 'Osaka', 1],
  [-22.91, -43.17, 'Rio de Janeiro', 1], [-12.05, -77.04, 'Lima', 1], [4.71, -74.07, 'Bogota', 1], [-4.44, 15.27, 'Kinshasa', 1], [43.65, -79.38, 'Toronto', 1],
  [40.42, -3.70, 'Madrid', 1], [45.46, 9.19, 'Milan', 1], [52.52, 13.40, 'Berlin', 1], [24.71, 46.68, 'Riyad', 1], [23.13, 113.26, 'Canton', 1],
  [22.54, 114.06, 'Shenzhen', 1], [30.57, 104.07, 'Chengdu', 1], [30.59, 114.31, 'Wuhan', 1], [13.08, 80.27, 'Chennai', 1], [22.57, 88.36, 'Calcutta', 1],
  [41.90, 12.50, 'Rome', 2], [41.39, 2.17, 'Barcelone', 2], [38.72, -9.14, 'Lisbonne', 2], [52.37, 4.90, 'Amsterdam', 2], [50.85, 4.35, 'Bruxelles', 2],
  [48.21, 16.37, 'Vienne', 2], [50.08, 14.44, 'Prague', 2], [52.23, 21.01, 'Varsovie', 2], [48.14, 11.58, 'Munich', 2], [53.55, 9.99, 'Hambourg', 2],
  [50.11, 8.68, 'Francfort', 2], [47.38, 8.54, 'Zurich', 2], [46.20, 6.14, 'Genève', 2], [45.76, 4.84, 'Lyon', 2], [43.30, 5.37, 'Marseille', 2],
  [59.33, 18.07, 'Stockholm', 2], [55.68, 12.57, 'Copenhague', 2], [59.91, 10.75, 'Oslo', 2], [60.17, 24.94, 'Helsinki', 2], [37.98, 23.73, 'Athènes', 2],
  [53.35, -6.26, 'Dublin', 2], [53.48, -2.24, 'Manchester', 2], [50.45, 30.52, 'Kiev', 2], [47.50, 19.04, 'Budapest', 2], [44.43, 26.10, 'Bucarest', 2],
  [33.57, -7.59, 'Casablanca', 2], [36.75, 3.06, 'Alger', 2], [36.81, 10.18, 'Tunis', 2], [25.29, 51.53, 'Doha', 2], [24.45, 54.38, 'Abou Dabi', 2],
  [25.76, -80.19, 'Miami', 2], [37.77, -122.42, 'San Francisco', 2], [38.91, -77.04, 'Washington', 2], [42.36, -71.06, 'Boston', 2], [45.50, -73.57, 'Montréal', 2],
  [49.28, -123.12, 'Vancouver', 2], [33.75, -84.39, 'Atlanta', 2], [29.76, -95.37, 'Houston', 2], [32.78, -96.80, 'Dallas', 2], [47.61, -122.33, 'Seattle', 2],
  [25.03, 121.57, 'Taipei', 2], [3.14, 101.69, 'Kuala Lumpur', 2], [10.82, 106.63, 'Hô Chi Minh-Ville', 2], [-37.81, 144.96, 'Melbourne', 2], [-33.92, 18.42, 'Le Cap', 2],
  [-1.29, 36.82, 'Nairobi', 2], [-33.45, -70.67, 'Santiago', 2], [12.97, 77.59, 'Bangalore', 2], [21.03, 105.85, 'Hanoï', 2], [51.22, 4.40, 'Anvers', 2],
  [51.92, 4.48, 'Rotterdam', 2], [45.07, 7.69, 'Turin', 2], [40.85, 14.27, 'Naples', 2], [37.39, -5.98, 'Séville', 2], [39.47, -0.38, 'Valence', 2],
  [41.15, -8.61, 'Porto', 2], [52.49, -1.89, 'Birmingham', 2], [50.94, 6.96, 'Cologne', 2], [48.78, 9.18, 'Stuttgart', 2], [50.63, 3.06, 'Lille', 2],
  [44.84, -0.58, 'Bordeaux', 2], [43.60, 1.44, 'Toulouse', 2], [43.70, 7.27, 'Nice', 2], [47.22, -1.55, 'Nantes', 2], [48.58, 7.75, 'Strasbourg', 2],
  [32.08, 34.78, 'Tel-Aviv', 2], [33.89, 35.50, 'Beyrouth', 2], [-31.95, 115.86, 'Perth', 2], [-27.47, 153.03, 'Brisbane', 2], [-36.85, 174.76, 'Auckland', 2],
  [49.89, 2.30, 'Amiens', 3], [49.42, 2.83, 'Compiègne', 3], [50.29, 2.78, 'Arras', 3], [49.26, 4.03, 'Reims', 3], [49.44, 1.10, 'Rouen', 3],
  [49.43, 2.08, 'Beauvais', 3], [49.56, 3.62, 'Laon', 3], [50.18, 3.24, 'Cambrai', 3], [50.36, 3.52, 'Valenciennes', 3], [50.37, 3.08, 'Douai', 3],
  [49.38, 3.32, 'Soissons', 3], [49.21, 2.59, 'Senlis', 3], [49.26, 2.47, 'Creil', 3],
  [50.11, 1.83, 'Abbeville', 3], [50.95, 1.86, 'Calais', 3], [50.73, 1.61, 'Boulogne-sur-Mer', 3], [51.03, 2.38, 'Dunkerque', 3], [47.90, 1.90, 'Orléans', 3],
  [47.39, 0.69, 'Tours', 3], [49.12, 6.18, 'Metz', 3], [48.69, 6.18, 'Nancy', 3], [48.11, -1.68, 'Rennes', 3], [49.18, -0.37, 'Caen', 3],
  [48.00, 0.20, 'Le Mans', 3], [48.30, 4.07, 'Troyes', 3], [48.45, 1.49, 'Chartres', 3], [49.04, 2.08, 'Cergy', 3], [48.80, 2.13, 'Versailles', 3],
  [47.80, 3.57, 'Auxerre', 3], [48.20, 3.28, 'Sens', 3], [47.49, 3.91, 'Avallon', 3], [48.00, 2.73, 'Montargis', 3], [47.86, 3.97, 'Tonnerre', 3],
  [47.02, 4.84, 'Beaune', 3], [46.99, 3.16, 'Nevers', 3],
  [48.96, 4.36, 'Châlons-en-Champagne', 3], [50.47, 4.87, 'Namur', 3], [50.41, 4.44, 'Charleroi', 3], [50.88, 4.70, 'Louvain', 3], [51.05, 3.72, 'Gand', 3],
].map((c) => {
  const near = (o, d) => Math.abs(o.lat - c[0]) < d && Math.abs(o.lon - c[1]) < d * 1.5;
  const noLabel = Object.values(FIL_GEO).some((o) => near(o, 0.35)) || Object.values(GEO_SITES).some((o) => near(o, 0.1)) || Object.values(HUBS).some((o) => near(o, 0.1));
  return { lat: c[0], lon: c[1], name: c[2], tier: c[3], vec: toVec([c[0], c[1]]), noLabel };
});
/* Noms de pays et de mers : [lat, lon, nom, zoom à partir duquel on l'affiche] */
const GL_COUNTRIES = [
  [46.6, 2.4, 'FRANCE', 2.4], [40.0, -3.7, 'ESPAGNE', 2.4], [39.6, -8.0, 'PORTUGAL', 4.5], [53.0, -1.8, 'ROYAUME-UNI', 2.8], [53.2, -8.0, 'IRLANDE', 4.5],
  [51.0, 10.3, 'ALLEMAGNE', 2.4], [42.8, 12.5, 'ITALIE', 2.4], [46.8, 8.2, 'SUISSE', 6], [50.6, 4.7, 'BELGIQUE', 8], [52.4, 5.7, 'PAYS-BAS', 6],
  [52.1, 19.3, 'POLOGNE', 2.8], [61.5, 9.0, 'NORVÈGE', 2.4], [62.5, 15.5, 'SUÈDE', 2.4], [63.5, 26.5, 'FINLANDE', 2.8], [49.0, 31.5, 'UKRAINE', 2.4],
  [60.0, 60.0, 'RUSSIE', 1.15], [39.0, 35.0, 'TURQUIE', 2], [26.5, 30.0, 'ÉGYPTE', 2], [28.0, 2.6, 'ALGÉRIE', 1.6], [31.8, -6.5, 'MAROC', 2.4],
  [24.0, 45.0, 'ARABIE SAOUDITE', 1.6], [32.5, 54.0, 'IRAN', 1.6], [22.5, 79.0, 'INDE', 1.15], [34.5, 103.0, 'CHINE', 1.15], [36.5, 138.5, 'JAPON', 1.8],
  [36.4, 127.9, 'CORÉE DU SUD', 3.5], [39.5, -99.0, 'ÉTATS-UNIS', 1.15], [57.0, -102.0, 'CANADA', 1.15], [23.6, -102.5, 'MEXIQUE', 1.6], [-10.0, -52.0, 'BRÉSIL', 1.15],
  [-35.0, -65.0, 'ARGENTINE', 1.6], [-25.0, 134.0, 'AUSTRALIE', 1.15], [-30.0, 24.0, 'AFRIQUE DU SUD', 1.6], [9.5, 8.0, 'NIGERIA', 2], [0.3, 37.9, 'KENYA', 2.4],
  [-2.0, 118.0, 'INDONÉSIE', 1.6], [23.6, 54.2, 'ÉMIRATS', 5], [47.6, 14.5, 'AUTRICHE', 5], [49.8, 15.5, 'TCHÉQUIE', 5], [-3.0, 23.5, 'RD CONGO', 2],
  [15.0, 19.0, 'TCHAD', 2.4], [16.0, 101.0, 'THAÏLANDE', 2.4], [47.0, 104.0, 'MONGOLIE', 1.8], [48.0, 67.0, 'KAZAKHSTAN', 1.6], [-15.0, -64.0, 'BOLIVIE', 2.4],
];
const GL_SEAS = [
  [32.0, -42.0, 'Océan Atlantique', 1.0], [8.0, -140.0, 'Océan Pacifique', 1.0], [-20.0, 78.0, 'Océan Indien', 1.0], [35.0, 18.0, 'Mer Méditerranée', 2.6],
  [50.15, -1.4, 'Manche', 6], [55.5, 3.5, 'Mer du Nord', 3.5], [57.5, 19.5, 'Mer Baltique', 3.5], [20.0, 38.4, 'Mer Rouge', 3.5], [27.0, 51.0, 'Golfe Persique', 4.5],
  [15.0, 114.0, 'Mer de Chine', 2.6], [43.3, 34.0, 'Mer Noire', 3.5], [45.6, -4.6, 'Golfe de Gascogne', 4.5], [15.0, 64.0, 'Mer d\'Arabie', 2.4], [72.0, -10.0, 'Océan Arctique', 1.4],
];
/* Grandes autoroutes (France et voisins), en points de passage approximatifs : décor de la vue rapprochée */
const GL_MOTORWAYS = [
  ['A1', [[48.92, 2.36], [49.00, 2.55], [49.20, 2.60], [49.45, 2.72], [49.69, 2.79], [50.00, 2.85], [50.29, 2.86], [50.45, 2.98], [50.63, 3.07]]],
  ['A2', [[50.00, 2.85], [50.17, 3.20], [50.35, 3.52], [50.43, 3.85]]],
  ['A26', [[50.95, 1.86], [50.75, 2.25], [50.33, 2.80], [50.17, 3.15], [49.86, 3.30], [49.56, 3.62], [49.26, 4.03], [48.96, 4.36], [48.30, 4.08]]],
  ['A29', [[49.49, 0.15], [49.62, 0.75], [49.73, 1.45], [49.88, 2.30], [49.85, 2.80], [49.86, 3.30]]],
  ['A16', [[49.10, 2.22], [49.43, 2.08], [49.88, 2.30], [50.11, 1.85], [50.73, 1.63], [50.95, 1.86], [51.03, 2.38]]],
  ['A13', [[48.85, 2.25], [49.02, 1.55], [49.40, 1.09], [49.37, 0.40], [49.18, -0.37]]],
  ['A4', [[48.83, 2.45], [48.95, 3.30], [49.25, 4.03], [49.10, 5.40], [49.12, 6.17], [48.75, 7.20], [48.58, 7.75]]],
  ['A19', [[48.08, 1.88], [48.00, 2.73], [48.04, 3.12]]],
  ['A6', [[48.75, 2.35], [48.40, 2.70], [47.80, 3.57], [47.02, 4.84], [46.31, 4.83], [45.76, 4.84]]],
  ['A7', [[45.76, 4.84], [44.93, 4.89], [44.14, 4.81], [43.50, 5.25], [43.30, 5.37]]],
  ['A10', [[48.70, 2.25], [47.90, 1.90], [47.39, 0.69], [46.58, 0.34], [45.70, -0.33], [44.84, -0.58]]],
  ['A11', [[48.70, 2.10], [48.45, 1.49], [48.00, 0.20], [47.47, -0.55], [47.22, -1.55]]],
  ['A31', [[49.12, 6.17], [48.69, 6.18], [47.86, 5.33], [47.32, 5.04]]],
  ['A5', [[48.62, 2.60], [48.30, 4.08], [47.86, 5.33]]],
  ['A62', [[44.84, -0.58], [44.20, 0.62], [43.60, 1.44]]],
  ['A61', [[43.60, 1.44], [43.21, 2.35], [43.18, 3.00]]],
  ['A9', [[44.14, 4.81], [43.61, 3.88], [43.18, 3.00], [42.70, 2.89]]],
  ['A8', [[43.50, 5.25], [43.45, 6.20], [43.70, 7.27]]],
  ['A40', [[46.31, 4.83], [46.20, 5.60], [46.20, 6.14]]],
  ['E19', [[50.43, 3.85], [50.47, 4.40], [50.85, 4.35], [51.22, 4.40]]],
  ['E40', [[51.03, 2.38], [51.05, 3.72], [50.85, 4.35], [50.88, 4.70], [50.63, 5.57], [50.78, 6.08], [50.94, 6.96]]],
  ['E17', [[50.63, 3.07], [50.83, 3.27], [51.05, 3.72]]],
  ['M20', [[51.08, 1.17], [51.27, 0.52], [51.45, 0.05]]],
];
let GL_MW_CACHE = null;
const getMotorways = () => { if (!GL_MW_CACHE) GL_MW_CACHE = GL_MOTORWAYS.map(([name, wps]) => ({ name, path: buildPath(wps, 0) })); return GL_MW_CACHE; };

const VIEWS = {
  monde:  { lat: 32, lon: 25, zoom: 1, label: '🌍 Monde' },
  europe: { lat: 47, lon: 4, zoom: 4.2, label: '🇪🇺 Europe' },
  france: { lat: 47.77, lon: 3.50, zoom: 34, label: '🏭 Usines & centrale' },
};
const MODE_ICON = { road: '🚚', sea: '🚢', air: '✈️' };

const GlobePanel = ({ g, speed, mobile }) => {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const gRef = useRef(g);
  const tickAt = useRef(performance.now());
  const view = useRef({ ...VIEWS.monde });
  const target = useRef(null);
  const hits = useRef([]);
  const drag = useRef({ pointers: new Map(), last: null, pinch: null, moved: 0 });
  const idleSince = useRef(performance.now());
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState('DC');
  const [showNight, setShowNight] = useState(true);
  const [spin, setSpin] = useState(true);
  const [cardHover, setCardHover] = useState(null);
  const [cardOpen, setCardOpen] = useState(null);
  const [canvasH, setCanvasH] = useState(560);
  const [sheet, setSheet] = useState(false); // téléphone : panneau coulissant des livraisons
  const mobileRef = useRef(mobile); mobileRef.current = mobile;
  const highlight = useRef(null);
  highlight.current = cardHover || cardOpen;
  const spinRef = useRef(spin); spinRef.current = spin;
  const nightRef = useRef(showNight); nightRef.current = showNight;
  const speedRef = useRef(speed); speedRef.current = speed;

  useEffect(() => { gRef.current = g; tickAt.current = performance.now(); }, [g.t]);
  useEffect(() => { gRef.current = g; }, [g]);

  const goTo = (key) => { target.current = { ...VIEWS[key] }; idleSince.current = performance.now() + 1e9; };

  useEffect(() => {
    const canvas = canvasRef.current; const wrap = wrapRef.current;
    const ctx = canvas.getContext('2d');
    const geo = getGeo(); const routes = getRoutes();
    let raf = 0; let W = 0; let H = 0; let dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = wrap.clientWidth;
      H = mobileRef.current
        ? Math.max(280, Math.min(Math.round(W * 1.05), Math.round((window.innerHeight || 700) * 0.62)))
        : Math.max(380, Math.min(620, Math.round(W * 0.62)));
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      setCanvasH(H);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    window.addEventListener('resize', resize);

    const frame = (now) => {
      const s = gRef.current; const v = view.current;
      // Transition douce vers une vue prédéfinie
      if (target.current) {
        const t = target.current; const k = 0.12;
        let dl = t.lon - v.lon; while (dl > 180) dl -= 360; while (dl < -180) dl += 360;
        v.lon += dl * k; v.lat += (t.lat - v.lat) * k; v.zoom *= Math.pow(t.zoom / v.zoom, k);
        if (Math.abs(dl) < 0.05 && Math.abs(t.lat - v.lat) < 0.05 && Math.abs(Math.log(t.zoom / v.zoom)) < 0.01) target.current = null;
      } else if (spinRef.current && v.zoom < 2.2 && now - idleSince.current > 6000 && drag.current.pointers.size === 0) {
        v.lon += 0.04;
      }
      if (v.lon > 180) v.lon -= 360; if (v.lon < -180) v.lon += 360;
      const R = Math.min(W, H) * 0.42 * v.zoom;
      const cx = W / 2; const cy = H / 2;
      const p0 = v.lat * D2R; const cp0 = Math.cos(p0); const sp0 = Math.sin(p0); const l0 = v.lon * D2R;
      const project = (lat, lon, h = 0) => {
        const p = lat * D2R; const dl = lon * D2R - l0; const cp = Math.cos(p); const spp = Math.sin(p); const cdl = Math.cos(dl);
        const x = cp * Math.sin(dl); const y = cp0 * spp - sp0 * cp * cdl; const z = sp0 * spp + cp0 * cp * cdl;
        const k = 1 + h;
        return { x: cx + R * k * x, y: cy - R * k * y, vis: z > 0 || (k > 1 && (x * x + y * y) * k * k > 1) };
      };
      const frac = s.paused || s.popups.length ? 0 : Math.min(1, ((now - tickAt.current) * speedRef.current) / 1000);
      const newHits = [];

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Deux ambiances selon le zoom : vue spatiale de loin (m = 0), carte détaillée de près (m = 1)
      const m = glSmooth((v.zoom - 3) / 6); const sp = 1 - m;
      // Soleil : l'heure du jeu est l'heure de Paris (UTC+1), soleil à l'équateur
      const nightOn = nightRef.current;
      const utc = s.time.hour + s.time.minute / 60 + frac / 60 - 1;
      const sunLon = (((12 - utc) * 15 + 540) % 360) - 180;
      const antiLon = sunLon + 180;
      const sdl = sunLon * D2R - l0;
      const sun = nightOn ? [Math.sin(sdl), -sp0 * Math.cos(sdl), cp0 * Math.cos(sdl)] : [-0.45, 0.5, 0.74];
      const sunW = [Math.cos(sunLon * D2R), Math.sin(sunLon * D2R)];

      // Fond spatial et ciel étoilé (les étoiles glissent doucement quand le globe tourne)
      const bg = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, Math.max(R * 1.2, Math.hypot(W, H) * 0.7));
      bg.addColorStop(0, '#0d1626'); bg.addColorStop(1, '#020309');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      if (R < Math.hypot(W, H) * 0.75) {
        const tile = Math.max(W, H) * 1.6;
        const ox = (((-v.lon / 360) * tile * 0.6) % tile + tile) % tile; const oy = (((v.lat / 180) * tile * 0.3) % tile + tile) % tile;
        const sx0 = (tile - W) / 2; const sy0 = (tile - H) / 2;
        GL_STARS.forEach((st) => {
          const x = ((st[0] * tile + ox) % tile) - sx0; const y = ((st[1] * tile + oy) % tile) - sy0;
          if (x < 0 || y < 0 || x > W || y > H) return;
          const dc = Math.hypot(x - cx, y - cy); if (dc < R) return;
          ctx.globalAlpha = st[2] * (st[3] ? 0.6 + 0.4 * Math.sin(now / 650 + st[3] * 60) : 1);
          ctx.fillStyle = st[4];
          if (st[5] > 1.5) { ctx.beginPath(); ctx.arc(x, y, st[5] * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha *= 0.18; ctx.beginPath(); ctx.arc(x, y, st[5] * 1.8, 0, Math.PI * 2); ctx.fill(); }
          else ctx.fillRect(x, y, st[5], st[5]);
        });
        ctx.globalAlpha = 1;
      }
      // Atmosphère : halo bleuté autour du globe, plus lumineux côté soleil
      const atm = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * (1.07 + 0.07 * sp));
      atm.addColorStop(0, `rgba(125,190,255,${(0.5 * sp + 0.08).toFixed(3)})`); atm.addColorStop(0.4, `rgba(80,140,235,${(0.2 * sp).toFixed(3)})`); atm.addColorStop(1, 'rgba(60,120,220,0)');
      ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2); ctx.fill();
      if (sp > 0.02) {
        const rim = ctx.createLinearGradient(cx + R * sun[0], cy - R * sun[1], cx - R * sun[0], cy + R * sun[1]);
        rim.addColorStop(0, `rgba(190,225,255,${(0.85 * sp).toFixed(3)})`); rim.addColorStop(0.55, `rgba(120,170,255,${(0.25 * sp).toFixed(3)})`); rim.addColorStop(1, `rgba(120,170,255,${(0.08 * sp).toFixed(3)})`);
        ctx.strokeStyle = rim; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(cx, cy, R + 0.6, 0, Math.PI * 2); ctx.stroke();
      }
      // Océan, éclairé du côté du soleil
      const lx = cx + R * sun[0] * 0.5; const ly = cy - R * sun[1] * 0.5;
      const sea = ctx.createRadialGradient(lx, ly, R * 0.05, cx, cy, R * 1.02);
      sea.addColorStop(0, glMix([30, 88, 138], [182, 210, 228], m)); sea.addColorStop(1, glMix([4, 14, 30], [160, 193, 216], m));
      ctx.fillStyle = sea; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R + 0.5, 0, Math.PI * 2); ctx.clip();
      // Reflet du soleil sur l'océan
      if (nightOn && sun[2] > 0 && sp > 0.02) {
        const gx = cx + R * sun[0]; const gy = cy - R * sun[1];
        const gl = ctx.createRadialGradient(gx, gy, 0, gx, gy, R * 0.5);
        gl.addColorStop(0, `rgba(255,236,200,${(0.2 * sp * sun[2]).toFixed(3)})`); gl.addColorStop(1, 'rgba(255,236,200,0)');
        ctx.fillStyle = gl; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      }

      // Fond de carte : d3-geo découpe proprement les tracés à l'horizon du globe
      const projection = geoOrthographic().scale(R).translate([cx, cy]).rotate([-v.lon, -v.lat]).clipAngle(90).precision(v.zoom > 8 ? 0.3 : 0.7);
      const path = geoPath(projection, ctx);
      ctx.strokeStyle = glMixA([255, 255, 255, 0.05], [60, 110, 150, 0.16], m); ctx.lineWidth = 1;
      ctx.beginPath(); path(geo.graticule); ctx.stroke();
      ctx.fillStyle = glMix([70, 84, 60], [238, 232, 216], m); ctx.strokeStyle = glMixA([201, 162, 75, 0.5], [105, 145, 172, 0.95], m); ctx.lineWidth = v.zoom > 6 ? 1.2 : 0.7;
      ctx.beginPath(); path(geo.land); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = glMixA([235, 220, 175, 0.26], [150, 128, 100, 0.8], m); ctx.lineWidth = 0.8 + 0.4 * m;
      if (m > 0.5) ctx.setLineDash([5, 3]);
      ctx.beginPath(); path(geo.borders); ctx.stroke(); ctx.setLineDash([]);

      // Autoroutes (vue rapprochée)
      const mwA = glSmooth((v.zoom - 5) / 5);
      const tracePath = (pts) => { ctx.beginPath(); let pen = false; pts.forEach(([la, lo]) => { const q = project(la, lo); if (q.vis) { if (pen) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); pen = true; } else pen = false; }); };
      if (mwA > 0) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const mws = getMotorways(); const wMw = Math.min(2.4, 0.9 + Math.log2(v.zoom) * 0.25);
        ctx.globalAlpha = mwA * 0.8;
        mws.forEach((mw) => { tracePath(mw.path.pts); ctx.strokeStyle = glMixA([10, 10, 10, 0.5], [255, 255, 255, 0.9], m); ctx.lineWidth = wMw + 1.6; ctx.stroke(); ctx.strokeStyle = glMix([186, 120, 72], [228, 150, 96], m); ctx.lineWidth = wMw; ctx.stroke(); });
        ctx.globalAlpha = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      }

      // Nuit : terminateur adouci (crépuscule en dégradé), plus léger sur la carte rapprochée
      if (nightOn) {
        const nc = [((antiLon + 540) % 360) - 180, 0];
        const core = 0.64 - 0.46 * m; const a = 1 - Math.pow(1 - core, 1 / 8);
        ctx.fillStyle = `rgba(2,6,24,${a.toFixed(3)})`;
        [99, 96.5, 94, 91.5, 89, 86.5, 84, 81.5].forEach((r) => { ctx.beginPath(); path(geoCircle().center(nc).radius(r)()); ctx.fill(); });
        // Lumières des villes, côté nuit
        const lightA = sp; if (lightA > 0.03) { const ls = 1 + Math.log2(Math.max(1, v.zoom)) * 0.18;
        ctx.globalCompositeOperation = 'lighter';
        GL_CITIES.forEach((c) => {
          if (c.tier === 3 && v.zoom < 4) return;
          const d = c.vec[0] * sunW[0] + c.vec[1] * sunW[1];
          const dark = glClamp((-d - 0.02) / 0.16); if (dark <= 0) return;
          const q = project(c.lat, c.lon); if (!q.vis) return;
          const r = (c.tier === 1 ? 6 : c.tier === 2 ? 4 : 2.6) * ls;
          ctx.fillStyle = `rgba(255,190,95,${(0.16 * dark * lightA).toFixed(3)})`; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(255,214,140,${(0.32 * dark * lightA).toFixed(3)})`; ctx.beginPath(); ctx.arc(q.x, q.y, r * 0.45, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(255,240,205,${(0.85 * dark * lightA).toFixed(3)})`; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.8, r * 0.16), 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalCompositeOperation = 'source-over';
        }
      }
      // Relief de la sphère : bord assombri et liseré d'atmosphère (vue spatiale)
      if (sp > 0.02) {
        const limb = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
        limb.addColorStop(0, 'rgba(0,4,16,0)'); limb.addColorStop(0.8, `rgba(0,4,16,${(0.12 * sp).toFixed(3)})`); limb.addColorStop(1, `rgba(0,4,16,${(0.42 * sp).toFixed(3)})`);
        ctx.fillStyle = limb; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
        const inner = ctx.createRadialGradient(cx, cy, R * 0.86, cx, cy, R);
        inner.addColorStop(0, 'rgba(110,170,255,0)'); inner.addColorStop(1, `rgba(110,170,255,${(0.3 * sp).toFixed(3)})`);
        ctx.fillStyle = inner; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      }

      // Noms des mers, des pays et des villes (les sites du jeu gardent la priorité)
      const placed = [];
      const take = (x0, y0, x1, y1) => { if (x0 < 2 || y0 < 2 || x1 > W - 2 || y1 > H - 2) return false; if (placed.some((r) => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1])) return false; placed.push([x0, y0, x1, y1]); return true; };
      const reserve = (lat, lon) => { const q = project(lat, lon); if (q.vis) placed.push([q.x - 36, q.y - 18, q.x + 36, q.y + 34]); };
      Object.values(FIL_GEO).forEach((o) => reserve(o.lat, o.lon));
      if (R < 1400) reserve(47.77, 3.50); else { Object.values(GEO_SITES).forEach((o) => reserve(o.lat, o.lon)); ['BRESLE', 'GRASSE', 'HAVRE', 'CDG'].forEach((h) => reserve(HUBS[h].lat, HUBS[h].lon)); }
      const hasLS = 'letterSpacing' in ctx;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const areaLabel = (list, font, col, spacing) => list.forEach(([la, lo, name, z0]) => {
        const a = glSmooth((v.zoom - z0) / (z0 * 0.35)); if (a <= 0.02) return;
        const q = project(la, lo); if (!q.vis) return;
        ctx.font = font; if (hasLS) ctx.letterSpacing = spacing;
        const tw = ctx.measureText(name).width;
        if (!take(q.x - tw / 2 - 4, q.y - 8, q.x + tw / 2 + 4, q.y + 8)) return;
        ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fillText(name, q.x, q.y); ctx.globalAlpha = 1;
      });
      areaLabel(GL_SEAS, `italic 400 ${Math.round(11 + 2 * m)}px Georgia, "Times New Roman", serif`, glMixA([140, 190, 235, 0.7], [52, 102, 140, 0.9], m), '1px');
      areaLabel(GL_COUNTRIES, `600 ${Math.round(10 + 2 * m)}px "Helvetica Neue", Arial, sans-serif`, glMixA([236, 226, 200, 0.62], [112, 96, 72, 0.85], m), '2px');
      if (hasLS) ctx.letterSpacing = '0px';
      const cityMin = { 1: 2.2, 2: 5, 3: 10 };
      GL_CITIES.forEach((c) => {
        if (c.noLabel || v.zoom < cityMin[c.tier]) return;
        const q = project(c.lat, c.lon); if (!q.vis) return;
        const a = glSmooth((v.zoom - cityMin[c.tier]) / (cityMin[c.tier] * 0.4));
        ctx.font = `${c.tier === 1 ? 600 : c.tier === 2 ? 500 : 400} ${c.tier === 3 ? 10.5 : c.tier === 2 ? 11 : 12}px "Helvetica Neue", Arial, sans-serif`;
        const tw = ctx.measureText(c.name).width;
        if (!take(q.x - 4, q.y - 8, q.x + tw + 10, q.y + 8)) return;
        ctx.globalAlpha = a;
        ctx.fillStyle = glMix([235, 228, 210], [58, 54, 46], m); ctx.strokeStyle = glMixA([0, 0, 0, 0.6], [255, 255, 255, 0.95], m); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(q.x, q.y, c.tier === 3 ? 2 : 2.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.textAlign = 'left'; ctx.lineWidth = 3; ctx.strokeStyle = glMixA([0, 0, 0, 0.75], [255, 255, 255, 0.9], m);
        ctx.strokeText(c.name, q.x + 6, q.y); ctx.fillStyle = glMix([235, 228, 210], [45, 42, 36], m); ctx.fillText(c.name, q.x + 6, q.y);
        ctx.textAlign = 'center'; ctx.globalAlpha = 1;
      });
      // Numéros d'autoroutes (seulement là où il reste de la place)
      if (mwA > 0 && R >= 7000) {
          ctx.globalAlpha = mwA * 0.9;
          ctx.font = '700 9px "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          getMotorways().forEach((mw) => {
            const tw = ctx.measureText(mw.name).width + 8; const pts = mw.path.pts;
            [0.5, 0.25, 0.75, 0.12, 0.88].some((f) => {
              const p = pts[Math.floor((pts.length - 1) * f)]; const q = project(p[0], p[1]);
              if (!q.vis || q.x < 20 || q.y < 40 || q.x > W - 20 || q.y > H - 30) return false;
              if (!take(q.x - tw / 2, q.y - 7, q.x + tw / 2, q.y + 7)) return false;
              ctx.fillStyle = mw.name[0] === 'A' ? '#c23b2e' : '#2f7a3d'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
              ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(q.x - tw / 2, q.y - 7, tw, 14, 3); else ctx.rect(q.x - tw / 2, q.y - 7, tw, 14); ctx.fill(); ctx.stroke();
              ctx.fillStyle = '#ffffff'; ctx.fillText(mw.name, q.x, q.y + 0.5);
              return true;
            });
          });
          ctx.globalAlpha = 1;
      }
      // Trajets actifs, en traits fins
      const drawPath = (path, color, dash, width = 1.4) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath(); let pen = false;
        path.pts.forEach(([la, lo, h]) => { const q = project(la, lo, h); if (q.vis) { if (pen) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); pen = true; } else pen = false; });
        ctx.stroke(); ctx.setLineDash([]);
      };
      const LEG_STYLE = { road: [glMixA([201, 162, 75, 0.6], [150, 105, 20, 0.9], m), []], sea: [glMixA([110, 180, 240, 0.6], [25, 95, 165, 0.85], m), [5, 5]], air: [glMixA([244, 241, 234, 0.55], [55, 55, 70, 0.7], m), [2, 4]] };
      const drawRoute = (route) => route.forEach((l) => drawPath(l.path, LEG_STYLE[l.kind][0], LEG_STYLE[l.kind][1], 1.4 + 0.9 * m));
      Object.keys(FAC_WPS).forEach((fid) => { if (s.factories[fid].unlocked && s.features.exp) drawRoute(routes.fac[fid]); });
      Object.keys(FILIALE_DEFS).forEach((id) => { const f = s.filiales[id]; if (!f.unlocked) return; const ms = hasSplit(id) ? ['sea', 'air'].filter((m) => (m === 'air' ? airPctOf(f) > 0 : airPctOf(f) < 100)) : [f.mode]; ms.forEach((m) => { if (routes.fil[id][m]) drawRoute(routes.fil[id][m]); }); });

      // Événements visibles sur la carte
      const pulse = (lat, lon, color, label) => {
        const q = project(lat, lon); if (!q.vis) return;
        const ph = (now / 900) % 1;
        ctx.strokeStyle = color; ctx.globalAlpha = 1 - ph; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, 8 + ph * 22, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
        if (label) newHits.push({ x: q.x, y: q.y, r: 16, key: `ev-${label}`, text: label });
      };
      const evOn = (k) => s.event && s.event.key === k && s.t >= s.event.start && s.t < s.event.end;
      if (evOn('PORT')) pulse(HUBS.HAVRE.lat, HUBS.HAVRE.lon, '#ff6b5a', '⚓ Grève portuaire au Havre : les départs maritimes sont retardés');
      if (evOn('GLASS')) pulse(HUBS.BRESLE.lat, HUBS.BRESLE.lon, '#ff6b5a', '🍾 Pénurie de verre chez les verriers de la Bresle');
      if (evOn('TRAFFIC')) pulse(HUBS.DXB.lat, HUBS.DXB.lon, '#ff6b5a', '🛫 Chute du trafic aérien : ventes du Travel Retail en baisse');
      if (evOn('OUTAGE')) pulse(DCP[0], DCP[1], '#ff6b5a', '💻 Panne du système informatique à la centrale');
      if (evOn('FESTIVE')) Object.keys(FIL_GEO).forEach((id) => { if (s.filiales[id].unlocked) pulse(FIL_GEO[id].lat, FIL_GEO[id].lon, '#e8c76a', null); });
      (s.incidents || []).forEach((inc) => {
        if (s.t - inc.t > 600) return;
        const route = inc.kind === 'transit' ? routes.fac[inc.fid] : routes.fil[inc.fil] && routes.fil[inc.fil][inc.mode];
        if (!route) return;
        const pos = routeAt(route, inc.mode && inc.mode !== 'road' ? Math.min(inc.p, route[0].w1 * 0.6) : inc.p);
        pulse(pos.lat, pos.lon, inc.lost ? '#ff3b30' : '#e8c76a', inc.lost ? `🚨 Camion braqué ici (il y a ${fmtT(s.t - inc.t)}) : marchandise perdue` : `🛰 Tentative de vol déjouée ici grâce au traceur GPS (il y a ${fmtT(s.t - inc.t)})`);
        const q = project(pos.lat, pos.lon); if (q.vis) { ctx.fillStyle = '#ffffff'; ctx.font = '15px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(inc.lost ? '🚨' : '🛰', q.x, q.y); }
      });

      // Sites
      const clustered = R < 1400; // vue lointaine : les sites français sont regroupés
      const iconAt = (q, icon, size, ring, ghost) => {
        ctx.globalAlpha = ghost ? 0.45 : 1;
        ctx.fillStyle = '#0b0b0b'; ctx.strokeStyle = ring; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(q.x, q.y, size * 0.75, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = `${size}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon, q.x, q.y + 1);
        ctx.globalAlpha = 1;
      };
      const label = (q, text, dy = 18, color = '#f4f1ea') => {
        ctx.font = '600 11px "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(text, q.x, q.y + dy); ctx.fillStyle = color; ctx.fillText(text, q.x, q.y + dy);
      };
      const siteSize = Math.min(22, 13 + Math.log2(v.zoom) * 1.6);
      if (clustered) {
        const q = project(47.77, 3.50);
        if (q.vis) {
          iconAt(q, '🏭', siteSize, '#c9a24b', false);
          if (v.zoom > 2.5) label(q, 'Usines & centrale', 20, '#e8c76a');
          newHits.push({ x: q.x, y: q.y, r: 16, key: 'cluster', text: '🏭 Usines et centrale logistique (France) : cliquez pour zoomer', click: () => goTo('france') });
        }
      } else {
        Object.keys(FACTORY_DEFS).forEach((fid) => {
          const site = GEO_SITES[fid]; const q = project(site.lat, site.lon); if (!q.vis) return;
          const f = s.factories[fid];
          iconAt(q, FACTORY_DEFS[fid].icon, siteSize, f.unlocked ? '#c9a24b' : '#6f6757', !f.unlocked);
          label(q, `${site.town}${f.unlocked ? '' : ' 🔒'}`, siteSize + 4, f.unlocked ? '#f4f1ea' : '#9a927f');
          newHits.push({ x: q.x, y: q.y, r: siteSize, key: `site-${fid}`, text: `${FACTORY_DEFS[fid].icon} ${FACTORY_DEFS[fid].name} · ${site.town} (${site.dept})${f.unlocked ? '' : ' · pas encore construite'}`, click: () => setSelected(fid) });
        });
        const q = project(DCP[0], DCP[1]);
        if (q.vis) {
          iconAt(q, '🏢', siteSize + 2, s.dc.outage ? '#ff6b5a' : '#e8c76a', !s.features.centrale);
          label(q, `Centrale · ${GEO_SITES.DC.town}`, siteSize + 6, '#e8c76a');
          const yard = s.dc.yard.length + s.dc.docked.length;
          if (yard > 0) { ctx.font = '600 11px Arial'; ctx.fillStyle = '#e8c76a'; ctx.textAlign = 'left'; ctx.fillText(`🚚×${yard}`, q.x + siteSize, q.y - siteSize * 0.6); }
          newHits.push({ x: q.x, y: q.y, r: siteSize, key: 'site-DC', text: `🏢 Centrale logistique · ${GEO_SITES.DC.town} (${GEO_SITES.DC.dept})${yard ? ` · ${yard} camion(s) dans la cour ou à quai` : ''}`, click: () => setSelected('DC') });
        }
        ['BRESLE', 'GRASSE', 'HAVRE', 'CDG'].forEach((h) => {
          const hub = HUBS[h]; const qh = project(hub.lat, hub.lon); if (!qh.vis) return;
          ctx.globalAlpha = 0.85; ctx.fillStyle = '#ffffff'; ctx.font = '12px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(hub.icon, qh.x, qh.y); ctx.globalAlpha = 1;
          newHits.push({ x: qh.x, y: qh.y, r: 10, key: `hub-${h}`, text: `${hub.icon} ${hub.name}` });
        });
      }
      if (v.zoom >= 1.6) {
        ['NEWARK', 'JFK', 'JEBEL', 'DXB', 'YANGSHAN', 'PVG', ...(clustered ? ['HAVRE', 'CDG'] : [])].forEach((h) => {
          const hub = HUBS[h]; const qh = project(hub.lat, hub.lon); if (!qh.vis) return;
          ctx.globalAlpha = 0.8; ctx.fillStyle = '#ffffff'; ctx.font = '11px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(hub.icon, qh.x, qh.y); ctx.globalAlpha = 1;
          newHits.push({ x: qh.x, y: qh.y, r: 8, key: `hub-${h}`, text: `${hub.icon} ${hub.name}` });
        });
      }
      Object.keys(FILIALE_DEFS).forEach((id) => {
        if (id === 'FR' && clustered) return;
        const def = FILIALE_DEFS[id]; const f = s.filiales[id]; const q = project(FIL_GEO[id].lat, FIL_GEO[id].lon); if (!q.vis) return;
        iconAt(q, def.flag, siteSize - 1, f.unlocked ? '#e8c76a' : '#6f6757', !f.unlocked);
        label(q, `${def.city}${f.unlocked ? '' : ' 🔒'}`, id === 'FR' ? -(siteSize + 3) : siteSize + 3, f.unlocked ? '#f4f1ea' : '#9a927f');
        newHits.push({ x: q.x, y: q.y, r: siteSize, key: `fil-${id}`, text: `${def.flag} Filiale ${def.name} · ${def.city}${f.unlocked ? '' : ' · pas encore ouverte'}`, click: () => setSelected(id) });
      });

      // Véhicules en mouvement
      const vehicle = (pos, icon, size, halo, key, text) => {
        const q = project(pos.lat, pos.lon, pos.h); if (!q.vis) return;
        if (highlight.current === key) {
          const ph = (now / 700) % 1;
          ctx.strokeStyle = '#e8c76a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(q.x, q.y, size * 0.9, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1 - ph; ctx.beginPath(); ctx.arc(q.x, q.y, size * (0.9 + ph * 1.4), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
        }
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(q.x, q.y, size * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.font = `${size}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon, q.x, q.y + 1);
        newHits.push({ x: q.x, y: q.y, r: size * 0.8, key, text });
      };
      const vSize = Math.min(20, 12 + Math.log2(v.zoom) * 1.4);
      const prog = (it) => Math.max(0, Math.min(1, 1 - (it.eta - frac) / (it.maxEta || 1)));
      (s.purchaseOrders || []).forEach((po) => {
        const sup = supplierOf(po.comp); if (!sup || !routes.sup[`${sup}_${po.fid}`]) return;
        const pos = routeAt(routes.sup[`${sup}_${po.fid}`], prog(po));
        vehicle(pos, '🚛', vSize - 3, 'rgba(160,140,100,0.35)', `po-${po.id}`, `🚛 Fournisseur → ${FACTORY_DEFS[po.fid].name} · ${COMPONENTS[po.comp].icon} ${COMPONENTS[po.comp].name} ×${po.qty.toLocaleString('fr-FR')} · arrivée dans ${fmtT(po.eta)}`);
      });
      s.transit.forEach((t) => {
        const pos = routeAt(routes.fac[t.fid], prog(t));
        vehicle(pos, '🚚', vSize, 'rgba(201,162,75,0.45)', `tr-${t.id}`, `🚚 ${FACTORY_DEFS[t.fid].name} → Centrale · ${t.pallets} palettes · arrivée dans ${fmtT(t.eta)}`);
      });
      s.shipments.forEach((sh) => {
        const route = routes.fil[sh.fil] && routes.fil[sh.fil][sh.mode]; if (!route) return;
        const pos = routeAt(route, prog(sh));
        const late = s.t + sh.eta > sh.due;
        const icon = MODE_ICON[pos.kind];
        const halo = late ? 'rgba(255,80,60,0.55)' : pos.kind === 'sea' ? 'rgba(110,180,240,0.45)' : pos.kind === 'air' ? 'rgba(244,241,234,0.4)' : 'rgba(201,162,75,0.45)';
        const stage = sh.mode === 'road' ? '' : pos.kind === 'road' ? (prog(sh) < 0.5 ? (sh.mode === 'sea' ? ' · pré-acheminement vers Le Havre' : ' · pré-acheminement vers Roissy') : ' · dernier kilomètre') : '';
        vehicle(pos, icon, vSize, halo, `sh-${sh.id}`, `${icon} Commande n°${sh.no} → ${FILIALE_DEFS[sh.fil].flag} ${FILIALE_DEFS[sh.fil].name} · ${sh.pallets} pal.${stage} · arrivée dans ${fmtT(sh.eta)}${late ? ' · ⚠ arrivera en retard' : ''}${sh.inFull ? '' : ' · incomplète'}`);
      });
      ctx.restore();
      // Échelle (en haut à droite) dès qu'on se rapproche
      if (v.zoom >= 2.5) {
        const kmPx = 6371 / R; const maxPx = mobileRef.current ? 70 : 100;
        const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].filter((k) => k / kmPx <= maxPx).pop();
        if (nice) {
          const len = nice / kmPx; const x1 = W - 14; const x0 = x1 - len; const y = 20; const txt = `${nice} km`;
          ctx.font = '600 10px "Helvetica Neue", Arial, sans-serif'; const tw = ctx.measureText(txt).width;
          ctx.fillStyle = 'rgba(7,9,13,0.62)'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0 - tw - 16, y - 11, len + tw + 26, 20, 6); else ctx.rect(x0 - tw - 16, y - 11, len + tw + 26, 20); ctx.fill();
          ctx.strokeStyle = '#e8c76a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y + 3); ctx.lineTo(x1, y + 3); ctx.lineTo(x1, y - 4); ctx.stroke();
          ctx.fillStyle = '#f4f1ea'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x0 - 6, y);
        }
      }
      hits.current = newHits;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Molette : zoom (sans faire défiler la page)
    const onWheel = (e) => {
      e.preventDefault(); target.current = null; idleSince.current = performance.now();
      const v = view.current; v.zoom = Math.max(0.8, Math.min(150, v.zoom * Math.exp(-e.deltaY * 0.0015)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('resize', resize); canvas.removeEventListener('wheel', onWheel); };
  }, []);

  const findHit = (x, y) => {
    let best = null; let bd = Infinity;
    hits.current.forEach((h) => { const d = Math.hypot(h.x - x, h.y - y); if (d <= h.r + 4 && d < bd) { best = h; bd = d; } });
    return best;
  };
  const local = (e) => { const r = canvasRef.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onPointerDown = (e) => {
    canvasRef.current.setPointerCapture(e.pointerId);
    const d = drag.current; d.pointers.set(e.pointerId, local(e)); d.moved = 0; target.current = null; idleSince.current = performance.now();
    if (d.pointers.size === 2) { const [a, b] = [...d.pointers.values()]; d.pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: view.current.zoom }; }
  };
  const onPointerMove = (e) => {
    const d = drag.current; const p = local(e);
    if (d.pointers.has(e.pointerId)) {
      const prev = d.pointers.get(e.pointerId); d.pointers.set(e.pointerId, p); idleSince.current = performance.now();
      const v = view.current;
      if (d.pointers.size === 2 && d.pinch) {
        const [a, b] = [...d.pointers.values()]; const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        v.zoom = Math.max(0.8, Math.min(150, d.pinch.zoom * dist / d.pinch.dist)); d.moved += 10;
      } else if (d.pointers.size === 1) {
        const W = canvasRef.current.clientWidth; const H = canvasRef.current.clientHeight;
        const R = Math.min(W, H) * 0.42 * v.zoom;
        const dx = p[0] - prev[0]; const dy = p[1] - prev[1]; d.moved += Math.abs(dx) + Math.abs(dy);
        v.lon -= (dx / R) / D2R;
        v.lat = Math.max(-80, Math.min(80, v.lat + (dy / R) / D2R));
      }
      if (hover) setHover(null);
      return;
    }
    const h = findHit(p[0], p[1]);
    if ((h && h.key) !== (hover && hover.key) || (h && hover && h.text !== hover.text)) setHover(h ? { key: h.key, text: h.text, x: p[0], y: p[1] } : null);
  };
  const onPointerUp = (e) => {
    const d = drag.current; const p = local(e);
    d.pointers.delete(e.pointerId); if (d.pointers.size < 2) d.pinch = null;
    if (d.moved < 6) { const h = findHit(p[0], p[1]); if (h && h.click) h.click(); else if (h) setHover({ key: h.key, text: h.text, x: p[0], y: p[1] }); }
  };
  const zoomBy = (k) => { target.current = null; view.current.zoom = Math.max(0.8, Math.min(150, view.current.zoom * k)); idleSince.current = performance.now(); };

  // Liste des livraisons en cours (encadrés à droite du globe)
  const routes = getRoutes();
  const progOf = (it) => Math.max(0, Math.min(1, 1 - it.eta / (it.maxEta || 1)));
  const skuRows = (entries) => entries.map(([sku, units]) => {
    const sp = PRODUCT_SPECS[sku]; const cartons = units / sp.unitsPerCarton;
    return { sku, name: sp.name, units: Math.round(units), cartons: Math.round(cartons), pal: cartons / sp.cartonsPerPallet };
  });
  const deliveries = [
    ...g.shipments.map((sh) => {
      const def = FILIALE_DEFS[sh.fil]; const route = routes.fil[sh.fil] && routes.fil[sh.fil][sh.mode];
      const pos = route ? routeAt(route, progOf(sh)) : null;
      const late = g.t + sh.eta > sh.due;
      const stage = !pos ? '' : sh.mode === 'road' ? 'Sur la route' : pos.kind === 'road' ? (progOf(sh) < 0.5 ? (sh.mode === 'sea' ? 'Pré-acheminement vers Le Havre' : 'Pré-acheminement vers Roissy-CDG') : 'Dernier kilomètre') : pos.kind === 'sea' ? 'En mer' : 'En vol';
      return { key: `sh-${sh.id}`, group: 'fil', icon: MODE_ICON[pos ? pos.kind : sh.mode], dest: `${def.flag} ${def.name}`, sub: `Commande n°${sh.no} · ${MODE_LABELS[sh.mode]}`,
        pallets: sh.pallets, eta: sh.eta, prog: progOf(sh), late, pos, stage, from: `Centrale · ${GEO_SITES.DC.town}`, to: `${def.city}`,
        due: sh.due - g.t, inFull: sh.inFull, rows: skuRows(Object.entries(sh.lines)), departed: sh.maxEta - sh.eta };
    }),
    ...g.transit.map((t) => {
      const rows = skuRows(Object.entries(t.lines).filter(([, n]) => n > 0).map(([sku, n]) => [sku, n * unitsPerPallet(sku)]));
      return { key: `tr-${t.id}`, group: 'prim', icon: '🚚', dest: `🏢 Centrale · ${GEO_SITES.DC.town}`, sub: `${FACTORY_DEFS[t.fid].icon} depuis ${FACTORY_DEFS[t.fid].name} (${GEO_SITES[t.fid].town})`,
        pallets: t.pallets, eta: t.eta, prog: progOf(t), late: false, pos: routeAt(routes.fac[t.fid], progOf(t)), stage: 'Transport primaire', from: GEO_SITES[t.fid].town, to: GEO_SITES.DC.town,
        rows, departed: t.maxEta - t.eta, fill: t.pallets / TRUCK_MAX_PALLETS };
    }),
    ...g.purchaseOrders.map((po) => {
      const sup = supplierOf(po.comp); const c = COMPONENTS[po.comp];
      const route = sup && routes.sup[`${sup}_${po.fid}`];
      const site = GEO_SITES[po.fid];
      return { key: `po-${po.id}`, group: 'sup', icon: '🚛', dest: `${FACTORY_DEFS[po.fid].icon} ${FACTORY_DEFS[po.fid].name}`, sub: `${c.icon} ${c.name}`,
        pallets: null, qty: po.qty, eta: po.eta, prog: progOf(po), late: false, pos: route ? routeAt(route, progOf(po)) : { lat: site.lat, lon: site.lon },
        stage: sup ? `Depuis ${HUBS[sup].name.split(' :')[0]}` : 'Fournisseur (non cartographié)', from: sup ? HUBS[sup].name.split(' :')[0] : 'Fournisseur', to: site.town,
        comp: c, cost: po.qty * c.cost, departed: po.maxEta - po.eta };
    }),
  ];
  const GROUPS = [['fil', '🌍 Vers les filiales'], ['prim', '🏭 Usines → centrale'], ['sup', '📦 Fournisseurs → usines']];
  const centerOn = (d) => {
    if (!d.pos) return;
    const far = d.group === 'fil' && d.pos && Math.abs(d.pos.lon - 2.5) > 12;
    target.current = { lat: d.pos.lat, lon: d.pos.lon, zoom: far ? Math.max(2.2, Math.min(view.current.zoom, 4)) : Math.max(view.current.zoom, 30) };
    idleSince.current = performance.now() + 1e9;
  };
  const fmtPal = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1).replace('.', ','));

  // Compteurs
  const counts = { supp: g.purchaseOrders.filter((po) => supplierOf(po.comp)).length, prim: g.transit.length, road: 0, sea: 0, air: 0 };
  g.shipments.forEach((sh) => { counts[sh.mode] += 1; });
  const lateN = g.shipments.filter((sh) => g.t + sh.eta > sh.due).length;
  const btn = (active) => ({ ...actionBtnStyle, padding: '5px 10px', fontSize: '0.74em', background: active ? '#c9a24b' : '#111111', color: active ? '#111111' : '#c9a24b', border: '1px solid #c9a24b' });

  const sel = selected;
  const selInfo = (() => {
    if (GEO_SITES[sel] && sel !== 'DC') {
      const site = GEO_SITES[sel]; const f = g.factories[sel];
      const ready = readyPalletsOf(g, sel);
      return { title: `${FACTORY_DEFS[sel].icon} ${FACTORY_DEFS[sel].name} · ${site.town} (${site.dept})`, site,
        live: f.unlocked ? `${f.lines.length} ligne(s) · ${f.queue.length} OF au planning · ${ready} palette(s) prêtes à expédier · ${g.transit.filter((t) => t.fid === sel).length} camion(s) en route vers la centrale` : 'Pas encore construite dans votre partie.' };
    }
    if (sel === 'DC') {
      const dc = g.dc;
      return { title: `🏢 Centrale logistique · ${GEO_SITES.DC.town} (${GEO_SITES.DC.dept})`, site: GEO_SITES.DC,
        live: g.features.centrale ? `${dc.yard.length} camion(s) dans la cour · ${dc.docked.length} à quai · ${dcPallets(dc)} / ${dcCapacity(dc)} palettes en racks · ${dc.orders.length} commande(s) filiales en cours` : 'Pas encore ouverte dans votre partie.' };
    }
    if (FILIALE_DEFS[sel]) {
      const def = FILIALE_DEFS[sel]; const f = g.filiales[sel];
      const ships = g.shipments.filter((sh) => sh.fil === sel);
      return { title: `${def.flag} Filiale ${def.name} · ${def.city}`, site: null,
        live: f.unlocked ? `${MODE_LABELS[f.mode]} · ${ships.length} livraison(s) en route · taux de service ${pct(svcOf(f))} · OTIF ${pct(otifOf(f))}` : `Pas encore ouverte. ${def.blurb}` };
    }
    return null;
  })();

  const deliveryList = (
    <>
        {deliveries.length === 0 && <div style={{ color: '#8c8372', fontSize: '0.75em', padding: '8px 2px' }}>Rien sur les routes pour l'instant. Expédiez un camion depuis l'usine !</div>}
        {GROUPS.map(([grp, title]) => {
          const list = deliveries.filter((d) => d.group === grp).sort((a, b) => a.eta - b.eta);
          if (list.length === 0) return null;
          return (
            <div key={grp} style={{ marginBottom: 8 }}>
              <div style={{ color: '#b9ae93', fontSize: '0.66em', margin: '4px 2px' }}>{title} · {list.length}</div>
              {list.map((d) => {
                const open = cardOpen === d.key || (!mobile && (cardHover === d.key || (hover && hover.key === d.key)));
                return (
                  <div key={d.key} onMouseEnter={mobile ? undefined : () => setCardHover(d.key)} onMouseLeave={mobile ? undefined : () => setCardHover(null)}
                    onClick={() => { setCardOpen(cardOpen === d.key ? null : d.key); if (!mobile) centerOn(d); }}
                    style={{ background: open ? '#17150f' : '#111111', border: `1px solid ${d.late ? '#a4262c' : open ? '#e8c76a' : '#3a3424'}`, padding: '6px 8px', marginBottom: 5, cursor: 'pointer', color: '#f4f1ea', fontSize: '0.74em', lineHeight: 1.4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontWeight: 700 }}>{deco(d.icon)} {d.dest}</span>
                      <span style={{ color: d.late ? '#ff8a80' : '#e8c76a', whiteSpace: 'nowrap' }}>{fmtT(d.eta)}</span>
                    </div>
                    <div style={{ color: '#b9ae93' }}>{d.pallets !== null ? `${d.pallets} pal. · ` : `${d.qty.toLocaleString('fr-FR')} u. · `}{d.sub}</div>
                    <div style={{ height: 3, background: '#2a2618', marginTop: 4 }}><div style={{ height: 3, width: `${Math.round(d.prog * 100)}%`, background: d.late ? '#ff6b5a' : '#c9a24b' }} /></div>
                    {d.late && <div style={{ color: '#ff8a80', marginTop: 2 }}>{deco('⚠ ')}Arrivera après l'échéance</div>}
                    {open && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #3a3424', color: '#e6dcc0' }}>
                        <div>{deco('📍 ')}{d.stage} · {Math.round(d.prog * 100)} % du trajet</div>
                        <div>🛣 {d.from} → {d.to}</div>
                        <div>{deco('⏱ ')}Parti il y a {fmtT(d.departed)} · arrivée dans {fmtT(d.eta)}</div>
                        {d.due !== undefined && <div style={{ color: d.late ? '#ff8a80' : '#9fd3a8' }}>{deco('📅 ')}Échéance filiale : {d.due >= 0 ? `dans ${fmtT(d.due)}` : `dépassée de ${fmtT(-d.due)}`}</div>}
                        {d.inFull !== undefined && <div style={{ color: d.inFull ? '#9fd3a8' : '#ff8a80' }}>{d.inFull ? '✔ Commande complète' : '✖ Commande incomplète (stock manquant à la préparation)'}</div>}
                        {d.fill !== undefined && <div>{deco('🚚 ')}Remplissage du camion : {Math.round(d.fill * 100)} % ({d.pallets}/{TRUCK_MAX_PALLETS} pal.)</div>}
                        {d.rows && (
                          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 5, fontSize: '0.95em' }}>
                            <thead><tr style={{ color: '#c9a24b', textAlign: 'right' }}><th style={{ textAlign: 'left', fontWeight: 600 }}>Article</th><th style={{ fontWeight: 600 }}>Cartons</th><th style={{ fontWeight: 600 }}>Unités</th><th style={{ fontWeight: 600 }}>Pal.</th></tr></thead>
                            <tbody>
                              {d.rows.map((r) => (
                                <tr key={r.sku} style={{ textAlign: 'right', borderTop: '1px solid #2a2618' }}>
                                  <td style={{ textAlign: 'left', padding: '2px 4px 2px 0' }}>{r.name}</td>
                                  <td>{r.cartons.toLocaleString('fr-FR')}</td><td>{r.units.toLocaleString('fr-FR')}</td><td>{fmtPal(r.pal)}</td>
                                </tr>
                              ))}
                              {d.rows.length > 1 && (
                                <tr style={{ textAlign: 'right', borderTop: '1px solid #c9a24b', fontWeight: 700 }}>
                                  <td style={{ textAlign: 'left' }}>Total</td>
                                  <td>{d.rows.reduce((a, r) => a + r.cartons, 0).toLocaleString('fr-FR')}</td><td>{d.rows.reduce((a, r) => a + r.units, 0).toLocaleString('fr-FR')}</td><td>{fmtPal(d.rows.reduce((a, r) => a + r.pal, 0))}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        )}
                        {d.comp && <div>{deco(d.comp.icon)} {d.qty.toLocaleString('fr-FR')} × {d.comp.name} · {eur(d.cost)}</div>}
                        {mobile ? (
                          <button onClick={(e) => { e.stopPropagation(); centerOn(d); setSheet(false); if (wrapRef.current) wrapRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' }); }} style={{ ...actionBtnStyle, marginTop: 8, width: '100%', padding: '8px 10px', fontSize: '0.95em', background: '#c9a24b', color: '#111' }}>{deco('🌐 ')}Voir sur le globe</button>
                        ) : <div style={{ color: '#8c8372', marginTop: 4 }}>Cliquez pour centrer le globe dessus.</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
    </>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>{deco('🌐 ')}Globe des transports</h3>
        <div className="chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', ...(mobile ? { width: 'calc(100% + 20px)' } : {}) }}>
          {Object.entries(VIEWS).map(([k, vw]) => <button key={k} style={btn(false)} onClick={() => goTo(k)}>{vw.label}</button>)}
          <button style={btn(false)} onClick={() => zoomBy(1.5)}>＋</button>
          <button style={btn(false)} onClick={() => zoomBy(1 / 1.5)}>－</button>
          <button style={btn(showNight)} onClick={() => setShowNight(!showNight)}>{deco('🌙 ')}Nuit</button>
          <button style={btn(spin)} onClick={() => setSpin(!spin)}>{deco('🔄 ')}Rotation</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div ref={wrapRef} style={{ position: 'relative', flex: mobile ? '1 1 100%' : '999 1 480px', minWidth: 0, ...(mobile ? { margin: '0 -10px' } : {}), border: '1px solid #c9a24b', background: '#07090d', touchAction: 'none', userSelect: 'none' }}>
        <canvas ref={canvasRef} style={{ display: 'block', cursor: hover ? 'pointer' : 'grab' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover(null)} />
        {hover && (
          <div style={{ position: 'absolute', left: Math.max(4, Math.min(hover.x + 14, (wrapRef.current ? wrapRef.current.clientWidth : 600) - 256)), top: Math.max(4, hover.y - 10), maxWidth: 'min(250px, calc(100% - 8px))', background: 'rgba(11,11,11,0.94)', color: '#f4f1ea', border: '1px solid #c9a24b', padding: '6px 9px', fontSize: '0.74em', lineHeight: 1.4, pointerEvents: 'none' }}>
            {hover.text}
          </div>
        )}
        <div style={{ position: 'absolute', left: 10, top: 8, color: '#d8ceb4', fontSize: '0.7em', lineHeight: 1.6, pointerEvents: 'none', background: 'rgba(7,9,13,0.62)', padding: '3px 8px', borderRadius: 6 }}>
          {counts.supp > 0 && <div>{deco('🚛 ')}{counts.supp} livraison(s) fournisseurs</div>}
          <div>{deco('🚚 ')}{counts.prim} camion(s) usine → centrale</div>
          {counts.road > 0 && <div>{deco('🚛 ')}{counts.road} camion(s) vers les filiales</div>}
          {counts.sea > 0 && <div>{deco('🚢 ')}{counts.sea} conteneur(s) en mer</div>}
          {counts.air > 0 && <div>{deco('✈ ')}{counts.air} envoi(s) aérien(s)</div>}
          {lateN > 0 && <div style={{ color: '#ff8a80' }}>{deco('⚠ ')}{lateN} livraison(s) en retard</div>}
        </div>
        <div style={{ position: 'absolute', right: 10, bottom: 8, color: '#b9ae93', fontSize: '0.66em', pointerEvents: 'none', textAlign: 'right', background: 'rgba(7,9,13,0.55)', padding: '2px 7px', borderRadius: 6 }}>
          {mobile ? 'Glisser pour tourner · pincer pour zoomer · appuyer sur un site' : 'Glisser pour tourner · molette ou pincer pour zoomer · cliquer un site'}
        </div>
        {mobile && (
          <button onClick={() => setSheet(true)} style={{ ...actionBtnStyle, position: 'absolute', left: 8, bottom: 26, padding: '8px 12px', fontSize: '0.78em', background: 'rgba(11,11,11,0.88)', color: '#e8c76a', border: `1px solid ${lateN > 0 ? '#ff6b5a' : '#c9a24b'}` }}>
            🚚 Livraisons ({deliveries.length}){lateN > 0 ? ` · ⚠ ${lateN}` : ''} ▴
          </button>
        )}
      </div>
      {!mobile && (
      <div style={{ flex: '1 1 250px', maxHeight: canvasH + 2, overflowY: 'auto', background: '#0b0b0b', border: '1px solid #c9a24b', padding: 8, boxSizing: 'border-box' }}>
        <div style={{ color: '#c9a24b', fontSize: '0.68em', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Livraisons en cours ({deliveries.length})</div>
        {deliveryList}
      </div>
      )}
      </div>
      {mobile && sheet && (
        <div onClick={() => setSheet(false)} style={{ position: 'fixed', inset: 0, zIndex: 32, background: 'rgba(0,0,0,0.45)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '72vh', display: 'flex', flexDirection: 'column', background: '#0b0b0b', borderTop: '2px solid #c9a24b', borderRadius: '14px 14px 0 0', paddingBottom: 'env(safe-area-inset-bottom)', boxShadow: '0 -10px 30px rgba(0,0,0,0.5)' }}>
            <div onClick={() => setSheet(false)} style={{ padding: '8px 12px 6px 12px', cursor: 'pointer' }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: '#5a5240', margin: '0 auto 8px auto' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#c9a24b', fontSize: '0.72em', letterSpacing: 2, textTransform: 'uppercase' }}>Livraisons en cours ({deliveries.length})</span>
                <span style={{ color: '#c9a24b', fontSize: '1.1em', padding: '0 4px' }}>✕</span>
              </div>
            </div>
            <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '0 10px 12px 10px', fontSize: '1.08em' }}>
              {deliveryList}
            </div>
          </div>
        </div>
      )}

      <div className="g2" style={{ marginTop: 14 }}>
        <Card title="📍 Site sélectionné">
          {selInfo ? (
            <div style={{ fontSize: '0.82em', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{selInfo.title}</div>
              <div style={{ color: '#2f7a57', marginBottom: 6 }}>Dans votre partie : {selInfo.live}</div>
              {selInfo.site && (
                <>
                  <div><strong>Adresse :</strong> {selInfo.site.addr}</div>
                  <div style={{ color: '#6f6757' }}>GPS : {selInfo.site.lat.toFixed(3)}° N, {selInfo.site.lon.toFixed(3)}° E</div>
                  <div style={{ marginTop: 6 }}><strong>Le site :</strong> {selInfo.site.facts}</div>
                  <div style={{ marginTop: 6, color: '#8c8372', fontSize: '0.92em' }}>{selInfo.site.note}</div>
                  {selInfo.site.sources.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: '0.9em' }}>Sources : {selInfo.site.sources.map(([t, u], i) => <span key={u}>{i > 0 ? ' · ' : ''}<a href={u} target="_blank" rel="noreferrer" style={{ color: '#a8842c' }}>{t}</a></span>)}</div>
                  )}
                </>
              )}
            </div>
          ) : <div style={{ fontSize: '0.82em', color: '#6f6757' }}>Cliquez un site sur le globe.</div>}
        </Card>
        <Card title="🧭 Lire le globe">
          <div style={{ fontSize: '0.8em', lineHeight: 1.6 }}>
            <div><span style={{ color: '#a8842c' }}>━━</span> Route · <span style={{ color: '#3d8fd1' }}>╍╍</span> Maritime (via Le Havre, Gibraltar, Suez) · <span style={{ color: '#8c8372' }}>┄┄</span> Aérien (via Roissy-CDG)</div>
            <div>Halo <span style={{ color: '#a4262c', fontWeight: 700 }}>rouge</span> : la livraison arrivera après l'échéance de la filiale.</div>
            <div>{deco('🚨 ')}: un camion braqué (il reste affiché 10 h). Les cercles rouges signalent les aléas en cours : grève au Havre, pénurie chez les verriers, panne à la centrale.</div>
            <div>La zone sombre est la nuit, calée sur l'heure du jeu (heure de Paris).</div>
            <div style={{ color: '#8c8372', marginTop: 4 }}>Les fournisseurs affichés (verriers de la vallée de la Bresle, essences et concentrés de Grasse) sont des repères sur la carte ; les autres fournisseurs ne sont pas cartographiés.</div>
          </div>
        </Card>
      </div>
    </div>
  );
};

/* ============================================================
   APPLICATION
   ============================================================ */
const SupplyChainTycoon = () => {
  const [g, dispatch] = useReducer(reducer, null, () => (memorySave ? { ...initialState, ...memorySave, toast: null } : structuredClone(initialState)));
  const [ready, setReady] = useState(memorySave !== null);
  const [activeTab, setActiveTab] = useState('production');
  const [ui, setUi] = useState({ fid: 'PARFUM', sub: 'planning', ofSku: 'PARF_50', ofPallets: 5 });
  const [speed, setSpeed] = useState(1);
  const [confirmAsk, setConfirmAsk] = useState(null);
  const [lastSave, setLastSave] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const mobile = useIsMobile();
  const tabbarRef = useRef(null);
  const latest = useRef(g);
  const ask = (msg, yes) => setConfirmAsk({ msg, yes });
  const [saveOpen, setSaveOpen] = useState(false);
  TICK_MS = g && !g.paused ? Math.round(1000 / speed) : 200;
  const moneyShown = useRolling(g.money);

  useEffect(() => { latest.current = g; memorySave = g; }, [g]);

  useEffect(() => {
    if (ready) return undefined;
    let cancelled = false;
    storage.load().then((data) => {
      if (cancelled) return;
      if (data) dispatch({ type: 'LOAD', data });
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const save = () => storage.save(latest.current).then((ok) => { if (ok) setLastSave(new Date().toLocaleTimeString('fr-FR')); });
    const id = setInterval(save, 5000);
    return () => { clearInterval(id); storage.save(latest.current); };
  }, [ready]);

  useEffect(() => {
    if (!ready) return undefined;
    const id = setInterval(() => dispatch({ type: 'TICK' }), 1000 / speed);
    return () => clearInterval(id);
  }, [ready, speed]);

  useEffect(() => {
    if (!g.toast) return undefined;
    const id = setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 4000);
    return () => clearTimeout(id);
  }, [g.toast]);

  if (!ready) return <div style={{ padding: 40, backgroundColor: '#faf8f3', color: '#6f6757', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>Chargement de la sauvegarde...</div>;

  const F = g.features;
  const tabs = [
    ['production', '🏭 Usines', true],
    ['centrale', `🏢 Centrale${g.dc.orders.filter((o) => o.status === 'open').length ? ` (${g.dc.orders.filter((o) => o.status === 'open').length})` : ''}`, F.centrale],
    ['globe', '🌐 Globe', F.globe],
    ['filiales', '🌍 Filiales', Object.keys(FILIALE_DEFS).some((id) => F[`fil_${id}`])],
    ['rd', `🧪 Développement${g.rd && g.rd.projects.length ? ` (${g.rd.projects.length})` : ''}`, F.launch],
    ['marketing', '📢 Marketing', F.marketing],
    ['dashboard', '📊 Pilotage', F.dashboard],
    ['guide', '📘 Guide', true],
  ].filter((t) => t[2]);
  const tab = tabs.some((t) => t[0] === activeTab) ? activeTab : 'production';
  const ev = g.event && g.t < g.event.end ? g.event : null;
  const openOrders = g.dc.orders.filter((o) => o.status === 'open').length;
  const goTab = (key) => {
    setActiveTab(key);
    if (mobile) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      const bar = tabbarRef.current; const btn = bar && bar.querySelector(`[data-tab="${key}"]`);
      if (btn && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  };
  const clock = `${String(g.time.hour).padStart(2, '0')}:${String(g.time.minute).padStart(2, '0')}`;
  const moneyTxt = moneyShown.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const askReset = () => ask('🗑 Recommencer une nouvelle partie ? La sauvegarde actuelle sera effacée.', () => { dispatch({ type: 'RESET' }); storage.save(initialState); });
  // Libellés courts de la barre d'onglets du téléphone
  const SHORT = { production: ['🏭', 'Usines'], centrale: ['🏢', 'Centrale', openOrders], globe: ['🌐', 'Globe'], filiales: ['🌍', 'Filiales'], rd: ['🧪', 'R&D', g.rd ? g.rd.projects.length : 0], marketing: ['📢', 'Marketing'], dashboard: ['📊', 'Pilotage'], guide: ['📘', 'Guide'] };

  return (
    <div className="lx" style={{ '--tick': g.paused ? '200ms' : `${Math.round(1000 / speed)}ms`, padding: 16, backgroundColor: '#f4f1ea', color: '#111111', minHeight: '100vh', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>
      <style>{LUXE_CSS}</style>
      {g.toast && (
        <div key={g.toast.msg} className="toast" style={{ borderRadius: 10, position: 'fixed', bottom: mobile ? 'calc(78px + env(safe-area-inset-bottom))' : 20, left: '50%', transform: 'translateX(-50%)', width: mobile ? 'calc(100% - 24px)' : 'auto', maxWidth: 'calc(100% - 24px)', background: '#111111', color: '#ffffff', padding: mobile ? '10px 14px' : '12px 22px', fontWeight: 600, zIndex: 35, textAlign: mobile ? 'center' : 'left', boxShadow: '0 6px 24px rgba(0,0,0,0.35)', borderBottom: `3px solid ${TOAST_COLORS[g.toast.type] || '#a4262c'}`, borderTop: '1px solid #c9a24b', fontSize: '0.88em' }}>
          {deco(g.toast.msg)}
        </div>
      )}
      {g.popups.length > 0 && <PopupView popup={g.popups[0]} dispatch={dispatch} />}
      {confirmAsk && <ConfirmView ask={confirmAsk} onClose={() => setConfirmAsk(null)} />}

      {mobile ? (
        <header style={{ position: 'sticky', top: 0, zIndex: 15, margin: '0 -8px', padding: 'calc(6px + env(safe-area-inset-top)) 10px 6px 10px', background: '#0b0b0b', borderBottom: '1px solid #c9a24b', color: '#ffffff', boxShadow: '0 4px 14px rgba(0,0,0,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button aria-label={g.paused ? 'Reprendre' : 'Pause'} onClick={() => dispatch({ type: 'TOGGLE_PAUSE' })} style={{ ...actionBtnStyle, width: 40, height: 40, padding: 0, flex: '0 0 auto', background: g.paused ? '#c9a24b' : 'transparent', color: g.paused ? '#111' : '#c9a24b', border: '1px solid #c9a24b', fontSize: '1em' }}>{g.paused ? '▶' : '❚❚'}</button>
            <div style={{ lineHeight: 1.05, flex: '0 0 auto' }}>
              <div style={{ fontSize: '1.45em', fontFamily: 'Didot, "Bodoni MT", "Playfair Display", Georgia, serif', color: g.paused ? '#e8c76a' : '#c9a24b' }}>{clock}</div>
              <div style={{ fontSize: '0.62em', color: '#b9ae93', letterSpacing: 1 }}>{g.paused ? 'EN PAUSE' : `JOUR ${g.day}`}</div>
            </div>
            <div style={{ display: 'flex', gap: 3, flex: '0 0 auto' }}>
              {[1, 2, 4].map((v) => (
                <button key={v} onClick={() => setSpeed(v)} style={{ ...actionBtnStyle, minWidth: 32, height: 32, minHeight: 32, padding: 0, fontSize: '0.72em', background: speed === v ? '#c9a24b' : 'transparent', color: speed === v ? '#111' : '#c9a24b', border: '1px solid #c9a24b' }}>×{v}</button>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'right', lineHeight: 1.1 }}>
              <div style={{ color: g.money < 0 ? '#ff8a80' : '#c9a24b', fontSize: '1.18em', fontFamily: 'Didot, "Bodoni MT", "Playfair Display", Georgia, serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{moneyTxt}</div>
              <div style={{ fontSize: '0.6em', color: '#b9ae93', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{eur(hourlyCosts(g))}/h{g.money < 0 ? ' · agios' : ''}<CarbonGauge g={g} compact /></div>
            </div>
            <button aria-label="Menu" onClick={() => setMenuOpen(!menuOpen)} style={{ ...actionBtnStyle, width: 36, height: 40, padding: 0, flex: '0 0 auto', background: menuOpen ? '#c9a24b' : 'transparent', color: menuOpen ? '#111' : '#c9a24b', border: '1px solid #3a3424', fontSize: '1.1em' }}>⋯</button>
          </div>
          {menuOpen && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #3a3424', fontSize: '0.78em', color: '#b9ae93', display: 'grid', gap: 6 }}>
              <div style={{ color: '#c9a24b', letterSpacing: 3, textTransform: 'uppercase', fontSize: '0.85em' }}>{BRAND.house} · Supply Chain Tycoon</div>
              <div>Jour {g.day} · Charges : {eur(hourlyCosts(g))}/h{g.money < 0 ? ' · agios 1 %/h' : ''}<CarbonGauge g={g} /></div>
              {carbonOn(g) && g.carbon && g.carbon.last && <div>{deco('🌱 ')}Hier : {(g.carbon.last.co2 / 1000).toFixed(1)} t CO₂, {Math.round(g.carbon.last.air * 100)} % en avion, taxe {eur(g.carbon.last.tax)}</div>}
              <div>{lastSave ? `💾 Sauvegardé à ${lastSave}` : '💾 Sauvegarde automatique'}</div>
              <div><button onClick={() => { setMenuOpen(false); setSaveOpen(true); }} style={{ ...actionBtnStyle, background: 'transparent', color: '#c9a24b', border: '1px solid #c9a24b', padding: '6px 12px', fontSize: '0.95em', marginRight: 6 }}>{deco('💾 ')}Sauvegardes</button><button onClick={() => { setMenuOpen(false); askReset(); }} style={{ ...actionBtnStyle, background: 'transparent', color: '#d9a3a3', border: '1px solid #7a3a3a', padding: '6px 12px', fontSize: '0.95em' }}>{deco('🗑 ')}Nouvelle partie</button></div>
            </div>
          )}
        </header>
      ) : (
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '16px 24px', background: '#0b0b0b', border: '1px solid #c9a24b', boxShadow: 'inset 0 0 0 5px #0b0b0b, inset 0 0 0 6px rgba(201,162,75,0.55)', marginBottom: 14, color: '#ffffff' }}>
        <div>
          <div style={{ fontSize: '0.7em', letterSpacing: 4, color: '#c9a24b', textTransform: 'uppercase' }}>{BRAND.house}</div>
          <h2 style={{ margin: '2px 0 0 0', fontSize: '1.5em', color: '#ffffff', letterSpacing: 2, textTransform: 'uppercase' }}>Supply Chain Tycoon</h2>
          <div style={{ fontSize: '0.85em', color: '#b9ae93', letterSpacing: 1 }}>Jour {g.day}</div>
        </div>
        <div style={{ textAlign: 'center', padding: '8px 22px', border: '1px solid #c9a24b' }}>
          <div style={{ fontSize: '0.65em', color: '#b9ae93', textTransform: 'uppercase', letterSpacing: 3 }}>{g.paused ? 'En pause' : `Vitesse ×${speed}`}</div>
          <div style={{ fontSize: '2em', fontFamily: 'Didot, "Bodoni MT", "Playfair Display", Georgia, serif', color: g.paused ? '#e8c76a' : '#c9a24b', letterSpacing: 2 }}>
            {clock}
          </div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
            {[1, 2, 4].map((v) => (
              <button key={v} onClick={() => setSpeed(v)} style={{ ...actionBtnStyle, padding: '2px 8px', fontSize: '0.7em', background: speed === v ? '#c9a24b' : 'transparent', color: speed === v ? '#111' : '#c9a24b', border: '1px solid #c9a24b' }}>×{v}</button>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: g.money < 0 ? '#ff8a80' : '#c9a24b', fontSize: '1.9em', fontFamily: 'Didot, "Bodoni MT", "Playfair Display", Georgia, serif' }}>
            {moneyTxt}
          </div>
          <div style={{ fontSize: '0.7em', color: '#b9ae93' }}>Charges : {eur(hourlyCosts(g))}/h{g.money < 0 ? ' · agios 1 %/h' : ''}<CarbonGauge g={g} /></div>
          <button onClick={() => dispatch({ type: 'TOGGLE_PAUSE' })} style={{ ...actionBtnStyle, background: 'transparent', color: '#c9a24b', border: '1px solid #c9a24b', padding: '4px 12px', fontSize: '0.75em', marginTop: 6 }}>
            {g.paused ? '▶ Reprendre' : '⏸ Pause'}
          </button>
          <button onClick={() => setSaveOpen(!saveOpen)} style={{ ...actionBtnStyle, background: 'transparent', color: '#c9a24b', border: '1px solid #c9a24b', padding: '4px 12px', fontSize: '0.75em', marginTop: 6, marginLeft: 6 }}>{deco('💾 ')}Sauvegardes</button>
          <button onClick={askReset} style={{ ...actionBtnStyle, background: 'transparent', color: '#d9a3a3', border: '1px solid #7a3a3a', padding: '4px 12px', fontSize: '0.75em', marginTop: 6, marginLeft: 6 }}>
            🗑 Nouvelle partie
          </button>
          <div style={{ fontSize: '0.68em', color: '#8c8372', marginTop: 6 }}>{lastSave ? `💾 Sauvegardé à ${lastSave}` : '💾 Sauvegarde automatique'}</div>
        </div>
      </header>
      )}
      {saveOpen && <SavePanel g={g} dispatch={dispatch} onClose={() => setSaveOpen(false)} />}

      <ObjectiveBanner g={g} mobile={mobile} onGuide={() => goTab('guide')} />
      {ev && (
        <div style={{ background: '#fff4e6', border: '1px solid #b4531a', padding: mobile ? '6px 10px' : '8px 14px', marginBottom: mobile ? 10 : 14, fontSize: mobile ? '0.78em' : '0.82em' }}>
          {EVENT_DEFS[ev.key].icon} <strong>{EVENT_DEFS[ev.key].title}</strong> — {g.t < ev.start ? `démarre dans ${fmtT(ev.start - g.t)}` : `encore ${fmtT(ev.end - g.t)}`}. {ev.text}
        </div>
      )}

      {mobile ? (
        <nav ref={tabbarRef} className="tabbar" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, display: 'flex', overflowX: 'auto', scrollbarWidth: 'none', background: '#0b0b0b', borderTop: '1px solid #c9a24b', padding: '0 4px env(safe-area-inset-bottom) 4px', boxShadow: '0 -4px 14px rgba(0,0,0,0.25)' }}>
          {tabs.map(([key]) => {
            const [icon, short, badge] = SHORT[key]; const on = tab === key;
            return (
              <button key={key} data-tab={key} onClick={() => goTab(key)} style={{ position: 'relative', flex: '1 1 0', minWidth: 46, height: 58, padding: '6px 2px 4px 2px', background: 'transparent', border: 'none', borderTop: `3px solid ${on ? '#c9a24b' : 'transparent'}`, color: on ? '#c9a24b' : '#b9ae93', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <span style={{ fontSize: '1.35em', lineHeight: 1, display: 'flex' }}>{EMOJI_ICON[icon] ? <Ico n={EMOJI_ICON[icon]} size="1em" /> : icon}</span>
                <span style={{ fontSize: '0.64em', fontWeight: 600, whiteSpace: 'nowrap' }}>{short}</span>
                {badge > 0 && <span style={{ position: 'absolute', top: 4, left: '50%', marginLeft: 8, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: '#a4262c', color: '#fff', fontSize: '0.6em', lineHeight: '16px', fontWeight: 700 }}>{badge}</span>}
              </button>
            );
          })}
        </nav>
      ) : (
      <nav style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {tabs.map(([key, label]) => (
          <button key={key} data-tab={key} onClick={() => setActiveTab(key)} style={{ ...navTabStyle, background: tab === key ? '#111111' : '#ffffff', color: tab === key ? '#c9a24b' : '#111111', borderBottom: `2px solid ${tab === key ? '#c9a24b' : '#e6dcc0'}` }}>
            {deco(label)}
          </button>
        ))}
      </nav>
      )}

      <main key={tab} className="tabfade" style={{ background: '#ffffff', padding: 18, border: '1px solid #e6dcc0', borderTop: '3px solid #111111', borderRadius: '0 0 12px 12px', minHeight: 500 }}>
        {tab === 'production' && <FactoryPanel g={g} dispatch={dispatch} ui={ui} setUi={setUi} ask={ask} />}
        {tab === 'centrale' && <DCPanel g={g} dispatch={dispatch} ask={ask} />}
        {tab === 'globe' && <GlobePanel g={g} speed={speed} mobile={mobile} />}
        {tab === 'filiales' && <FilialesPanel g={g} dispatch={dispatch} ask={ask} />}
        {tab === 'rd' && <RDPanel g={g} dispatch={dispatch} ask={ask} />}
        {tab === 'marketing' && <MarketingPanel g={g} dispatch={dispatch} />}
        {tab === 'dashboard' && <DashboardPanel g={g} />}
        {tab === 'guide' && <GuidePanel g={g} />}
      </main>
    </div>
  );
};

/* ============================================================
   STYLES
   ============================================================ */
const navTabStyle = { padding: '11px 18px', color: '#111111', border: 'none', cursor: 'pointer', borderRadius: 6, fontWeight: 600, fontSize: '0.82em', letterSpacing: 1.2, textTransform: 'uppercase', transition: 'all 0.2s ease' };
const actionBtnStyle = { border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 600, cursor: 'pointer', color: '#ffffff', letterSpacing: 0.3, transition: 'all 0.2s ease' };
const freqQtyBtnStyle = { background: '#ffffff', border: '1px solid #c9a24b', color: '#111111', width: 24, height: 24, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9em', padding: 0 };

export default SupplyChainTycoon;
// Exposés pour les tests (simulation sans navigateur) ; ils rejoindront src/application/ pendant la migration.
export { reducer, initialState, migrate };
