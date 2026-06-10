# MIGRATION_NOTES.md — Historique des migrations majeures

Ce document retrace les grandes évolutions de l'architecture de Client Chat, pour comprendre **pourquoi le code est écrit comme il l'est aujourd'hui**. À mettre à jour à chaque migration significative (changement de modèle IA, de stack, d'infrastructure).

Pour l'installation et le démarrage du projet, voir le [README.md](README.md).

---

## Migration 3 — Gemini remplace Claude comme modèle principal (avril 2026)

### Ce qui a changé

| Avant | Après |
|---|---|
| Claude Sonnet 4.6 (chat) | Gemini 2.5 Flash (chat, tasks, résumés) |
| Claude Haiku 4.5 (tasks, résumés) | Gemini 2.5 Pro (brief structuré) |
| SDK `anthropic` pour tout | SDK `google-generativeai` + `anthropic` (OCR uniquement) |

### Ce qui n'a pas changé

Claude Haiku 4.5 est **conservé** dans `extract_worker.py` pour l'OCR PDF via vision. Son pipeline est robuste et validé en production ; la migration complète vers Gemini Vision n'a pas été priorisée.

### Pourquoi cette migration

- Coût et disponibilité API plus favorables avec Google AI pour ce volume d'usage
- Gemini 2.5 Flash est multilingue, rapide, et supporte des contextes longs (idéal pour l'injection de docs Drive)

### Ce qu'il faut savoir dans le code

- `backend/main.py` : les constantes `GEMINI_FLASH = "gemini-2.5-flash"` et `GEMINI_PRO = "gemini-2.5-pro"` centralisent les IDs de modèles — ne pas les dupliquer ailleurs
- `backend/extract_worker.py` : seul fichier qui importe `anthropic` — à ne pas confondre avec le reste du backend
- `GOOGLE_API_KEY` (Google AI Studio, Gemini) est **distincte** de `GOOGLE_SA_KEY` (service account Drive/Gmail)

---

## Migration 2 — Frontend React + Vite remplace vanilla JS (mai 2026)

### Ce qui a changé

| Avant | Après |
|---|---|
| `index.html` + `db.js` + `ui.js` + `app.js` | `src/` avec composants React, hooks, lib |
| Variables globales `cur`, `tasks`, `session`… | State React dans `App.jsx`, distribué via props |
| `innerHTML` + `esc()` partout | JSX (React échappe automatiquement) |
| `document.getElementById` | `useRef` ou state React |
| Lucide CDN + `lucide.createIcons()` | `lucide-react` npm (import ES module) |
| `localStorage` pour le cache docs | State React en mémoire (hooks) |
| `open index.html` dans le navigateur | `npm run dev` → http://localhost:5173 |
| GitHub Pages copie directe des fichiers | GitHub Actions → `npm run build` → déploie `dist/` |

### Ce qui n'a pas changé

- Toutes les fonctionnalités : chat, to-do, Drive sync, KB, membres, résumés, fiche client
- Le CSS et le design visuel : les variables `--tx`, `--sur`, `--brd2` et les classes CSS sont préservées dans `src/index.css`
- Le backend Python : aucune modification
- La base de données Supabase : aucune modification
- L'URL de production : https://khadija-benayed.github.io/clientchat_v2/

### Les anciens fichiers

`app.js.old`, `db.js.old`, `ui.js.old`, `styles.css.old` — conservés à la racine en référence. Ils ne sont **pas** inclus dans le build Vite. Peuvent être supprimés quand la migration est définitivement stabilisée.

### Pourquoi cette migration

`ui.js` atteignait ~1900 lignes avec tout mélangé (rendu DOM, logique, état, prompts). La maintenance devenait laborieuse. React permet ~20 composants à responsabilité unique, des hooks réutilisables, et JSX qui évite les erreurs XSS par défaut.

---

## Migration 1 — Cloud Run remplace Supabase Edge Functions (2025)

### Ce qui a changé

| Avant | Après |
|---|---|
| Supabase Edge Functions (Deno) | FastAPI Python sur Google Cloud Run |
| Hugging Face Inference API (embeddings) | sentence-transformers local dans le conteneur |
| Timeout max 150s | Pas de limite (Cloud Run) |
| `paraphrase-multilingual-MiniLM-L12-v2` (384 dims, HF API) | `paraphrase-multilingual-mpnet-base-v2` (768 dims, local) |

### Pourquoi cette migration

- Les Edge Functions avaient des rate limits agressifs sur l'API HF Inference
- Le timeout max 150s était insuffisant pour indexer un dossier Drive avec 90+ fichiers
- sentence-transformers local : embeddings en ~10ms/batch, zéro dépendance API externe, cold start ~2s
- Le modèle mpnet-base-v2 (768 dims) remplace MiniLM (384 dims) — meilleure qualité de retrieval multilangue ; la table `document_chunks` utilise `vector(768)` en conséquence

### Ce qu'il faut savoir dans le code

- Le schéma Supabase (`supabase/seed.sql`) est sur `vector(768)` — si des chunks existent en 384 dims dans une ancienne base, ils sont incompatibles et doivent être ré-indexés
- Le modèle est **baked dans l'image Docker** au build (`Dockerfile`) — zéro téléchargement au cold start
