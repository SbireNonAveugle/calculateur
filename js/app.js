/* ============================================================
 * app.js — Point d'entrée de l'application
 *
 * Gère l'état global, le routage des onglets et le rendu des
 * quatre calculateurs. Les calculs viennent de calculator.js,
 * la persistance de storage.js, les composants de ui.js.
 *
 * Stratégie de rendu : chaque onglet sépare
 *  - renderTab()     → reconstruit les saisies (changements structurels)
 *  - renderResults() → ne met à jour que les zones de résultats,
 *                      pour conserver le focus pendant la frappe.
 * ============================================================ */

import {
  BUILDINGS, RESOURCES, UNITS, MAX_SLOTS,
  coutParCaserne, prodBatiment, prodVille, prodTotale,
  capaciteMax, simulerMix, analyseSeuils, analyseHub, evaluerPlan,
} from "./calculator.js";
import {
  loadLocal, saveLocalDebounced, clearLocal,
  buildShareUrl, loadFromUrl, clearUrlHash,
} from "./storage.js";
import {
  el, mount, initTheme, toggleTheme, toast,
  tip, segmented, numberField, rangeField, dataTable, formulasPanel,
} from "./ui.js";
import { fmt, uid, deepClone, copyText, toInt } from "./utils.js";

/* --- Couleurs d'accent (reflètent les variables CSS) -------- */
const ACCENT = {
  cereales: "var(--c-cereales)", bois: "var(--c-bois)", eau: "var(--c-eau)",
  champ: "var(--c-cereales)", scierie: "var(--c-bois)", usine: "var(--c-eau)",
  soldat: "var(--c-soldat)", defenseur: "var(--c-defenseur)",
};
const accentRes = (key) => ACCENT[key];

/* ============================================================
 * ÉTAT
 * ========================================================== */

function defaultState() {
  return {
    tab: "hubs",
    hubs: {
      unite: "soldat",
      hubs: [{
        id: uid(), nom: "Hub 1",
        villes: [{ id: uid(), nom: "Ville 1", c: 0, b: 0, e: 0, cas: 0 }],
      }],
    },
    seuils: {
      mode: "plan",          // plan | libre
      unite: "soldat",
      casernes: 8,
      besoinLibre: { cereales: 4800, bois: 2400, eau: 960 },
      existants: { champ: [], scierie: [], usine: [] },
      boostRestant: 100,
    },
    calc: {
      casernes: 8,
      split: 100,            // % de casernes en soldats
      villes: [{
        id: uid(), nom: "Ville 1", mode: "bats",
        manual: { cereales: 0, bois: 0, eau: 0 },
        bats: [
          { id: uid(), type: "champ", boost: 100 },
          { id: uid(), type: "scierie", boost: 80 },
        ],
      }],
    },
    plan: { topo: { cereales: 100, bois: 100, eau: 0 } },
  };
}

/** Fusionne un état chargé avec les défauts (tolère les anciens formats). */
function hydrate(partial) {
  const d = defaultState();
  if (!partial || typeof partial !== "object") return d;
  return {
    tab: ["hubs", "seuils", "calc", "plan"].includes(partial.tab) ? partial.tab : d.tab,
    hubs:   { ...d.hubs,   ...partial.hubs },
    seuils: { ...d.seuils, ...partial.seuils,
      besoinLibre: { ...d.seuils.besoinLibre, ...partial.seuils?.besoinLibre },
      existants:   { ...d.seuils.existants,   ...partial.seuils?.existants } },
    calc:   { ...d.calc,   ...partial.calc },
    plan:   { ...d.plan,   ...partial.plan,
      topo: { ...d.plan.topo, ...partial.plan?.topo } },
  };
}

let state;

/** Sauvegarde différée après toute mutation. */
function persist() { saveLocalDebounced(state); }

/* ============================================================
 * SQUELETTE & NAVIGATION
 * ========================================================== */

const TABS = [
  { id: "hubs",   label: "Hubs & villes" },
  { id: "seuils", label: "Seuils de boost" },
  { id: "calc",   label: "Calculateur" },
  { id: "plan",   label: "Plan type" },
];

const RENDERERS = {
  hubs: renderHubs,
  seuils: renderSeuils,
  calc: renderCalc,
  plan: renderPlan,
};

function renderNav() {
  const nav = document.getElementById("tabs");
  mount(nav, TABS.map((t) =>
    el("button", {
      class: "tab" + (state.tab === t.id ? " on" : ""),
      role: "tab",
      "aria-selected": String(state.tab === t.id),
      onClick: () => { state.tab = t.id; persist(); render(); },
    }, t.label)
  ));
}

function render() {
  renderNav();
  RENDERERS[state.tab]();
  window.scrollTo({ top: 0 });
}

const view = () => document.getElementById("view");

/* --- Barre d'actions (partager / copier / réinitialiser) ---- */

function actionBar(copyFn) {
  return el("div", { class: "actions" },
    el("button", { class: "btn ghost", onClick: shareConfig },
      "⤴ Partager la config"),
    el("button", { class: "btn ghost", onClick: async () => {
      const ok = await copyText(copyFn());
      toast(ok ? "Résultats copiés" : "Copie impossible", ok);
    } }, "⧉ Copier les résultats"),
    el("button", { class: "btn danger", onClick: resetAll },
      "↺ Réinitialiser"),
  );
}

async function shareConfig() {
  const url = buildShareUrl(state);
  const ok = await copyText(url);
  toast(ok ? "Lien de partage copié" : "Copie impossible — URL : " + url, ok);
}

function resetAll() {
  if (!confirm("Réinitialiser tous les onglets et effacer la sauvegarde ?")) return;
  clearLocal();
  clearUrlHash();
  const tab = state.tab;
  state = defaultState();
  state.tab = tab;
  render();
  toast("Configuration réinitialisée");
}

/* En-tête d'onglet homogène. */
function header(kicker, title, sub) {
  return el("header", { class: "head" },
    el("div", { class: "kicker" }, "GEOCRACY · " + kicker),
    el("h1", {}, title),
    el("p", { class: "sub" }, sub),
  );
}

/* Ligne signature en pied d'onglet (rappel des constantes). */
function footRule(text) {
  return el("footer", { class: "foot" }, text);
}

/* ============================================================
 * ONGLET 1 — HUBS & VILLES
 * ========================================================== */

function renderHubs() {
  const s = state.hubs;

  const resultsBoxes = new Map(); // hubId → conteneur de résultats

  const refreshHub = (hub) => {
    const box = resultsBoxes.get(hub.id);
    if (box) mount(box, hubResults(hub));
  };

  const hubResults = (hub) => {
    const a = analyseHub(hub, s.unite);
    const u = UNITS[s.unite];
    const cost = coutParCaserne(s.unite);
    return el("div", { class: "hub-summary" },
      el("div", { class: "sum-line" },
        el("span", { class: "muted" }, "Production cumulée"),
        el("span", { class: "sum-vals nums" },
          el("b", { style: { color: accentRes("cereales") } }, `${fmt(a.prod.cereales)} C`),
          el("b", { style: { color: accentRes("bois") } }, `${fmt(a.prod.bois)} B`),
          el("b", { style: { color: accentRes("eau") } }, `${fmt(a.prod.eau)} E`),
        ),
      ),
      el("div", { class: "big-result" },
        el("div", {},
          el("div", { class: "big-label" }, "Casernes soutenables"),
          el("div", { class: "big-val" }, String(a.maxCas),
            el("span", { class: "big-unit" }, " max")),
        ),
        el("div", { class: "arrow", "aria-hidden": "true" }, "→"),
        el("div", {},
          el("div", { class: "big-label" }, `${u.label} / h`),
          el("div", { class: "big-val", style: { color: accentRes(s.unite) } },
            fmt(a.maxUnits)),
        ),
        el("div", { class: "limit" }, "limité par", el("br"), el("b", {}, a.limitante)),
      ),
      a.prod.cas > 0 && el("div", { class: "posed" },
        `${a.prod.cas} caserne(s) déjà posée(s) · ${fmt(a.prod.cas * cost.rate)} ${u.labelSingulier}s/h`,
        a.surcharge
          ? el("span", { class: "bad" }, ` — ⚠ trop pour la prod (${a.maxCas} soutenables)`)
          : el("span", { class: "good" }, ` — ✓ soutenu, marge de ${a.marge} caserne(s)`),
      ),
    );
  };

  const hubCard = (hub) => {
    const box = el("div", {});
    resultsBoxes.set(hub.id, box);

    const villeRow = (v) => el("div", { class: "grid-row" },
      el("input", { class: "cell-nom", value: v.nom, "aria-label": "Nom de la ville",
        onInput: (e) => { v.nom = e.target.value; persist(); } }),
      ...[["c", "Céréales/h"], ["b", "Bois/h"], ["e", "Eau/h"], ["cas", "Casernes"]]
        .map(([f, label]) => el("input", {
          class: "cell nums", type: "number", inputmode: "numeric",
          min: "0", value: String(v[f]), "aria-label": label,
          onInput: (e) => { v[f] = toInt(e.target.value); persist(); refreshHub(hub); },
        })),
      el("button", { class: "x", title: "Supprimer la ville",
        onClick: () => {
          hub.villes = hub.villes.filter((x) => x.id !== v.id);
          persist(); renderHubs();
        } }, "✕"),
    );

    const card = el("div", { class: "card hub-card" },
      el("div", { class: "hub-head" },
        el("input", { class: "hub-nom", value: hub.nom, "aria-label": "Nom du hub",
          onInput: (e) => { hub.nom = e.target.value; persist(); } }),
        s.hubs.length > 1 && el("button", { class: "x", title: "Supprimer le hub",
          onClick: () => {
            s.hubs = s.hubs.filter((x) => x.id !== hub.id);
            persist(); renderHubs();
          } }, "✕ hub"),
      ),
      el("div", { class: "grid-head" },
        el("span", {}, "Ville"),
        el("span", { class: "r" }, "Céréales/h"),
        el("span", { class: "r" }, "Bois/h"),
        el("span", { class: "r" }, "Eau/h"),
        el("span", { class: "r" }, "Casernes"),
        el("span", {}),
      ),
      hub.villes.length === 0
        ? el("div", { class: "empty" }, "Aucune ville. Ajoute la première ci-dessous.")
        : hub.villes.map(villeRow),
      el("button", { class: "btn dashed", onClick: () => {
        hub.villes.unshift({ id: uid(), nom: "Nouvelle ville", c: 0, b: 0, e: 0, cas: 0 });
        persist(); renderHubs();
      } }, "+ Ajouter une ville à ce hub"),
      box,
    );
    mount(box, hubResults(hub));
    return card;
  };

  const cost = coutParCaserne(s.unite);
  mount(view(),
    header("ORGANISATION RÉELLE", "Hubs & villes",
      "Chaque hub puise dans ses villes proches. Saisis la production réelle par heure de chaque ville (lue en jeu) : l'outil calcule combien de casernes chaque hub peut soutenir."),
    el("section", { class: "block" },
      el("div", { class: "block-row" },
        el("span", { class: "block-label" }, "Unité à produire",
          tip("Une caserne produit 60 soldats/h (600 C · 300 B · 120 E) ou 40 défenseurs/h (200 C · 400 B · 400 E).")),
        segmented(
          [{ value: "soldat", label: "Soldats (60/h)" },
           { value: "defenseur", label: "Défenseurs (40/h)" }],
          s.unite,
          (v) => { s.unite = v; persist(); renderHubs(); },
        ),
      ),
    ),
    el("section", { class: "block" },
      el("div", { class: "block-row" },
        el("span", { class: "block-label" }, "Tes hubs"),
        el("button", { class: "btn", onClick: () => {
          s.hubs.unshift({ id: uid(), nom: `Hub ${s.hubs.length + 1}`, villes: [] });
          persist(); renderHubs();
        } }, "+ Ajouter un hub"),
      ),
      s.hubs.map(hubCard),
      formulasPanel([
        ["Casernes soutenables", "min( ⌊prodC/" + cost.cereales + "⌋, ⌊prodB/" + cost.bois + "⌋, ⌊prodE/" + cost.eau + "⌋ )"],
        ["Unités par heure", "casernes soutenables × " + cost.rate],
        ["Ressource limitante", "celle dont ⌊prod/coût⌋ est le plus faible"],
      ]),
    ),
    actionBar(copyHubs),
    footRule(`Soldat 600 C / 300 B / 120 E par caserne · Défenseur 200 C / 400 B / 400 E · 1 caserne = ${cost.rate} unités/h`),
  );
}

function copyHubs() {
  const s = state.hubs;
  const u = UNITS[s.unite];
  const lines = [`GEOCRACY — Hubs & villes (${u.label})`];
  for (const hub of s.hubs) {
    const a = analyseHub(hub, s.unite);
    lines.push(`\n■ ${hub.nom}`);
    for (const v of hub.villes)
      lines.push(`  · ${v.nom} : ${fmt(v.c)} C, ${fmt(v.b)} B, ${fmt(v.e)} E — ${v.cas} caserne(s)`);
    lines.push(`  Production : ${fmt(a.prod.cereales)} C · ${fmt(a.prod.bois)} B · ${fmt(a.prod.eau)} E`);
    lines.push(`  → ${a.maxCas} casernes soutenables (${fmt(a.maxUnits)} ${u.labelSingulier}s/h), limité par ${a.limitante}`);
  }
  return lines.join("\n");
}

/* ============================================================
 * ONGLET 2 — SEUILS DE BOOST
 * ========================================================== */

function besoinSeuils() {
  const s = state.seuils;
  if (s.mode === "libre") return { ...s.besoinLibre };
  const c = coutParCaserne(s.unite);
  return {
    cereales: s.casernes * c.cereales,
    bois:     s.casernes * c.bois,
    eau:      s.casernes * c.eau,
  };
}

function renderSeuils() {
  const s = state.seuils;

  const needBox = el("div", { class: "need-box" });
  const resultBox = el("div", {});
  const countBadges = {}; // building → badge compteur

  const refresh = () => {
    // Rappel du besoin (mode plan)
    if (s.mode === "plan") {
      const b = besoinSeuils();
      const c = coutParCaserne(s.unite);
      mount(needBox,
        "Besoin : ",
        el("b", { style: { color: accentRes("cereales") } }, `${fmt(b.cereales)} C`), " · ",
        el("b", { style: { color: accentRes("bois") } }, `${fmt(b.bois)} B`), " · ",
        el("b", { style: { color: accentRes("eau") } }, `${fmt(b.eau)} E`),
        el("span", { class: "muted" },
          ` → ${fmt(s.casernes * c.rate)} ${UNITS[s.unite].labelSingulier}s/h`),
      );
    } else {
      mount(needBox);
    }
    // Tableau de résultats
    const rows = analyseSeuils(besoinSeuils(), s.existants, s.boostRestant).map((a) => [
      el("b", { style: { color: accentRes(a.key) } }, a.nom),
      fmt(a.need),
      fmt(a.prodExist),
      a.couvert
        ? el("span", { class: "good" }, "✓ couvert")
        : el("b", {}, fmt(a.reste)),
      a.couvert ? "—" : el("b", {}, `${a.nbAuBoost} bât.`),
      a.couvert ? "—" : el("span", {},
        el("b", {}, `${a.nbMini} bât.`), " à ",
        el("b", { style: { color: accentRes(a.key) } }, `${Math.ceil(a.boostMin)} %`), " min"),
    ]);
    mount(resultBox, dataTable(
      [
        { label: "Ressource" },
        { label: "Besoin", right: true },
        { label: "Déjà produit", right: true },
        { label: "Reste", right: true },
        { label: `À ${s.boostRestant} % → nb`, right: true },
        { label: "Si nb mini → boost", right: true },
      ],
      rows,
    ));
  };

  /* Cartes « bâtiments existants » par type. */
  const existCard = (rkey) => {
    const bat = BUILDINGS[rkey];
    const accent = accentRes(rkey);
    const list = el("div", { class: "exist-list" });
    const badge = el("span", { class: "count" }, String(s.existants[rkey].length));
    countBadges[rkey] = badge;

    const row = (b) => {
      const val = el("span", { class: "range-val", style: { color: accent } }, `${b.boost} %`);
      return el("div", { class: "exist-row" },
        el("input", {
          type: "range", min: "0", max: "100", step: "5",
          value: String(b.boost), style: { accentColor: accent },
          "aria-label": `Boost du bâtiment ${bat.nom}`,
          onInput: (e) => {
            b.boost = +e.target.value;
            val.textContent = `${b.boost} %`;
            persist(); refresh();
          },
        }),
        val,
        el("button", { class: "x", title: "Retirer", onClick: () => {
          s.existants[rkey] = s.existants[rkey].filter((x) => x.id !== b.id);
          persist(); renderSeuils();
        } }, "✕"),
      );
    };

    mount(list, s.existants[rkey].map(row));
    return el("div", { class: "card exist-card", style: { borderTopColor: accent } },
      el("div", { class: "exist-head" },
        el("b", { style: { color: accent } }, bat.pluriel), badge),
      list,
      el("button", { class: "btn dashed", style: { color: accent }, onClick: () => {
        s.existants[rkey].unshift({ id: uid(), boost: 100 });
        persist(); renderSeuils();
      } }, "+ ajouter"),
    );
  };

  /* Bloc 1 : production visée. */
  const bloc1Content = () =>
    s.mode === "plan"
      ? el("div", { class: "plan-row" },
          segmented(
            [{ value: "soldat", label: "Soldats (60/h)" },
             { value: "defenseur", label: "Défenseurs (40/h)" }],
            s.unite,
            (v) => { s.unite = v; persist(); renderSeuils(); },
          ),
          numberField({
            label: "Casernes",
            value: s.casernes,
            tipText: "Nombre de casernes que tu veux faire tourner en continu.",
            onInput: (v) => { s.casernes = v; persist(); refresh(); },
          }),
          needBox,
        )
      : el("div", { class: "grid-3" },
          RESOURCES.map((r) => numberField({
            label: `${r.nom} /h voulus`,
            accent: accentRes(r.key),
            value: s.besoinLibre[r.key],
            tipText: `Production horaire de ${r.nom.toLowerCase()} que tu veux atteindre.`,
            onInput: (v) => { s.besoinLibre[r.key] = v; persist(); refresh(); },
          })),
        );

  mount(view(),
    header("PLANIFICATION", "Seuils de boost",
      "Indique ce que tu veux produire et les bâtiments que tu as déjà (avec leur boost réel). L'outil calcule les bâtiments restants à construire et le boost minimum requis."),
    el("section", { class: "block" },
      el("div", { class: "block-row" },
        el("span", { class: "block-label" }, "1 — Production visée",
          tip("Mode « Plan » : le besoin est déduit du nombre de casernes. Mode « Libre » : saisis directement les ressources/h visées.")),
        segmented(
          [{ value: "plan", label: "Plan soldats/déf." },
           { value: "libre", label: "Production libre" }],
          s.mode,
          (v) => { s.mode = v; persist(); renderSeuils(); },
        ),
      ),
      bloc1Content(),
    ),
    el("section", { class: "block" },
      el("div", { class: "block-label" }, "2 — Bâtiments déjà construits",
        tip("Ajoute chaque bâtiment existant avec son boost topographique réel : leur production est déduite du besoin.")),
      el("div", { class: "grid-3" }, ["champ", "scierie", "usine"].map(existCard)),
    ),
    el("section", { class: "block" },
      el("div", { class: "block-label" }, "3 — Bâtiments restants à construire"),
      rangeField({
        label: "Boost prévu sur les nouveaux bâtiments :",
        value: s.boostRestant,
        suffix: " %",
        onInput: (v) => { s.boostRestant = v; persist(); refresh(); },
      }),
      resultBox,
      el("div", { class: "legend" },
        el("div", {}, el("b", {}, "À X % → nb"), " : si tes nouveaux bâtiments sont au boost réglé ci-dessus, voici combien il en faut."),
        el("div", {}, el("b", {}, "Si nb mini → boost"), " : si tu construis le minimum de bâtiments (comme à 100 %), voici le boost minimum qu'ils doivent atteindre."),
      ),
      formulasPanel([
        ["Production d'un bâtiment", "base × (1 + boost/100) — champ 168 · scierie 126 · usine 130"],
        ["Reste à couvrir", "max(0, besoin − Σ prod existants)"],
        ["Nb au boost choisi", "⌈ reste / (base × (1 + boost/100)) ⌉"],
        ["Nb minimal", "⌈ reste / (base × 2) ⌉  (bâtiments à 100 %)"],
        ["Boost minimum", "(reste / (nbMini × base) − 1) × 100"],
      ]),
    ),
    actionBar(copySeuils),
    footRule("Base niveau max : champ 168 · scierie 126 · usine 130 (× (1 + boost)) · Soldat 600 C/300 B/120 E · Défenseur 200 C/400 B/400 E par caserne"),
  );
  refresh();
}

function copySeuils() {
  const s = state.seuils;
  const besoin = besoinSeuils();
  const lines = ["GEOCRACY — Seuils de boost"];
  lines.push(`Besoin : ${fmt(besoin.cereales)} C · ${fmt(besoin.bois)} B · ${fmt(besoin.eau)} E` +
    (s.mode === "plan" ? ` (${s.casernes} casernes de ${UNITS[s.unite].labelSingulier}s)` : " (libre)"));
  for (const a of analyseSeuils(besoin, s.existants, s.boostRestant)) {
    lines.push(a.couvert
      ? `· ${a.nom} : couvert (${fmt(a.prodExist)}/${fmt(a.need)} par ${a.nbExist} existant(s))`
      : `· ${a.nom} : reste ${fmt(a.reste)} → ${a.nbAuBoost} bât. à ${s.boostRestant} % — ou ${a.nbMini} bât. à ${Math.ceil(a.boostMin)} % min`);
  }
  return lines.join("\n");
}

/* ============================================================
 * ONGLET 3 — CALCULATEUR DE CRAFT
 * ========================================================== */

function renderCalc() {
  const s = state.calc;

  const villeProds = new Map(); // villeId → pied de carte (prod de la ville)
  const totalsBox = el("div", { class: "grid-3" });
  const maxBox = el("div", { class: "grid-2" });
  const mixBox = el("div", {});
  const splitLabel = el("span", {});

  const refreshVille = (ville) => {
    const node = villeProds.get(ville.id);
    if (!node) return;
    const vp = prodVille(ville);
    mount(node,
      el("span", { style: { color: accentRes("cereales") } }, `${fmt(vp.cereales)} C`),
      el("span", { style: { color: accentRes("bois") } }, `${fmt(vp.bois)} B`),
      el("span", { style: { color: accentRes("eau") } }, `${fmt(vp.eau)} E`),
    );
  };

  const refreshGlobal = () => {
    const { prod, counts } = prodTotale(s.villes);

    // 2 — Production totale
    mount(totalsBox, RESOURCES.map((r) => {
      const n = counts[r.building];
      return el("div", { class: "card total-card", style: { borderTopColor: accentRes(r.key) } },
        el("div", { class: "muted small" }, r.nom),
        el("div", { class: "total-val", style: { color: accentRes(r.key) } },
          fmt(prod[r.key]), el("span", { class: "big-unit" }, "/h")),
        el("div", { class: "muted small" }, `${n} ${BUILDINGS[r.building].pluriel.toLowerCase()}`),
      );
    }));

    // 3 — Capacité maximale
    const maxCard = (unite) => {
      const m = capaciteMax(prod, unite);
      return el("div", { class: "card max-card", style: { borderColor: accentRes(unite) } },
        el("div", { class: "small", style: { color: accentRes(unite), fontWeight: 700 } },
          unite === "soldat" ? "Tout en soldats" : "Tout en défenseurs"),
        el("div", { class: "max-big" }, fmt(m.unites), el("span", { class: "big-unit" }, " /h")),
        el("div", { class: "muted small" },
          `${m.casernes} casernes · limité par : `, el("b", {}, m.limitante)),
      );
    };
    mount(maxBox, maxCard("soldat"), maxCard("defenseur"));

    // 4 — Mix
    const mix = simulerMix(prod, s.casernes, s.split);
    mount(splitLabel,
      el("b", { style: { color: accentRes("soldat") } }, `${mix.ks} soldat`),
      " / ",
      el("b", { style: { color: accentRes("defenseur") } }, `${mix.kd} défenseur`),
    );
    mount(mixBox,
      el("div", { class: "grid-2 out-row" },
        el("div", { class: "out-unit", style: { borderColor: accentRes("soldat") } },
          el("div", { class: "out-val", style: { color: accentRes("soldat") } }, fmt(mix.soldatsH)),
          el("div", { class: "muted small" }, "soldats / h")),
        el("div", { class: "out-unit", style: { borderColor: accentRes("defenseur") } },
          el("div", { class: "out-val", style: { color: accentRes("defenseur") } }, fmt(mix.defenseursH)),
          el("div", { class: "muted small" }, "défenseurs / h")),
      ),
      dataTable(
        [{ label: "Ressource" }, { label: "Produite", right: true },
         { label: "Consommée", right: true }, { label: "Solde", right: true }],
        RESOURCES.map((r) => [
          r.nom,
          fmt(prod[r.key]),
          fmt(mix.conso[r.key]),
          el("b", { class: mix.solde[r.key] < 0 ? "bad" : "good" },
            (mix.solde[r.key] >= 0 ? "+" : "") + fmt(mix.solde[r.key])),
        ]),
      ),
      el("div", { class: "verdict " + (mix.soutenable ? "ok" : "ko"), role: "status" },
        mix.soutenable
          ? "✓ Mix soutenable avec ta production actuelle."
          : "⚠ Ressources insuffisantes — réduis les casernes ou rééquilibre le mix."),
    );
  };

  const refreshAll = (ville) => { if (ville) refreshVille(ville); refreshGlobal(); };

  /* Carte d'une ville. */
  const villeCard = (ville) => {
    const isManuel = ville.mode === "manuel";
    const prodFoot = el("div", { class: "ville-prod nums" });
    villeProds.set(ville.id, prodFoot);

    const batRow = (b) => {
      const t = BUILDINGS[b.type];
      const accent = accentRes(b.type);
      const prodSpan = el("span", { class: "bat-prod nums" },
        `${Math.round(prodBatiment(b.type, b.boost))}/h`);
      const boostSpan = el("span", { class: "range-val", style: { color: accent } }, `${b.boost} %`);
      return el("div", { class: "bat-row" },
        el("span", { class: "bat-tag", style: { background: accent } }, t.nom),
        el("input", {
          type: "range", min: "0", max: "100", step: "5",
          value: String(b.boost), style: { accentColor: accent },
          "aria-label": `Boost du bâtiment ${t.nom}`,
          onInput: (e) => {
            b.boost = +e.target.value;
            boostSpan.textContent = `${b.boost} %`;
            prodSpan.textContent = `${Math.round(prodBatiment(b.type, b.boost))}/h`;
            persist(); refreshAll(ville);
          },
        }),
        boostSpan, prodSpan,
        el("button", { class: "x", title: "Retirer", onClick: () => {
          ville.bats = ville.bats.filter((x) => x.id !== b.id);
          persist(); renderCalc();
        } }, "✕"),
      );
    };

    const card = el("div", { class: "card ville-card" },
      el("div", { class: "ville-head" },
        el("input", { class: "ville-nom", value: ville.nom, "aria-label": "Nom de la ville",
          onInput: (e) => { ville.nom = e.target.value; persist(); } }),
        !isManuel && el("span", { class: "muted small nums" }, `${ville.bats.length}/${MAX_SLOTS} slots`),
        s.villes.length > 1 && el("button", { class: "x", title: "Supprimer la ville",
          onClick: () => {
            s.villes = s.villes.filter((x) => x.id !== ville.id);
            persist(); renderCalc();
          } }, "✕"),
      ),
      segmented(
        [{ value: "bats", label: "Bâtiments + boost" },
         { value: "manuel", label: "Ressources /h" }],
        ville.mode,
        (v) => { ville.mode = v; persist(); renderCalc(); },
        "full",
      ),
      isManuel
        ? el("div", { class: "grid-3" },
            RESOURCES.map((r) => numberField({
              label: `${r.nom} /h`,
              accent: accentRes(r.key),
              value: ville.manual[r.key],
              onInput: (v) => { ville.manual[r.key] = v; persist(); refreshAll(ville); },
            })))
        : el("div", {},
            ville.bats.length === 0 &&
              el("div", { class: "empty" }, "Aucun bâtiment. Ajoute-en ci-dessous."),
            el("div", { class: "bat-list" }, ville.bats.map(batRow)),
            el("div", { class: "add-bat-row" },
              Object.entries(BUILDINGS).map(([key, t]) =>
                el("button", {
                  class: "btn outline",
                  style: { color: accentRes(key), borderColor: accentRes(key) },
                  disabled: ville.bats.length >= MAX_SLOTS,
                  onClick: () => {
                    if (ville.bats.length >= MAX_SLOTS)
                      return toast(`Limite de ${MAX_SLOTS} bâtiments par ville`, false);
                    ville.bats.push({ id: uid(), type: key, boost: 100 });
                    persist(); renderCalc();
                  },
                }, `+ ${t.nom}`)),
            ),
          ),
      prodFoot,
    );
    refreshVille(ville);
    return card;
  };

  mount(view(),
    header("LOGISTIQUE MILITAIRE", "Calculateur de craft",
      "Chaque bâtiment a son propre boost topographique (0 % = base, 100 % = production doublée). Compose tes villes bâtiment par bâtiment : l'outil calcule combien de soldats et défenseurs tu peux entretenir."),
    el("section", { class: "block" },
      el("div", { class: "block-row" },
        el("span", { class: "block-label" }, "1 — Tes villes et bâtiments",
          tip(`${MAX_SLOTS} bâtiments max par ville. Le mode « Ressources /h » permet de saisir directement la production lue en jeu.`)),
        el("button", { class: "btn", onClick: () => {
          s.villes.unshift({
            id: uid(), nom: `Ville ${s.villes.length + 1}`, mode: "bats",
            manual: { cereales: 0, bois: 0, eau: 0 }, bats: [],
          });
          persist(); renderCalc();
        } }, "+ Ajouter une ville"),
      ),
      el("div", { class: "villes-wrap" }, s.villes.map(villeCard)),
    ),
    el("section", { class: "block" },
      el("div", { class: "block-label" }, "2 — Production totale"),
      totalsBox,
    ),
    el("section", { class: "block" },
      el("div", { class: "block-label" }, "3 — Capacité maximale",
        tip("Capacité si toute la production est consacrée à un seul type d'unité.")),
      maxBox,
    ),
    el("section", { class: "block" },
      el("div", { class: "block-label" }, "4 — Simuler un mix"),
      el("div", { class: "grid-2 mix-controls" },
        numberField({
          label: "Casernes actives",
          value: s.casernes,
          onInput: (v) => { s.casernes = v; persist(); refreshGlobal(); },
        }),
        el("label", { class: "field range-field" },
          el("span", { class: "field-label" }, splitLabel),
          el("input", {
            type: "range", min: "0", max: "100", step: "5",
            value: String(s.split),
            "aria-label": "Répartition soldats / défenseurs",
            onInput: (e) => { s.split = +e.target.value; persist(); refreshGlobal(); },
          }),
        ),
      ),
      mixBox,
      formulasPanel([
        ["Production d'un bâtiment", "base × (1 + boost/100)"],
        ["Casernes soldats du mix", "arrondi(casernes × split / 100)"],
        ["Consommation", "ks × (600 C · 300 B · 120 E) + kd × (200 C · 400 B · 400 E)"],
        ["Capacité max", "min sur C/B/E de ⌊production / coût par caserne⌋"],
      ]),
    ),
    actionBar(copyCalc),
    footRule("Base niveau max · Champ 168 · Scierie 126 · Usine 130 (doublée à 100 % de boost) · Soldat 10 C/5 B/2 E · Défenseur 5 C/10 B/10 E"),
  );
  refreshGlobal();
}

function copyCalc() {
  const s = state.calc;
  const { prod, counts } = prodTotale(s.villes);
  const mix = simulerMix(prod, s.casernes, s.split);
  const ms = capaciteMax(prod, "soldat");
  const md = capaciteMax(prod, "defenseur");
  const lines = ["GEOCRACY — Calculateur de craft"];
  lines.push(`Production : ${fmt(prod.cereales)} C · ${fmt(prod.bois)} B · ${fmt(prod.eau)} E ` +
    `(${counts.champ} champs, ${counts.scierie} scieries, ${counts.usine} usines)`);
  lines.push(`Max soldats : ${fmt(ms.unites)}/h (${ms.casernes} casernes, limité par ${ms.limitante})`);
  lines.push(`Max défenseurs : ${fmt(md.unites)}/h (${md.casernes} casernes, limité par ${md.limitante})`);
  lines.push(`Mix ${s.casernes} casernes (${mix.ks} sold. / ${mix.kd} déf.) : ` +
    `${fmt(mix.soldatsH)} soldats/h + ${fmt(mix.defenseursH)} défenseurs/h`);
  for (const r of RESOURCES)
    lines.push(`  ${r.nom} : ${fmt(prod[r.key])} produit − ${fmt(mix.conso[r.key])} consommé = ${mix.solde[r.key] >= 0 ? "+" : ""}${fmt(mix.solde[r.key])}`);
  lines.push(mix.soutenable ? "✓ Mix soutenable" : "⚠ Ressources insuffisantes");
  return lines.join("\n");
}

/* ============================================================
 * ONGLET 4 — PLAN TYPE
 * ========================================================== */

function renderPlan() {
  const s = state.plan;
  const titleBox = el("span", {}); // inséré dans le <h1> de l'en-tête
  const cardsBox = el("div", { class: "plan-cards" });
  const bilanBox = el("div", {});

  const refresh = () => {
    const p = evaluerPlan(s.topo);

    mount(titleBox, `5 villes · ${fmt(p.soldatsH)} soldats / h`);

    mount(cardsBox, p.villes.map((v) =>
      el("div", { class: "card plan-card", style: {
        borderLeft: `4px solid ${v.hub ? "var(--c-soldat)" : "var(--c-bois)"}` } },
        el("div", { class: "plan-head" },
          el("b", { class: "plan-nom" }, (v.hub ? "🏰 " : "⚙ ") + v.nom),
          el("span", { class: "plan-role", style: { color: v.hub ? "var(--c-soldat)" : "var(--c-bois)" } }, v.role),
        ),
        el("div", { class: "chip-row" },
          v.ch > 0 && el("span", { class: "chip", style: { background: accentRes("cereales") } }, `${v.ch} champs`),
          v.sc > 0 && el("span", { class: "chip", style: { background: accentRes("bois") } }, `${v.sc} scieries`),
          v.us > 0 && el("span", { class: "chip", style: { background: accentRes("eau") } }, `${v.us} usines`),
          v.cas > 0 && el("span", { class: "chip", style: { background: accentRes("soldat") } }, `${v.cas} casernes`),
          v.eo > 0 && el("span", { class: "chip", style: { background: "var(--gold)" } }, `${v.eo} éoliennes`),
        ),
        el("div", { class: "plan-foot" },
          el("span", { class: "muted small nums" }, `${v.slots}/${MAX_SLOTS} slots`),
          v.hub
            ? el("b", { style: { color: "var(--c-soldat)" } }, `→ ${fmt(v.cas * 60)} soldats / h`)
            : el("span", { class: "nums small" },
                v.prod.cereales > 0 && el("b", { style: { color: accentRes("cereales") } }, `${fmt(v.prod.cereales)} C `),
                v.prod.bois > 0 && el("b", { style: { color: accentRes("bois") } }, `${fmt(v.prod.bois)} B `),
                v.prod.eau > 0 && el("b", { style: { color: accentRes("eau") } }, `${fmt(v.prod.eau)} E`)),
        ),
      )));

    mount(bilanBox,
      dataTable(
        [{ label: "Ressource" }, { label: "Produite", right: true },
         { label: "Consommée", right: true }, { label: "Solde", right: true }],
        RESOURCES.map((r) => [
          r.nom,
          fmt(p.tot[r.key]),
          fmt(p.conso[r.key]),
          el("b", { class: p.solde[r.key] >= 0 ? "good" : "bad" },
            (p.solde[r.key] >= 0 ? "+" : "") + fmt(p.solde[r.key])),
        ]),
      ),
      el("div", { class: "verdict " + (p.soutenable ? "ok" : "ko"), role: "status" },
        p.soutenable
          ? "✓ Le plan tient avec cette topographie."
          : "⚠ Le plan ne tient pas avec cette topographie : le solde d'au moins une ressource est négatif."),
      el("p", { class: "note" },
        "Chaque ville est spécialisée sur 1 ou 2 ressources au maximum, jamais 3 — logistique simple, un satellite ne livre qu'un ou deux flux. ",
        `Avec la topographie de référence (eau 0 %), l'eau reste le poste tendu : 8 usines réparties sur 3 satellites couvrent tout juste le besoin des ${p.tot.cas} casernes.`),
    );
  };

  mount(view(),
    header("PLAN OPTIMISÉ", titleBox,
      "Plan de référence : un hub militaire de 8 casernes soldats, alimenté par 4 satellites de production spécialisés (1 à 2 ressources chacun, jamais 3), chaque ville autonome en énergie. Ajuste les curseurs pour tester le plan sur TA topographie — amélioration par rapport au plan figé d'origine."),
    el("section", { class: "block" },
      el("div", { class: "block-label" }, "Ta topographie",
        tip("Boost topographique de ta zone pour chaque ressource. Le plan d'origine suppose céréales 100 %, bois 100 %, eau 0 %.")),
      el("div", { class: "grid-3" },
        RESOURCES.map((r) => rangeField({
          label: `${r.nom}`,
          value: s.topo[r.key],
          accent: accentRes(r.key),
          suffix: " %",
          onInput: (v) => { s.topo[r.key] = v; persist(); refresh(); },
        })),
      ),
    ),
    el("section", { class: "block" },
      el("div", { class: "block-label" }, "Attribution des villes"),
      cardsBox,
    ),
    el("section", { class: "block" },
      el("div", { class: "block-label" }, "Bilan ressources"),
      bilanBox,
    ),
    actionBar(copyPlan),
    footRule("Casernes Lv4 · 1 caserne = 60 soldats/h (600 C / 300 B / 120 E) · production bâtiment = base × (1 + boost topo)"),
  );
  refresh();
}

function copyPlan() {
  const p = evaluerPlan(state.plan.topo);
  const t = state.plan.topo;
  const lines = [
    "GEOCRACY — Plan type",
    `Topographie : céréales ${t.cereales} % · bois ${t.bois} % · eau ${t.eau} %`,
    `5 villes · ${p.tot.cas} casernes · ${fmt(p.soldatsH)} soldats/h`,
  ];
  for (const v of p.villes) {
    const compo = [
      v.ch && `${v.ch} champs`, v.sc && `${v.sc} scieries`, v.us && `${v.us} usines`,
      v.cas && `${v.cas} casernes`, v.eo && `${v.eo} éoliennes`,
    ].filter(Boolean).join(", ");
    lines.push(`· ${v.nom} (${v.role}) : ${compo}`);
  }
  for (const r of RESOURCES)
    lines.push(`  ${r.nom} : ${fmt(p.tot[r.key])} − ${fmt(p.conso[r.key])} = ${p.solde[r.key] >= 0 ? "+" : ""}${fmt(p.solde[r.key])}`);
  lines.push(p.soutenable ? "✓ Plan soutenable" : "⚠ Plan non soutenable avec cette topographie");
  return lines.join("\n");
}

/* ============================================================
 * DÉMARRAGE
 * ========================================================== */

function boot() {
  initTheme();
  document.getElementById("theme-toggle")
    .addEventListener("click", toggleTheme);

  // Priorité : configuration partagée par URL > sauvegarde locale > défauts
  const fromUrl = loadFromUrl();
  state = hydrate(fromUrl || loadLocal());
  if (fromUrl) {
    saveLocalDebounced(state);
    clearUrlHash();
    toast("Configuration importée depuis le lien");
  }
  render();
}

boot();
