# CLAUDE.md — clientchat_v2

## Stack technique

- **Frontend** : React 18 + Vite — composants JSX, hooks, build vers `dist/`
- **Styles** : Tailwind CSS (utilitaires layout) + variables CSS (`--tx`, `--sur`, `--brd2`…) pour le thème clair/sombre — approche hybride, ne pas casser les classes CSS existantes
- **Icônes** : `lucide-react` (import ES module, pas CDN)
- **Rendu Markdown** : `react-markdown` + `remark-gfm` (utilisé dans les bulles de chat)
- **Polices** : DM Sans + DM Mono (Google Fonts)
- **Base de données** : Supabase (PostgreSQL + pgvector) — `@supabase/supabase-js@2` via npm
- **Auth** : Supabase Auth — Google OAuth (`signInWithOAuth`). JWT transmis au backend via `Authorization: Bearer`
- **Backend** : Python FastAPI sur Google Cloud Run — point d'entrée unique `BACKEND_URL` dans `src/lib/constants.js`
- **IA (chat/résumés/tâches)** : Gemini 2.5 Flash (`gemini-2.5-flash`) — appelé côté backend uniquement
- **IA (brief structuré)** : Gemini 2.5 Pro (`gemini-2.5-pro`) — appelé côté backend uniquement
- **IA (OCR PDF)** : Claude Haiku 4.5 — `extract_worker.py` uniquement (vision PDF)
- **Embeddings / RAG** : pipeline hybride local — zéro API externe :
  - Bi-encoder : `paraphrase-multilingual-mpnet-base-v2` (768 dims) pour la recherche vectorielle
  - Cross-encoder reranker : `mmarco-mMiniLMv2-L12-H384-v1` (multilingue) pour le classement fin
  - MMR dedup (seuil cosinus 0.92) pour éliminer les chunks redondants
  - Hybrid search pgvector HNSW + FTS (fusion RRF) pour le rappel
  - Les deux modèles sont baked dans le Docker au build (cold start ~2s)
- **Stockage documents** : Google Drive API v3 (service account) — export via backend Python
- **Déploiement front** : GitHub Pages (push sur `main` → CI → `npm run build` → `dist/`)
- **Déploiement backend** : Cloud Build (`cloudbuild.yaml`, timeout 300s) → Docker build → Cloud Run `clientchat-v2` (europe-west9)
- **CORS** : backend accepte uniquement `https://khadija-benayed.github.io`

## Architecture des fichiers

### Frontend

- `src/main.jsx` — point d'entrée React (monte `<App />`)
- `src/App.jsx` — composant racine : state global, routing auth/app, modals, raccourcis clavier
- `src/index.css` — variables CSS + Tailwind + styles globaux
- `src/lib/constants.js` — constantes globales (`BACKEND_URL`, `SB_URL`, `SB_KEY`, `EXPORTABLE_MIMETYPES`, `MC`), helpers (`esc`, `memberStyle`)
- `src/lib/supabase.js` — client Supabase singleton
- `src/lib/backend.js` — `callBackend()`, `openBackendSSE()`, `streamChatSSE()`, `indexSourceBatched()`, `getBackendHeaders()` — couche réseau (injecte JWT automatiquement)
- `src/hooks/useAuth.js` — auth Supabase (`SIGNED_IN`, `TOKEN_REFRESHED`, `_jwtToken`, `_currentUserId`)
- `src/hooks/useClients.js` — liste clients, sélection, tâches, Drive sync, Realtime Supabase
- `src/hooks/useChat.js` — messages, `send()`, prompts L1/L2/L3, task updates
- `src/hooks/useSync.js` — SSE streaming Drive sync + Email sync
- `src/utils/initials.js` — `computeInitials(fullName, email)`, `uniqueInitials(base, existing)`
- `src/utils/scope.js` — `SCOPE_LABELS`, `SCOPE_STYLES` — libellés et styles des scopes de tâches
- `src/components/auth/` — `LoginScreen`
- `src/components/layout/` — `Sidebar`, `ClientHeader`
- `src/components/chat/` — `ChatPanel`, `ChatInput`, `MessageList`, `MessageBubble`
- `src/components/tasks/` — `TaskPanel`, `TaskBoard`, `TaskCard`, `TaskFilters`, `TaskModal`, `CalendarModal`, `CRImportModal`
- `src/components/settings/` — `ClientSettings`, `DriveSection`, `EmailSection`, `MembersSection`
- `src/components/knowledge/` — `KnowledgeBase` (`KbSaveModal`, `KbBrowser`)
- `src/components/shared/` — `Modal`, `SyncStatus`, `ShortcutsModal`, `GmailPrefsModal`, `NewClientModal`, `JoinClientModal`

### Backend

- `backend/main.py` — FastAPI : middleware JWT + rate limiting (60 req/min/user), dispatcher d'actions, RAG, Gemini, Drive, Gmail
- `backend/extract_worker.py` — subprocess isolé pour extraction PDF/Office via Claude Haiku 4.5 (vision)
- `backend/requirements.txt` — dépendances Python
- `backend/Dockerfile` — `python:3.11-slim`, modèles sentence-transformers baked au build
- `backend/eval/run_eval.py` — banc d'éval léger du chat (phase 1 exacte + phase 2 LLM-juge), flag `--judge`
- `backend/eval/testset.json` — jeu de cas de test (questions + réponses attendues)

### Infrastructure / DB

- `cloudbuild.yaml` — pipeline CI/CD : `docker build ./backend` → `gcloud run deploy`, timeout 300s
- `supabase/seed.sql` — schéma PostgreSQL complet (tables + index HNSW/FTS + RPC `match_chunks`) — **source de vérité**
- `supabase/migrations/` — migrations encore à jour uniquement
- `supabase/oneshot/` — scripts ponctuels non rejouables (purges, backfills consommés)

## Commandes

- **Lancer le frontend localement** : `npm run dev` → http://localhost:5173/clientchat_v2/
- **Builder le frontend** : `npm run build` → génère `dist/`
- **Déployer le front** : `git push origin main` → GitHub Actions → `npm run build` → GitHub Pages
- **Déployer le backend** : `git push origin main` → Cloud Build trigger → build + deploy Cloud Run automatique
  - Trigger : `deploy-clientchat-v2` sur `clientchat-v2-prod`, branche `^main$`, fichier `cloudbuild.yaml`
  - Déploiement manuel de secours (si le trigger est indisponible) :
    `gcloud builds submit --config cloudbuild.yaml --project=clientchat-v2-prod --service-account="projects/clientchat-v2-prod/serviceAccounts/167005458056-compute@developer.gserviceaccount.com" .`
    ⚠️ Contrairement au trigger, `builds submit` part de la source **locale** et non du commit poussé : vérifier que le working tree est propre avant.
- **Backend local** : `cd backend && uvicorn main:app --reload --port 8080` (avec les vars d'env exportées)
- **Lancer l'éval** : `cd backend && python eval/run_eval.py [--judge] [--mmr-threshold X] [--inject-threshold Y]` (requiert `BACKEND_URL`)
  - **Authentification : identité dédiée, à mettre en place une fois.** Procédure complète dans [`backend/eval/README_AUTH.md`](backend/eval/README_AUTH.md) — création du compte, ligne `client_members`, fichier `.eval_credentials`. Le script ouvre une session par grant `password` à chaque lancement, avec la clé anon lue dans `src/lib/constants.js` : aucun secret supplémentaire, rien à renouveler.
  - ⚠️ **Ne pas se rabattre sur un refresh token de ta propre session** sauf en dépannage. Un refresh token partage sa chaîne de rotation avec le navigateur : dès que l'onglet de l'app se rafraîchit, celui de l'éval est invalidé (`refresh_token_already_used`). Éprouvé le 27/08/2026 — l'éval a cessé de s'authentifier entre deux lancements sans que rien n'ait changé de son côté.
  - `EVAL_JWT` reste accepté et prioritaire, pour un essai isolé (1 h).
  - `requests` n'est pas dans le Python système de la machine (PEP 668) : passer par un venv.
  - **Pourquoi c'est important** : tant que mesurer coûtait un aller-retour humain, la tentation de déployer sans mesurer revenait — c'est ainsi que deux correctifs de classement non validés sont partis en production le 27/08/2026.
  - **`--temperature` vaut 0 par défaut, ne pas l'enlever.** La production laisse le défaut de Gemini ; l'éval force 0 pour être reproductible. Sans ça, deux passes du *même* build donnaient des textes différents, donc des `must_contain` et des scores de juge différents.

### Quelles métriques croire

| Métrique | Fiabilité | Pourquoi |
|---|---|---|
| `source_recall`, `abstention` | **fiables** | dépendent du retrieval, déterministe (embedding, HyDE à température 0, cross-encoder) |
| `must_contain` | fiable **seulement** à `--temperature 0` | check de sous-chaîne exacte sur un texte généré |
| tout le phase 2 (`correctness`, `faithful`, `fabricated`) | fiable **seulement** à `--temperature 0` | le juge est à température 0, mais son entrée est la réponse générée |

Mesuré le 27/08/2026, deux passes consécutives du même build **sans** température fixée : six cas ont bougé sans qu'aucun correctif ne les touche. `az-app-ga4` basculait `must_contain` OK→KO parce que la réponse passait de « Le problème » à « Un problème » ; le juge notait 0.00 puis 1.00 la même abstention sur `az-point-tracking-19juin`. **Un delta sur ces métriques hors `--temperature 0` ne prouve rien, dans aucun des deux sens.**
- **Tests** : aucun framework de test — vérifier manuellement dans le navigateur
- **Avant tout déploiement backend** : `pyflakes backend/main.py | grep "undefined name"` doit être vide. `main.py` ne s'importe pas hors du conteneur (torch + sentence-transformers), donc rien d'autre n'attrape une erreur de nom — et le `try/except` large du pipeline RAG la déguise en « aucun document pertinent ». Cloud Build refuse désormais le build dans ce cas (étape 0 de `cloudbuild.yaml`), mais autant le voir avant de pousser.

## Conventions de code

### Nommage
- **Fonctions** : `camelCase` — ex. `renderTodo`, `selectClient`, `makeDueBadge`
- **Constantes globales** : `SCREAMING_SNAKE_CASE` — ex. `BACKEND_URL`, `EXPORTABLE_MIMETYPES`
- **Variables locales** : `camelCase` court — ex. `srcs`, `mems`, `sc`
- **IDs HTML** : `kebab-case` — ex. `todo-search`, `modal-settings`
- **Classes CSS** : `kebab-case` — ex. `task-clickable`, `msg-badge`

### Helpers globaux

**`src/lib/constants.js`**
- `esc(s)` → échappement HTML anti-XSS — **toujours utiliser pour afficher du contenu utilisateur dans du HTML généré dynamiquement**
- `memberStyle(initials)` → `{ bg, c }` — couleur d'avatar stable dérivée des initiales

**`src/lib/backend.js`**
- `callBackend(payload, jwtToken)` → wrapper `fetch` POST JSON, throw si HTTP non-2xx
- `openBackendSSE(payload, jwtToken, signal?)` → ouvre un stream SSE, retourne la réponse brute
- `streamChatSSE(payload, jwtToken, { onToken, onDone, onError }, signal?)` → stream SSE chat token par token
- `indexSourceBatched(payload, jwtToken)` → boucle `index_source` jusqu'à `has_more: false`
- `getBackendHeaders(jwtToken)` → construit les headers HTTP avec JWT

**`src/utils/`**
- `computeInitials(fullName, email)` → initiales 1-2 lettres
- `uniqueInitials(base, existing)` → déduplique en ajoutant un chiffre si besoin

Dans les composants React, les modals sont des composants `<Modal>` — pas de DOM imperatif.
Le thème sombre est géré via la classe `dark` sur `<html>` et les variables CSS `--tx`, `--sur`, `--brd2`.

### Auth — globaux importants
- `jwtToken` — JWT Supabase courant, exposé par `useAuth` et passé en props aux hooks/composants qui en ont besoin
- `currentUserId` — UUID Supabase Auth de l'utilisateur connecté
- Ne jamais appeler `fetch(BACKEND_URL)` directement — passer par `callBackend(payload, jwtToken)`

### Formatage
- Indentation : **2 espaces**
- Accolades sur la même ligne : `function foo() {`
- Code dense accepté pour le rendu HTML inline (concaténation de strings)

### Gestion des erreurs
- Les appels Supabase sont toujours destructurés : `const {data, error} = await sb.from(…)`
- Les erreurs non bloquantes (Drive, cache) utilisent `console.warn` + `catch` silencieux
- Les erreurs bloquantes (auth, sauvegarde) remontent via `showErr(id, msg)`

### Sécurité XSS
- Tout contenu issu de la DB ou de l'utilisateur affiché dans `innerHTML` **doit passer par `esc()`**
- Utiliser `createElement` + `.value` / `.textContent` pour les inputs dynamiques

### Patterns à suivre
- Appels backend : toujours via `callBackend({action: '...', ...}, jwtToken)`, jamais `fetch(BACKEND_URL, ...)` brut
- Chat SSE : via `streamChatSSE()` — le payload n'a **pas** de clé `action` (le dispatcher route sur `action is None`)
- Icônes Lucide : importer depuis `lucide-react` — ex. `import { Settings } from 'lucide-react'` — pas de CDN
- Thème clair/sombre : utiliser les variables CSS `--tx`, `--sur`, `--brd2` — jamais de couleurs en dur
- Persistance légère : `localStorage` avec préfixe `cc-` (ex. `cc-dark`, `cc-sess`, `cc-todo-w`)
- Realtime Supabase : un seul canal actif par client (`rtChan`), toujours `removeChannel` avant d'en créer un nouveau
- Modals : utiliser le composant `<Modal>` partagé — pas de manipulation DOM impérative
- State : le state global vit dans `App.jsx` et descend via props — pas de state local pour des données partagées

### Ce qu'il ne faut pas faire
- Ne pas écrire dans `innerHTML` sans `esc()` sur les données externes
- Ne pas utiliser `document.getElementById` ou `document.addEventListener` directement — utiliser `useRef` et les event handlers React
- Ne pas appeler `fetch(BACKEND_URL)` directement — passer par `callBackend()`
- Ne pas importer `lucide` via CDN — utiliser `lucide-react` npm

## Pipeline RAG — ordre réel et pièges connus

Le RAG vit dans `chat()` (`backend/main.py`). Ordre effectif :

1. **Détection de browse temporel** (`_TEMPORAL_BROWSE_PATTERNS`) — « quoi de neuf », « derniers docs »… Court-circuite tout le reste : liste les 10 sources les plus récentes, pas de recherche sémantique.
2. **HyDE** — si la question fait > 25 chars, Gemini Flash rédige un faux extrait de document, et c'est *lui* qui est embeddé, pas la question.
3. **`match_chunks` RPC**, `match_count=30` — hybride RRF : bras sémantique (HNSW, `LIMIT 60`) ∪ bras FTS (`ts_rank_cd`, `LIMIT 60`).
4. **Filet de sécurité par nom de fichier** — sources dont le nom partage ≥ 2 mots avec la question et absentes du top-30, ajoutées au pool (max 3 sources × 2 chunks).
5. **Cross-encoder** (`_rerank_chunks`) sur tout le pool → `rerank_score`, **logit brut** (~-11 à +11). La paire est `(question, chunk_text)` — voir les pièges quant au nom de la source.
6. **Score final** — `0.7 × rerank_score + 0.3 × score_temporel`, sur le logit **brut** (voir les pièges). Le `decay` passe de 180 à 30 jours si la question contient un mot temporel ; les chunks `session` reçoivent 0.5.
7. **MMR** (`_mmr_filter`, seuil 0.92) sur les embeddings renvoyés par le RPC.
8. **Cap de diversité** — 2 chunks/source, 1 si la source vient du filet, 4 si une source domine le top-10 (« requête ciblée »).
9. **Injection** — seuil sur le **logit brut** (-1.0, ou -2.0 pour une question de type compte-rendu), `MAX_INJECT` 6 ou 8. Le plus récent d'une série datée (question en « le dernier… ») passe avant tout et sans condition de score.

### Pièges vérifiés en production — ne pas les réintroduire

- **Le nom du fichier alimente l'embedding et le FTS, mais PAS la paire du cross-encoder.** Préfixer la paire du nom (et de sa date) a été tenté et annulé le 27/08/2026 : les noms portant des dates, toute question mentionnant une année s'appariait à tous les documents de cette année. Sur une question GA4 contenant « 2026 », les six notes de suivi datées de 2026 sont passées de -3.6/+2.6 à +1.1/+6.6 et ont éjecté la source attendue — `source_recall` 14/15 → 13/15. Le reranker juge le texte ; le nom est exploité ailleurs (embedding, tsvector, `_series_source`).
- **Ne PAS normaliser `rerank_score` par sigmoid.** Tenté et annulé le 27/08/2026 après mesure en production : sigmoid écrase le régime négatif vers 0, le terme temporel prend le dessus et le classement devient un tri par date. Un chunk à rerank -9.594 s'est retrouvé premier du pool parce que son fichier datait de la veille. L'asymétrie d'échelle entre `0.7 × logit` et `0.3 × temporel` est **volontaire** : le temporel départage des chunks de pertinence comparable, il ne classe pas.
- **« le dernier X » n'est pas une question de similarité sémantique.** Un cross-encoder note la proximité texte/question, il n'ordonne pas des documents entre eux — aucun réglage de seuil ne l'y amènera. Ces questions passent par la sélection du plus récent d'une série datée (`_series_source`), qui garantit sa place au document indépendamment de son score. Même logique que `_TEMPORAL_BROWSE_PATTERNS`. Comme ce mécanisme contourne le seuil qui protège l'abstention, **vérifier avant tout élargissement du déclencheur qu'aucun cas `should_abstain` du testset ne le fait fire**.
- **Ne pas baisser le seuil d'injection pour compenser un défaut de rappel.** Mesuré sur le testset le 27/08/2026 : le logit du top-1 a pour minimum -0.96 sur les cas `answer` et pour médiane -1.23 sur les cas `abstain`. Le seuil -1.0 / -2.0 tombe pile sur cette frontière. Le passer à -4 injecte ≥ 1 chunk dans 12 des 14 cas d'abstention, contre 14/14 d'abstention correcte aujourd'hui. Le flag `--inject-threshold` existe pour rejouer le balayage, pas pour bouger la valeur à l'aveugle.
- **Le seuil d'injection porte sur `rerank_score` (logit brut), pas sur `final_score`.** `final_score` est dans [0, 1] depuis la normalisation sigmoid ; l'y comparer laisserait tout passer.
- **Ne jamais borner une liste de sources avec `.limit(N)` sur `document_chunks`.** `N` tronque les *chunks*, pas les *sources* : un `.limit(500)` ne révélait que 17 des 123 sources d'aroma-zone (5 110 chunks), et le filet par nom de fichier était donc aveugle à 86 % du corpus. Passer par `_client_source_names()`, qui pagine.
- **`drive_modified_at` ne dit pas de quand date le contenu.** C'est le `modifiedTime` de Drive. Les 6 « Notes point suivi tracking » d'aroma-zone couvrent avril→juillet 2026 mais ont toutes `drive_modified_at = 2026-07-31` (retouchées le même jour). La date du contenu vit dans `doc_date`, extraite du nom de fichier par `_doc_date_from_name()`. Le RPC renvoie `COALESCE(doc_date, drive_modified_at, created_at)`.
- **Le `fts` inclut `source_name`.** Sans ça le nom du fichier — donc son sujet et sa date — était invisible au bras mots-clés : le fichier littéralement nommé « Notes point suivi tracking 31/07/2026 » sortait au rang FTS 279, hors du `LIMIT 60`. Toute modification du tsvector doit garder le nom en tête.
- **Les résumés de session sont du texte généré par le modèle, réinjecté dans ses propres prompts.** Deux chemins : `useChat.js buildL2/buildL3` → `[Sessions récentes]` (inconditionnel, à chaque message) et `summarize_session` → `document_chunks(source_type='session')` → RAG. Une date inventée s'y fixe et se resert indéfiniment (cas du « point de tracking du 29 juin 2026 », 27/08/2026 — date absente de tous les documents Drive). Les deux blocs portent un cadrage « NON VÉRIFIÉ » explicite : **ne pas l'alléger**. Un chunk `session` ne compte jamais comme « document trouvé », et reçoit un score temporel neutre (0.5) plutôt que la fraîcheur de son `created_at`.
- **Le `try/except` autour du pipeline RAG déguise les bugs en absence de résultat.** Une erreur de code y devenait « aucun extrait pertinent trouvé », indiscernable d'une abstention légitime : le 27/08/2026 un `NameError` a tué la recherche documentaire en production sans aucun symptôme visible. Trois signaux existent maintenant, **ne pas les retirer** :
  - le prompt reçoit un bloc `[Recherche documentaire INDISPONIBLE]` qui interdit explicitement au modèle de dire « je ne trouve pas cette information » — ce serait laisser croire qu'il a cherché ;
  - le payload SSE `done` porte `rag_degraded`, **toujours présent et pas seulement en mode debug**, et le front affiche un avertissement (`.msg-rag-warning`) ;
  - le payload `debug` porte `{"rag_error": …}` et la trace `[RAG]` la ligne `⚠ PIPELINE EN ERREUR`. **Un `debug` vide sur une question qui devrait ramener des documents veut dire pipeline en erreur, pas corpus vide.**
- **`is_administrative` doit être filtré partout**, y compris dans le filet de sécurité — sinon les pièces comptables exclues par le RPC rentrent par la porte de service.

### Observabilité

`RAG_DEBUG=1` sur le service Cloud Run active la trace `[RAG]` : question, cible d'embedding (HyDE ou brut), tsquery, taille du pool et origine des chunks, decay appliqué, tableau scoré après rerank, chunks écartés par MMR, et contenu final injecté. C'est le premier réflexe pour « pourquoi ce document ne remonte pas ». Le chat accepte aussi `debug: true` dans le payload : le `done` SSE renvoie alors `debug` (top-15 scoré) et `injected_context`.

## Observabilité LLM — Langfuse

API **v4**, épinglée `langfuse==4.14.5` dans `requirements.txt`. **Toujours épingler en `==`** : la bibliothèque a cassé son API deux fois (v2→v3 supprime `langfuse.decorators`, v3→v4 encore), et un `>=` rend le build Docker non reproductible. Le 27/08/2026, `langfuse>=2.51.0` résolvait vers la 4.14.5 face à du code v2 — l'import au niveau module aurait empêché FastAPI de démarrer.

L'import est **fail-open** : SDK absent, version incompatible ou clés manquantes ⇒ `observe` devient transparent, le client absorbe tout appel, le backend démarre. De la télémétrie ne doit jamais pouvoir tuer le service. Comme ce repli est silencieux, `/health` expose `langfuse_enabled` — **à vérifier après tout déploiement touchant la dépendance**.

Correspondances v2 → v4, si tu retrouves du vieux code :

| v2 | v4 |
|---|---|
| `from langfuse.decorators import observe, langfuse_context` | `from langfuse import observe` + méthodes du client |
| `@observe(name="x")` avec `model`/`usage` | `@observe(name="x", as_type="generation")` — sans ça v4 crée un span et les tokens ne remontent pas |
| `langfuse_context.update_current_observation(…)` | `_langfuse.update_current_generation(…)` |
| `usage={"input": …, "output": …}` | `usage_details={"input": …, "output": …}` |
| `_langfuse.trace(…)` | `_langfuse.start_observation(name=…, as_type="span", …)` — la trace **est** son span racine |
| `trace.generation(…)` | `span.start_observation(as_type="generation", …).end()` |
| — | `span.end()` obligatoire, sinon la trace reste ouverte |

`user_id` voyage dans les métadonnées et non comme attribut de trace : en v4 il ne se pose qu'via `propagate_attributes()`, un context manager qui obligerait à ouvrir le span racine dans le générateur SSE — donc à sortir tout le pipeline RAG de la trace. Compromis assumé, documenté au point d'appel dans `chat()`.

## Migrations SQL

`supabase/seed.sql` est la **source de vérité** du schéma et des RPC. `supabase/migrations/` ne contient que les migrations encore à jour ; `supabase/oneshot/` les scripts ponctuels non rejouables.

⚠️ **Ne jamais reconstruire une fonction SQL depuis un vieux fichier de `migrations/`.** Le 27/08/2026, la migration `20260827` a été bâtie sur `20260625_match_chunks_embedding.sql`, qui avait divergé de la prod : elle a réintroduit un `SET LOCAL` dans une fonction `STABLE` (erreur 0A000 à *chaque* appel, avalée par le `try/except` Python → recherche documentaire muette), perdu `#variable_conflict use_column` et perdu les trois `AND NOT dc.is_administrative`. Repartir de `seed.sql`, ou du `pg_get_functiondef` de la prod :

```bash
psql "$DATABASE_URL" -At -c "select pg_get_functiondef(oid) from pg_proc where proname='match_chunks';"
```

**Et toute migration doit être reportée dans `seed.sql` dans le même commit.** C'est la contrepartie de la règle ci-dessus : si `seed.sql` est la source de vérité, il ne peut pas être en retard. Le 27/08/2026 il l'était de deux correctifs — son `match_chunks` ne renvoyait même pas de colonne de date, son `fts` ignorait `source_name`, et `doc_date` n'existait pas — de sorte que suivre la consigne « repartir de `seed.sql` » aurait réintroduit les régressions du jour, et qu'un environnement neuf aurait échoué dès la première indexation (`index_source` insère `doc_date`). Contrôle :

```bash
psql "$DATABASE_URL" -At -c "select string_agg(column_name,' ' order by ordinal_position) from information_schema.columns where table_name='document_chunks';"
# doit correspondre à la définition de seed.sql
```

Toute migration qui touche le classement (`fts`, `doc_date`, pondérations) doit être encadrée d'un `backend/eval/run_eval.py --judge` avant / après, comparé sur `source_recall`.

## Variables d'environnement backend

Injectées dans Cloud Run (jamais dans le frontend) :

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | URL projet Supabase |
| `SUPABASE_SERVICE_KEY` | Clé service role (accès complet) |
| `GOOGLE_API_KEY` | Clé API Google AI (Gemini 2.5 Flash / Pro) |
| `ANTHROPIC_KEY` | Clé API Anthropic (Claude Haiku 4.5 — OCR PDF, extract_worker.py uniquement) |
| `GOOGLE_SA_KEY` | JSON service account Google Drive + Gmail (stringifié) |
| `LANGFUSE_PUBLIC_KEY` | Clé publique Langfuse (observabilité LLM) — absente ⇒ SDK désactivé, pas de crash |
| `LANGFUSE_SECRET_KEY` | Clé secrète Langfuse |
| `LANGFUSE_HOST` | URL de l'instance Langfuse |
| `RAG_DEBUG` | `1` active la trace `[RAG]` du pipeline de recherche |

## Schéma Supabase

| Table | Description |
|-------|-------------|
| `clients` | Espaces projets (name, context, drive_folder_id, sources jsonb) |
| `client_members` | Rôles par espace — `owner` ou `member` (UNIQUE client_id + member_id) |
| `client_invitations` | Tokens d'invitation par email (expire 7 jours) |
| `tasks` | Tâches par client — prio P1/P2/P3, status, scope internal/external/uncertain, due_date |
| `task_history` | Audit trail field-level des modifications de tâches (created/updated/deleted) |
| `document_chunks` | Embeddings RAG 768 dims, `fts` tsvector généré sur `source_name + chunk_text`, index HNSW cosinus. `drive_modified_at` = modifiedTime Drive ; `doc_date` = date lue dans le nom du fichier, prioritaire dans le score temporel |
| `session_summaries` | Résumés de session auto-générés |
| `agency_knowledge` | Base de savoir partagée de l'agence |
| `embedding_logs` | Traçabilité des indexations (chunks count, tokens estimés) |
| `usage_logs` | Suivi coût et tokens IA (model, tokens_input/output, cost_usd) |
| `sync_ignored` | Fichiers Drive exclus de la détection de nouveautés (source_id unique) |

## Actions backend disponibles

Toutes via `POST BACKEND_URL` avec `{ "action": "...", ... }` + header `Authorization: Bearer <jwt>`.
**Exception** : le chat n'a pas de clé `action` dans le payload — le dispatcher route sur `action is None`.

| Action | Description |
|--------|-------------|
| *(aucune)* | Chat Gemini 2.5 Flash avec RAG + reranker + MMR — passer `message_type: "task_action"` pour les actions tâches (sans RAG) |
| `me` | Infos de l'utilisateur connecté + liste de ses clients assignés |
| `index_source` | Chunk + embed + persist un document |
| `delete_source_chunks` | Purge les chunks d'une source |
| `list_drive_metadata` | Liste métadonnées d'un dossier Drive |
| `export_single_file` | Exporte le contenu d'un fichier Drive |
| `save_to_kb` | Sauvegarde un insight en agency_knowledge |
| `summarize_session` | Résumé de session (Gemini Flash) |
| `generate_brief` | Fiche client JSON structurée (Gemini Pro) |
| `upsert_task` | Crée ou met à jour une tâche (écrit dans task_history) |
| `delete_task` | Supprime une tâche |
| `propose_cr_tasks` | Propose des tâches à partir d'un compte-rendu (Gemini Flash) |
| `weekly_digest` | Digest hebdomadaire des tâches par client (Gemini Flash) |
| `create_client` | Crée un client + insère les client_members atomiquement |
| `delete_client` | Supprime un client (owner requis) |
| `get_client_members` | Liste membres + team_members disponibles + flag is_owner |
| `add_client_member` | Ajoute un team_member à un client (owner requis) |
| `remove_client_member` | Retire un membre (owner requis, dernier owner bloqué) |
| `set_member_role` | Passe owner ↔ membre (owner requis, dernier owner bloqué) |
| `claim_ownership` | Devient owner si le client n'en a aucun |
| `create_invitation` | Crée un token d'invitation par email |
| `join_client_via_token` | Rejoint un client via token d'invitation |
| `sync_drive` | Sync Drive complète SSE (stream événements) |
| `sync_state` | Statut d'un sync Drive en cours (fallback si SSE coupé) |
| `sync_emails` | Sync emails Gmail labelisés SSE |
| `update_gmail_sync` | Met à jour les préférences de sync Gmail |
| `eval_judge` | LLM-juge sémantique pour le banc d'éval (Gemini Flash) |
| `GET /health` | Healthcheck — retourne `{ok, model_loaded, reranker_loaded, langfuse_enabled}` |
