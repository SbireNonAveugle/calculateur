# Geocracy · Calc

Calculateur interactif pour le jeu **Geocracy** : planification des hubs, seuils de boost, craft de soldats/défenseurs et plan de villes optimisé.

**100 % statique** — HTML5 / CSS3 / JavaScript ES6 (Vanilla, aucun framework, aucune dépendance). Hébergeable tel quel sur GitHub Pages.

## Fonctionnalités

- **4 calculateurs** : Hubs & villes · Seuils de boost · Calculateur de craft · Plan type
- Mise à jour des résultats **en temps réel**, validation des saisies (entiers ≥ 0, 10 slots max/ville)
- **Sauvegarde automatique** dans le LocalStorage (clé `geocracy-calc:v1`)
- **Partage de configuration par URL** (`#cfg=…`, base64 URL-safe — priorité : URL > sauvegarde locale > défauts)
- Boutons **Copier les résultats** (résumé texte) et **Réinitialiser**
- Panneaux repliables « **ƒ Formules utilisées** » sur chaque onglet
- **Infobulles** explicatives (accessibles clavier), **mode clair/sombre** (mémorisé, suit la préférence système)
- **Responsive** PC / mobile, `prefers-reduced-motion` respecté

## Règles du jeu encodées

| Donnée | Valeur |
|---|---|
| Champ / Scierie / Usine (base niveau max, boost 0 %) | 168 C · 126 B · 130 E par heure |
| Boost topographique | `prod = base × (1 + boost/100)` → 100 % = production doublée |
| Soldat | 10 C / 5 B / 2 E · 60/h par caserne → 600 C / 300 B / 120 E par caserne/h |
| Défenseur | 5 C / 10 B / 10 E · 40/h par caserne → 200 C / 400 B / 400 E par caserne/h |
| Slots par ville | 10 bâtiments max |

Toutes ces constantes sont centralisées dans `js/calculator.js` : modifier une valeur du jeu ne demande qu'une ligne.

## Architecture

```
/
├── index.html          Coquille minimale (topbar, onglets, #view)
├── css/
│   └── style.css       Thème « carte d'état-major », clair/sombre, responsive
├── js/
│   ├── app.js          État global, routage des onglets, rendu des 4 calculateurs
│   ├── calculator.js   Logique métier PURE (données du jeu + tous les calculs)
│   ├── storage.js      LocalStorage + encodage/décodage URL de partage
│   ├── ui.js           Constructeur DOM, thème, toasts, composants génériques
│   └── utils.js        fmt, clamp, uid, debounce, copie presse-papiers…
├── assets/
│   └── favicon.svg
└── README.md
```

**Séparation stricte** : `calculator.js` ne touche jamais au DOM (fonctions pures, testables) ; `ui.js` ne connaît aucune règle du jeu. `app.js` orchestre les deux.

**Stratégie de rendu** : chaque onglet distingue le rendu structurel (ajout/suppression d'éléments) du rafraîchissement des résultats seuls — la frappe dans un champ ne reconstruit pas les saisies, donc le focus est conservé.

## Ajouter un nouveau calculateur

1. Ajouter les fonctions de calcul (pures) dans `js/calculator.js`.
2. Dans `js/app.js` : ajouter l'entrée dans `TABS`, une clé d'état dans `defaultState()`, et une fonction `renderMonOnglet()` référencée dans `RENDERERS`.
3. C'est tout — persistance, partage URL, thème et barre d'actions sont déjà branchés.

## Déploiement sur GitHub Pages

```bash
git init && git add . && git commit -m "Geocracy Calc"
git branch -M main
git remote add origin https://github.com/<ton-user>/<ton-repo>.git
git push -u origin main
```

Puis **Settings → Pages → Source : `main` / root**. Le site est servi à `https://<ton-user>.github.io/<ton-repo>/`.

Aucune étape de build : les modules ES6 sont chargés nativement (`<script type="module">`).

## Améliorations par rapport au fichier d'origine (documentées)

- Suppression de React chargé par CDN (unpkg) → Vanilla JS, plus léger, fonctionne hors-ligne après le premier chargement.
- L'onglet **Plan type**, figé à l'origine (topo céréales 100 / bois 100 / eau 0), accepte désormais une **topographie réglable** : le plan est ré-évalué et un verdict indique s'il tient encore. La composition des 5 villes reste celle du plan de référence.
- Persistance, partage URL, copie des résultats, formules affichées, tooltips, mode sombre, validation des saisies, accessibilité (focus visible, aria, reduced-motion) : absents de l'original.
