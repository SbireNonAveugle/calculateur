/* ============================================================
 * utils.js — Fonctions utilitaires génériques
 * Aucune dépendance. Réutilisable par tous les modules.
 * ============================================================ */

/** Formate un nombre en entier localisé fr-FR (ex : 4 800). */
export const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR");

/** Contraint une valeur numérique dans [min, max]. NaN → min. */
export const clamp = (v, min, max = Infinity) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

/** Parse une saisie utilisateur en entier ≥ 0 (NaN, vide, négatif → 0). */
export const toInt = (v, max = 1_000_000_000) => Math.floor(clamp(v, 0, max));

/** Générateur d'identifiants uniques (session courante). */
let _id = Date.now() % 100000;
export const uid = () => ++_id;

/** Debounce simple (utilisé pour la sauvegarde automatique). */
export const debounce = (fn, ms = 300) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

/** Clone profond via structuredClone avec repli JSON. */
export const deepClone = (obj) =>
  typeof structuredClone === "function"
    ? structuredClone(obj)
    : JSON.parse(JSON.stringify(obj));

/** Copie un texte dans le presse-papiers ; renvoie une promesse booléenne. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Repli pour contextes non sécurisés
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}
