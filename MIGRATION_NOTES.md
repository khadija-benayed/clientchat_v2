# MIGRATION_NOTES.md — Historique des migrations majeures

Ce document retrace les grandes évolutions de l'architecture de Client Chat, pour comprendre **pourquoi le code est écrit comme il l'est aujourd'hui**. À mettre à jour à chaque migration significative (changement de modèle IA, de stack, d'infrastructure).

Pour l'installation et le démarrage du projet, voir le [README.md](README.md).

---

## Calibration en attente — MMR (juin 2026)

### Contexte

`MMR_SIM_THRESHOLD = 0.92` dans `backend/main.py` — valeur par défaut non validée par mesure.

### Analyse du pipeline

Le pool MMR est **~30-40 chunks** (`match_count=30` + safety net ~10). Le diversity cap (max 2 par source) gère déjà la redondance intra-source. À seuil 0.92, MMR ne filtre que des chunks de cosine > 0.92 — ce qui exige du texte quasi-identique entre deux sources différentes. La plupart des recoupements sémantiques légitimes (même sujet, formulation différente) ont une cosine 0.75-0.88.

**Risque identifié** : si le `expected_source` chunk a une cosine > 0.92 avec un chunk mieux classé d'une autre source, MMR le drop silencieusement → `source_recall` = FAIL. L'output debug actuel (avant juin 2026) ne montrait pas les chunks filtrés.

### Ce qui a été instrumenté (juin 2026)

- `main.py` : paramètre `mmr_threshold` dans le body de la requête chat (override par requête, production l'omet)
- `run_eval.py` : flag `--mmr-threshold` qui passe la valeur au backend
- Debug output : champ `mmr_dropped` (nombre de chunks filtrés par MMR par requête)
- `testset.json` : enrichi de 4 cas abstain → 21 cas total (10 answer, 11 abstain)

### Procédure de calibration à exécuter

```bash
# Baseline avec MMR désactivé
python eval/run_eval.py --judge --mmr-threshold 1.01 > /tmp/eval_no_mmr.txt

# MMR actif (valeur courante)
python eval/run_eval.py --judge > /tmp/eval_mmr_092.txt

# Comparer source_recall dans les deux fichiers
```

**Interprétation** :
- `source_recall(1.01) >= source_recall(0.92)` → MMR dégrade le rappel → retirer ou monter à 0.95-0.97
- `source_recall(1.01) < source_recall(0.92)` → MMR aide → garder, tester 0.90
- Résultats identiques → MMR ne fire pas sur ce corpus → retirer pour simplifier le code

**Une fois la mesure faite**, mettre à jour le commentaire de `MMR_SIM_THRESHOLD` dans `main.py` avec : valeur retenue, source_recall mesurée, date.

---

## Migration 5 — Documentation team_members + tasks.created_at (juin 2026)

### Ce qui a été ajouté

| Objet | Description |
|---|---|
| `team_members` (référence) | Table "profiles" Supabase Auth — documentée dans seed.sql, pas exécutable from scratch |
| `tasks.created_at` | Colonne date de création — requêtée par `weekly_digest` mais absente de seed.sql |
| index `tasks_client_created_at_idx` | `(client_id, created_at DESC)` — optimise le filtre `.gte("created_at", since)` |

### Clarification : email_summary n'est pas une table

`email_summary` est une **valeur de `source_type`** dans `document_chunks`, pas une table. `sync_emails` (main.py) insère des chunks avec `source_type = 'email_summary'`. Aucune table séparée.

### Pourquoi team_members est documentaire dans seed.sql

`team_members` est le "profiles" pattern de Supabase : son `id` est un FK vers `auth.users(id)`. La table ne peut pas être créée par un `seed.sql` brut sur une base vide sans que Supabase Auth soit configuré. Elle est créée via le dashboard Supabase et documentée dans seed.sql pour que le schéma complet soit lisible dans le repo. La contrainte FK de `client_members.member_id → team_members.id` n'est pas imposée côté PostgreSQL pour la même raison.

### Scan prod complet (exécuté en juin 2026)

Tables présentes en prod, absentes de seed.sql avant cette migration :
- `team_members` → documentée dans seed.sql (référence)

Colonne absente :
- `tasks.created_at` → ajoutée dans seed.sql + migration

Tout le reste (fonctions, triggers, index) était à jour.

### Fichiers modifiés

- `supabase/migrations/20260625_team_members_created_at.sql` — migration idempotente (`tasks.created_at` + index)
- `supabase/seed.sql` — intègre team_members (documentaire) + tasks.created_at

---

## Migration 4 — task_history + last_modified_by (juin 2026)

### Ce qui a été ajouté

| Objet | Description |
|---|---|
| `tasks.last_modified_by` | UUID du membre ayant fait la dernière modification (upsert_task, delete_task) |
| `task_history` | Table d'audit field-level : une ligne par champ modifié, par tâche créée, ou par tâche supprimée |
| `log_task_history()` | Fonction trigger SECURITY DEFINER — compare OLD/NEW et insère dans task_history |
| `trg_task_history` | Trigger AFTER INSERT OR UPDATE OR DELETE sur tasks |

Ces objets existaient en production (référencés dans `main.py` : `weekly_digest`, `upsert_task`, `delete_task`) mais n'étaient pas dans `seed.sql`.

### Pourquoi last_modified_by est une colonne et pas une session variable

Le pooler Supabase tourne en mode **transaction** (PgBouncer). En mode transaction, `SET LOCAL` ne survit pas entre deux statements d'une même "connexion" applicative — le pool peut attribuer un autre slot PostgreSQL entre les deux appels. Utiliser `SET LOCAL app.user_id = '...'` dans le trigger était donc non fiable. La colonne `last_modified_by` sur la ligne elle-même est l'unique source sûre pour passer l'identité de l'auteur au trigger.

### Fichiers modifiés

- `supabase/migrations/20260623_task_history.sql` — migration idempotente à appliquer en SQL Editor Supabase
- `supabase/seed.sql` — intègre ces objets dans la vue "from scratch"

### Objets prod à vérifier

Le scan complet a été effectué dans la Migration 5 (juin 2026). Les écarts identifiés ont été corrigés : `tasks.created_at` ajoutée, `team_members` documentée.

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
