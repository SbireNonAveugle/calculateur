/* ============================================================
 * calculator.js — Logique métier Geocracy (pure, sans DOM)
 *
 * Toutes les règles du jeu et tous les calculs vivent ici.
 * Chaque fonction est pure : mêmes entrées → mêmes sorties,
 * ce qui rend le module testable et réutilisable.
 * ============================================================ */

/* ------------------------------------------------------------
 * DONNÉES DU JEU
 * Production de base au niveau max (boost topographique 0 %).
 * Le boost est multiplicatif : prod = base × (1 + boost/100).
 * Un boost de 100 % double donc la production.
 * ---------------------------------------------------------- */
export const BUILDINGS = {
  champ:   { nom: "Champ",   pluriel: "Champs",   res: "cereales", base: 168 },
  scierie: { nom: "Scierie", pluriel: "Scieries", res: "bois",     base: 126 },
  usine:   { nom: "Usine",   pluriel: "Usines",   res: "eau",      base: 130 },
};

/** Ressources dans l'ordre canonique, avec libellés. */
export const RESOURCES = [
  { key: "cereales", nom: "Céréales", abbr: "C", building: "champ" },
  { key: "bois",     nom: "Bois",     abbr: "B", building: "scierie" },
  { key: "eau",      nom: "Eau",      abbr: "E", building: "usine" },
];

/* Coût UNITAIRE (par unité produite) et cadence par caserne.
 * Coût horaire d'une caserne = coût unitaire × cadence :
 *  - Soldat    : 10C/5B/2E  × 60/h → 600 C / 300 B / 120 E
 *  - Défenseur : 5C/10B/10E × 40/h → 200 C / 400 B / 400 E   */
export const UNITS = {
  soldat: {
    label: "Soldats", labelSingulier: "soldat", rate: 60,
    cout: { cereales: 10, bois: 5, eau: 2 },
  },
  defenseur: {
    label: "Défenseurs", labelSingulier: "défenseur", rate: 40,
    cout: { cereales: 5, bois: 10, eau: 10 },
  },
};

/** Nombre maximal de bâtiments par ville. */
export const MAX_SLOTS = 10;

/* ------------------------------------------------------------
 * FONCTIONS DE BASE
 * ---------------------------------------------------------- */

/** Coût horaire d'une caserne pour un type d'unité donné. */
export function coutParCaserne(unite) {
  const u = UNITS[unite];
  return {
    cereales: u.cout.cereales * u.rate,
    bois:     u.cout.bois     * u.rate,
    eau:      u.cout.eau      * u.rate,
    rate:     u.rate,
  };
}

/** Production /h d'un bâtiment donné avec son boost (%). */
export function prodBatiment(type, boost) {
  const b = BUILDINGS[type];
  return b ? b.base * (1 + boost / 100) : 0;
}

/**
 * Production /h d'une ville.
 * - mode "bats"   : somme des bâtiments (chacun avec son boost)
 * - mode "manuel" : valeurs saisies directement (lues en jeu)
 */
export function prodVille(ville) {
  if (ville.mode === "manuel") {
    const m = ville.manual || {};
    return {
      cereales: +m.cereales || 0,
      bois:     +m.bois     || 0,
      eau:      +m.eau      || 0,
    };
  }
  const out = { cereales: 0, bois: 0, eau: 0 };
  for (const b of ville.bats || []) {
    const t = BUILDINGS[b.type];
    if (t) out[t.res] += prodBatiment(b.type, b.boost);
  }
  return out;
}

/** Production totale /h d'un ensemble de villes + comptage des bâtiments. */
export function prodTotale(villes) {
  const prod = { cereales: 0, bois: 0, eau: 0 };
  const counts = { champ: 0, scierie: 0, usine: 0 };
  for (const v of villes) {
    const p = prodVille(v);
    prod.cereales += p.cereales;
    prod.bois     += p.bois;
    prod.eau      += p.eau;
    if (v.mode !== "manuel") for (const b of v.bats || []) counts[b.type]++;
  }
  return { prod, counts };
}

/* ------------------------------------------------------------
 * CAPACITÉ & MIX (onglet Calculateur)
 * ---------------------------------------------------------- */

/**
 * Capacité maximale si toute la production est dédiée à un type d'unité.
 * casernes = min sur les 3 ressources de ⌊production / coût par caserne⌋.
 */
export function capaciteMax(prod, unite) {
  const c = coutParCaserne(unite);
  const limites = RESOURCES.map((r) => ({
    nom: r.nom,
    n: Math.floor((prod[r.key] || 0) / c[r.key]),
  }));
  const casernes = Math.min(...limites.map((l) => l.n));
  const limitante = limites.slice().sort((a, b) => a.n - b.n)[0].nom;
  return { casernes, unites: casernes * c.rate, limitante };
}

/**
 * Simule un mix soldats/défenseurs.
 * @param prod     production totale /h
 * @param casernes nombre de casernes actives
 * @param split    % de casernes en soldats (0–100)
 */
export function simulerMix(prod, casernes, split) {
  const ks = Math.round((casernes * split) / 100); // casernes soldats
  const kd = casernes - ks;                        // casernes défenseurs
  const cs = coutParCaserne("soldat");
  const cd = coutParCaserne("defenseur");
  const conso = {
    cereales: ks * cs.cereales + kd * cd.cereales,
    bois:     ks * cs.bois     + kd * cd.bois,
    eau:      ks * cs.eau      + kd * cd.eau,
  };
  const solde = {
    cereales: prod.cereales - conso.cereales,
    bois:     prod.bois     - conso.bois,
    eau:      prod.eau      - conso.eau,
  };
  const soutenable =
    solde.cereales >= 0 && solde.bois >= 0 && solde.eau >= 0;
  return {
    ks, kd,
    soldatsH:    ks * cs.rate,
    defenseursH: kd * cd.rate,
    conso, solde, soutenable,
  };
}

/* ------------------------------------------------------------
 * SEUILS DE BOOST (onglet Seuils)
 * ---------------------------------------------------------- */

/**
 * Analyse par ressource : combien de bâtiments reste-t-il à construire ?
 *
 * @param besoin        {cereales,bois,eau} production /h visée
 * @param existants     {champ:[{boost}],scierie:[...],usine:[...]}
 * @param boostRestant  boost prévu (%) sur les nouveaux bâtiments
 * @returns une entrée par ressource avec :
 *  - prodExist  : production déjà assurée par l'existant
 *  - reste      : production encore manquante
 *  - nbAuBoost  : nb de bâtiments à construire au boost choisi
 *  - nbMini     : nb minimal de bâtiments (comme s'ils étaient à 100 %)
 *  - boostMin   : boost minimum requis si on ne construit que nbMini
 */
export function analyseSeuils(besoin, existants, boostRestant) {
  return RESOURCES.map((r) => {
    const bat = BUILDINGS[r.building];
    const need = besoin[r.key] || 0;

    const prodExist = (existants[r.building] || []).reduce(
      (s, b) => s + bat.base * (1 + b.boost / 100), 0
    );
    const reste = Math.max(0, need - prodExist);

    // (a) Nb de bâtiments nécessaires au boost prévu
    const prodUnit = bat.base * (1 + boostRestant / 100);
    const nbAuBoost = reste <= 0 ? 0 : Math.ceil(reste / prodUnit);

    // (b) Nb minimal (production doublée = boost 100 %) et boost min associé
    const nbMini = reste <= 0 ? 0 : Math.ceil(reste / (bat.base * 2));
    const boostMin = nbMini === 0
      ? 0
      : Math.max(0, (reste / (nbMini * bat.base) - 1) * 100);

    return {
      key: r.key, nom: r.nom, building: r.building,
      need, prodExist, reste,
      nbAuBoost, nbMini, boostMin,
      couvert: reste <= 0,
      nbExist: (existants[r.building] || []).length,
    };
  });
}

/* ------------------------------------------------------------
 * HUBS & VILLES (onglet Hubs)
 * ---------------------------------------------------------- */

/**
 * Analyse d'un hub : production cumulée de ses villes et
 * nombre de casernes qu'il peut soutenir pour l'unité choisie.
 */
export function analyseHub(hub, unite) {
  const c = coutParCaserne(unite);
  const prod = (hub.villes || []).reduce(
    (a, v) => ({
      cereales: a.cereales + (+v.c || 0),
      bois:     a.bois     + (+v.b || 0),
      eau:      a.eau      + (+v.e || 0),
      cas:      a.cas      + (+v.cas || 0),
    }),
    { cereales: 0, bois: 0, eau: 0, cas: 0 }
  );

  const limites = RESOURCES.map((r) => ({
    nom: r.nom,
    n: Math.floor(prod[r.key] / c[r.key]),
  }));
  const maxCas = Math.min(...limites.map((l) => l.n));
  const limitante = limites.slice().sort((a, b) => a.n - b.n)[0].nom;

  return {
    prod,
    maxCas,
    maxUnits: maxCas * c.rate,
    limitante,
    // Casernes déjà posées : surcharge ou marge
    surcharge: prod.cas > maxCas,
    marge: maxCas - prod.cas,
    consoActuelle: {
      cereales: prod.cas * c.cereales,
      bois:     prod.cas * c.bois,
      eau:      prod.cas * c.eau,
    },
  };
}

/* ------------------------------------------------------------
 * PLAN TYPE (onglet Plan)
 *
 * Plan de référence : 1 hub militaire (8 casernes soldats)
 * alimenté par 4 satellites spécialisés (1–2 ressources max
 * chacun), chaque ville autonome en énergie (éoliennes).
 * La topographie est paramétrable (améliorations documentées) :
 * par défaut céréales 100 %, bois 100 %, eau 0 % comme le plan
 * d'origine.
 * ---------------------------------------------------------- */

/** Composition figée des 5 villes du plan de référence. */
export const PLAN_VILLES = [
  { nom: "HUB militaire", role: "Craft soldats",   ch: 0, sc: 0, us: 0, cas: 8, eo: 2, hub: true },
  { nom: "Satellite 1",   role: "Céréales + Bois", ch: 5, sc: 3, us: 0, cas: 0, eo: 2 },
  { nom: "Satellite 2",   role: "Céréales + Eau",  ch: 5, sc: 0, us: 3, cas: 0, eo: 2 },
  { nom: "Satellite 3",   role: "Bois + Eau",      ch: 0, sc: 7, us: 2, cas: 0, eo: 1 },
  { nom: "Satellite 4",   role: "Céréales + Eau",  ch: 5, sc: 0, us: 3, cas: 0, eo: 2 },
];

/**
 * Évalue le plan type pour une topographie donnée.
 * @param topo boosts (%) : {cereales, bois, eau}
 */
export function evaluerPlan(topo = { cereales: 100, bois: 100, eau: 0 }) {
  const p = {
    ch: BUILDINGS.champ.base   * (1 + topo.cereales / 100),
    sc: BUILDINGS.scierie.base * (1 + topo.bois / 100),
    us: BUILDINGS.usine.base   * (1 + topo.eau / 100),
  };
  const villes = PLAN_VILLES.map((v) => ({
    ...v,
    prod: { cereales: v.ch * p.ch, bois: v.sc * p.sc, eau: v.us * p.us },
    slots: v.ch + v.sc + v.us + v.cas + v.eo,
  }));
  const tot = villes.reduce(
    (a, v) => ({
      cereales: a.cereales + v.prod.cereales,
      bois:     a.bois     + v.prod.bois,
      eau:      a.eau      + v.prod.eau,
      cas:      a.cas      + v.cas,
    }),
    { cereales: 0, bois: 0, eau: 0, cas: 0 }
  );
  const c = coutParCaserne("soldat");
  const conso = {
    cereales: tot.cas * c.cereales,
    bois:     tot.cas * c.bois,
    eau:      tot.cas * c.eau,
  };
  const solde = {
    cereales: tot.cereales - conso.cereales,
    bois:     tot.bois     - conso.bois,
    eau:      tot.eau      - conso.eau,
  };
  return {
    villes, tot, conso, solde,
    soldatsH: tot.cas * c.rate,
    soutenable: solde.cereales >= 0 && solde.bois >= 0 && solde.eau >= 0,
    prodUnitaire: p,
  };
}
