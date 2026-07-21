/* ============================================================
 * ui.js — Couche présentation
 *
 * Aides de création DOM, gestion du thème clair/sombre,
 * notifications (toasts) et petits composants génériques.
 * Aucune règle du jeu ici : la logique vit dans calculator.js.
 * ============================================================ */

/* --- Création d'éléments ----------------------------------- */

/**
 * el("div", {class:"card", onClick:fn, dataset:{x:1}}, enfants…)
 * Petit constructeur DOM déclaratif.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "dataset") {
      Object.assign(node.dataset, v);
    } else if (k === "style" && typeof v === "object") {
      Object.assign(node.style, v);
    } else if (k === "class") {
      node.className = v;
    } else if (k in node && k !== "list") {
      node[k] = v;
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

/** Vide un conteneur puis y insère les enfants donnés. */
export function mount(container, ...children) {
  container.replaceChildren();
  for (const c of children.flat()) if (c) container.append(c);
}

/* --- Thème clair / sombre ---------------------------------- */

const THEME_KEY = "geocracy-calc:theme";

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

export function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.textContent = theme === "dark" ? "☀" : "☾";
    btn.setAttribute(
      "aria-label",
      theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"
    );
  }
}

/* --- Toast (notifications éphémères) ----------------------- */

let toastTimer;
export function toast(message, ok = true) {
  let t = document.getElementById("toast");
  if (!t) {
    t = el("div", { id: "toast", role: "status" });
    document.body.append(t);
  }
  t.textContent = message;
  t.dataset.kind = ok ? "ok" : "err";
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* --- Composants génériques --------------------------------- */

/** Bouton d'aide « ? » avec infobulle (accessible au clavier). */
export function tip(text) {
  return el(
    "span",
    { class: "tip", tabindex: "0", "data-tip": text, "aria-label": text },
    "?"
  );
}

/**
 * Groupe de boutons segmentés (toggle).
 * @param options [{value,label}] · @param current valeur active
 * @param onChange callback(value)
 */
export function segmented(options, current, onChange, extraClass = "") {
  return el(
    "div",
    { class: `seg ${extraClass}`, role: "tablist" },
    options.map((o) =>
      el(
        "button",
        {
          class: "seg-btn" + (o.value === current ? " on" : ""),
          role: "tab",
          "aria-selected": String(o.value === current),
          onClick: () => onChange(o.value),
        },
        o.label
      )
    )
  );
}

/**
 * Champ nombre labellisé avec validation intégrée.
 * onInput reçoit la valeur déjà nettoyée (entier ≥ 0).
 */
export function numberField({ label, value, onInput, min = 0, max, tipText, accent }) {
  const input = el("input", {
    type: "number",
    inputmode: "numeric",
    min: String(min),
    ...(max != null ? { max: String(max) } : {}),
    value: String(value),
    class: "num",
    onInput: (e) => {
      const n = Math.max(min, Math.floor(+e.target.value || 0));
      const capped = max != null ? Math.min(max, n) : n;
      if (String(capped) !== e.target.value && e.target.value !== "")
        e.target.value = String(capped);
      onInput(capped);
    },
  });
  return el(
    "label",
    { class: "field" },
    el(
      "span",
      { class: "field-label", style: accent ? { color: accent } : null },
      label,
      tipText ? tip(tipText) : null
    ),
    input
  );
}

/** Slider avec libellé de valeur mis à jour en direct. */
export function rangeField({ label, value, onInput, min = 0, max = 100, step = 5, accent, suffix = "%" }) {
  const out = el("output", { class: "range-val" }, `${value}${suffix}`);
  const input = el("input", {
    type: "range",
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    style: accent ? { accentColor: accent } : null,
    onInput: (e) => {
      const v = +e.target.value;
      out.textContent = `${v}${suffix}`;
      onInput(v);
    },
  });
  return el(
    "label",
    { class: "field range-field" },
    label ? el("span", { class: "field-label" }, label, " ", out) : out,
    input
  );
}

/** Table de données générique. cols: [{label, right}] · rows: array de cellules (Node|string). */
export function dataTable(cols, rows) {
  return el(
    "table",
    { class: "data" },
    el(
      "thead",
      {},
      el("tr", {}, cols.map((c) => el("th", { class: c.right ? "r" : "" }, c.label)))
    ),
    el("tbody", {}, rows.map((cells) =>
      el("tr", {}, cells.map((cell, i) =>
        el("td", { class: cols[i]?.right ? "r" : "" }, cell)
      ))
    ))
  );
}

/** Panneau repliable « Formules utilisées ». lines: [ [titre, formule] ]. */
export function formulasPanel(lines) {
  return el(
    "details",
    { class: "formulas" },
    el("summary", {}, "ƒ Formules utilisées"),
    el(
      "dl",
      {},
      lines.map(([t, f]) => [
        el("dt", {}, t),
        el("dd", {}, el("code", {}, f)),
      ])
    )
  );
}
