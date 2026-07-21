/* ============================================================
 * storage.js — Persistance et partage
 *
 * - Sauvegarde automatique de l'état dans le LocalStorage
 * - Encodage/décodage de l'état dans l'URL (partage de config)
 * - Priorité au chargement : URL > LocalStorage > défauts
 * ============================================================ */

import { debounce } from "./utils.js";

const STORAGE_KEY = "geocracy-calc:v1";
const HASH_PREFIX = "#cfg=";

/* --- LocalStorage ------------------------------------------ */

/** Lit l'état sauvegardé ; null si absent ou corrompu. */
export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Écrit l'état (appel direct). */
export function saveLocal(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* stockage plein ou indisponible : on ignore silencieusement */
  }
}

/** Version différée pour ne pas écrire à chaque frappe. */
export const saveLocalDebounced = debounce(saveLocal, 250);

/** Efface la sauvegarde (bouton Réinitialiser). */
export function clearLocal() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/* --- Partage par URL --------------------------------------- */

/* Encodage : JSON → UTF-8 → base64 « URL-safe ».
 * btoa ne gère pas l'Unicode brut, d'où le passage
 * par encodeURIComponent. */
function encodeState(state) {
  const json = JSON.stringify(state);
  return btoa(encodeURIComponent(json))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeState(b64) {
  const std = b64.replaceAll("-", "+").replaceAll("_", "/");
  const json = decodeURIComponent(atob(std));
  return JSON.parse(json);
}

/** Construit l'URL de partage pour l'état courant. */
export function buildShareUrl(state) {
  const base = location.origin + location.pathname;
  return base + HASH_PREFIX + encodeState(state);
}

/** Lit une configuration depuis l'URL ; null si absente/invalide. */
export function loadFromUrl() {
  if (!location.hash.startsWith(HASH_PREFIX)) return null;
  try {
    return decodeState(location.hash.slice(HASH_PREFIX.length));
  } catch {
    return null;
  }
}

/** Retire le hash de l'URL sans recharger (après import). */
export function clearUrlHash() {
  history.replaceState(null, "", location.pathname + location.search);
}
