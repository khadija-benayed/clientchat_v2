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

## Migration 6 — Le RAG cesse d'ignorer les noms de fichiers et de se citer lui-même (août 2026)

### Le symptôme

Le 27/08/2026, à la question « que s'est-il passé lors du dernier point de tracking ? », le chat répond que le dernier point s'est tenu **le 29 juin 2026**. Or il existe des notes de suivi datées du 31/07/2026, bien indexées, et aucun document du Drive ne mentionne le 29 juin.

### Le diagnostic

Tracé sur la base de prod, client aroma-zone (5 110 chunks, 123 sources). Quatre causes se cumulaient.

**1. La date du contenu n'existait nulle part d'exploitable.** Les 6 « Notes point suivi tracking » sont 6 Google Docs distincts couvrant avril→juillet, tous retouchés le 31/07/2026 — donc `drive_modified_at = 2026-07-31` pour les six. `modifiedTime` dit quand le fichier a été touché, pas de quand date son contenu. Et le corps des notes ne contient pas sa propre date. Aucun signal chronologique.

**2. Le bras FTS ne voyait pas les noms de fichiers.** `fts` était généré sur le seul `chunk_text`. Rangs mesurés pour la tsquery `passé|lors|dernier|point|tracking` :

| Source | Rang FTS | Dans le `LIMIT 60` |
|---|---|---|
| Point 10/06/2026 | 5 | oui |
| Notes point suivi tracking 10/07/2026 | 12 | oui |
| Notes point suivi tracking 24/04/2026 | 14 | oui |
| **Notes point suivi tracking 31/07/2026** | **279** | **non** |
| Notes point suivi tracking 19/06/2026 | 281 | non |
| Notes point suivi tracking 05/06/2026 | 615 | non |

Le fichier littéralement intitulé « Notes point suivi tracking 31/07/2026 » n'entrait jamais dans le pool du reranker. Que 10/07 passe et 31/07 non ne tenait qu'au vocabulaire du corps du texte.

**3. Le filet de sécurité par nom de fichier était aveugle.** Il listait les sources avec `.select("source_name").limit(500)` — un `limit` sur les **chunks**, pas sur les **sources**. Sur aroma-zone il ne voyait que **17 sources sur 123**, et aucune note de tracking. Le mécanisme précisément conçu pour rattraper un document nommé dans la question ne pouvait quasiment jamais se déclencher. Ce même bloc ne filtrait pas `is_administrative`, rouvrant au RAG les pièces comptables que `match_chunks` exclut.

**4. Une boucle de rétroaction — la cause de la date inventée.** La réponse servie à 14:16 venait mot pour mot de `Session du 2026-08-27`, un résumé écrit le matin même. Chaîne complète :

- **09:37** — `summarize_session` produit un résumé déjà faux, qui cite « `[Sessions récentes]` » — l'en-tête de son propre prompt — comme s'il s'agissait d'un nom de fichier.
- Ce résumé repart dans **chaque** prompt suivant par deux chemins indépendants : `useChat.js buildL2/buildL3` → `[Sessions récentes]` (inconditionnel), et `document_chunks(source_type='session')` → RAG.
- **10:25** — le modèle relit son propre texte et produit une version plus nette, plus assurée, toujours fausse.
- **14:16** — servie telle quelle à l'utilisateur, sans réserve, comme un fait sourcé.

Aggravant : les chunks `session` sont insérés sans `drive_modified_at`, le RPC leur substituait `created_at` — « écrit aujourd'hui » devenait « document le plus frais » et ils raflaient le bonus temporel maximal. Et le garde-fou « aucun extrait pertinent » ne se déclenchait que si `doc_chunks` **et** `session_chunks` étaient vides : le cas le plus dangereux, un résumé seul sans aucun document, passait sans avertissement.

**Écarté :** MMR n'y était pour rien (cosine max entre chunks voisins 0.75, loin du seuil 0.92). Le correctif de la date du matin (`20260827b`) était bien appliqué en prod — vérifié via `pg_get_functiondef` — mais quasi inerte pour une autre raison, voir ci-dessous.

### Ce qui a été corrigé

| # | Correctif | Où |
|---|---|---|
| 1 | Cadrage « NON VÉRIFIÉ » des résumés de session, sur les deux chemins d'injection ; un chunk `session` ne compte plus comme « document trouvé » ; score temporel neutre (0.5) pour les sessions | `main.py`, `useChat.js` |
| 2 | `_client_source_names()` pagine au lieu de `.limit(500)` ; `is_administrative` filtré dans le filet | `main.py` |
| 3 | `fts` généré sur `source_name + chunk_text` | `20260827c_fts_source_name.sql` |
| 4 | Colonne `doc_date`, extraite du nom de fichier, prioritaire dans le score temporel | `20260827d_doc_date.sql`, `_doc_date_from_name()` |
| 5 | ~~`final_score = 0.7 × sigmoid(rerank) + 0.3 × temporel`~~ — **annulé, voir ci-dessous** | `main.py` |
| 6 | Le cross-encoder reçoit le nom de la source dans la paire | `_rerank_chunks()` |
| 7 | « le dernier X » sélectionne le plus récent d'une série datée | `main.py` |
| — | Purge des lignes empoisonnées | `oneshot/20260827_purge_boucle_session.sql` |

Sur le **5** : `reranker.predict` renvoie un logit brut (~-11 à +11). La combinaison était donc `0.7 × logit + 0.3 × temporel`, soit un premier terme dans [-7.7, +7.7] contre un second dans [0, 0.3]. Le score temporel ne pouvait réordonner que des chunks à moins de 0.43 d'écart de logit : la pondération 0.7/0.3 était décorative, et c'est pourquoi le correctif de la date restait sans effet mesurable. Le seuil d'injection, lui, continue de porter sur le **logit brut** — c'est sur cette échelle qu'il a été calibré.

Le **4** a été validé à blanc sur les 123 sources avant écriture : 14 sources datées, 0 faux positif, et « Point 10/06/2026 » / « Point 08/07/2026 » retombent exactement sur leur `drive_modified_at`. Les 6 notes s'ordonnent enfin : 24/04 → 22/05 → 05/06 → 19/06 → 10/07 → **31/07**.

### Le 6 — la dernière étape aveugle au nom du fichier

Une fois les migrations `c` et `d` appliquées, la question qui avait déclenché l'enquête remontait « Notes point suivi tracking 31/07/2026 » au **rang 1** du pool reranké, contre l'absence totale avant. Mais avec un logit de **-4.83**, sous le seuil d'injection : rien n'était injecté, et le chat répondait « je ne trouve pas cette information ». Honnête, mais toujours inutile.

Premier réflexe : baisser le seuil. **Mauvaise piste, écartée par la mesure.** Distribution du logit du top-1 sur le testset :

| | n | min | médiane | max |
|---|---|---|---|---|
| cas `answer` | 17 | **-0.96** | +3.95 | +10.12 |
| cas `abstain` | 14 | -7.33 | **-1.23** | +6.74 |

Le seuil -1.0 / -2.0 tombe exactement sur la frontière entre les deux populations — il est empiriquement bien placé. Le descendre à -4 injecterait ≥ 1 chunk dans **12 des 14** cas d'abstention (8/14 dès -2, 13/14 à -6, 14/14 à -8), alors que l'abstention est mesurée à 14/14. Un flag `--inject-threshold` a été câblé dans `run_eval.py` et `main.py` pour que ce balayage soit rejouable, mais **la conclusion est de ne pas y toucher**.

La vraie cause : `_rerank_chunks` construisait ses paires en `(query, chunk_text)`. Le nom de la source était donc invisible au cross-encoder — la dernière étape à l'être, une fois l'embedding (préfixe d'`index_source`) et le FTS (migration `c`) alignés. Or la pertinence de ces notes ne vit pas dans leur corps, des puces techniques sans intitulé ni date, mais dans leur nom. Le cross-encoder classait légitimement la question parmi celles auxquelles s'abstenir de répondre. Correctif : la paire devient `(query, « nom [date]\n texte »)`, en miroir du préfixe d'indexation.

### Scorecard mesurée le 27/08/2026

Après les migrations `c` et `d`, backend encore sur l'ancien code Python, 31 cas :

| Métrique | Résultat |
|---|---|
| `source_recall` | **14/15** (93 %) |
| `abstention` | **14/14** (100 %) |
| `must_contain` | **9/10** (90 %) |

L'unique échec de `source_recall` est `az-projet-Pierre` : le document attendu (`[Aroma-Zone x Smart Bees] PDM WEB`) n'est pas dans le top-15 du pool — un défaut de rappel, pas de seuil. À traiter séparément.

Le testset compte **33 cas** depuis l'ajout de `az-dernier-point-tracking` et `az-point-tracking-19juin`. C'était la lacune qui avait laissé passer tout ça : aucun cas ne couvrait la classe « que s'est-il passé lors du dernier X », dont la réponse dépend d'une date qui n'existe que dans un nom de fichier.

### Le 5 annulé le jour même — ce que la mesure en production a montré

Déployé puis retiré dans l'heure. Normaliser le logit par sigmoid écrase tout le régime négatif vers zéro — `sigmoid(-9.6) ≈ 7 × 10⁻⁵` — donc le terme `0.7 × r` devient négligeable devant `0.3 × t` et **le classement se réduit à un tri par date de modification**. Relevé sur la question d'origine :

```
rerank=  -9.594  final=  0.290           [Aroma-Zone x Smart Bees] || Fichier de suivi projets
rerank=  -2.968  final=  0.156           Notes point suivi tracking 19/06/2026
rerank=  -3.055  final=  0.153           Notes point suivi tracking 31/07/2026
rerank=  -1.595  final=  0.130  INJECTÉ  Notes point suivi tracking 22/05/2026
```

Le chunk le moins pertinent du pool classé **premier**, au seul motif que son fichier avait été modifié la veille : `0.290 - 0.00005 = 0.29 → t = 0.967 = exp(-1/30)`.

Conclusion inverse de l'intuition de départ : **l'asymétrie d'échelle entre les deux termes est volontaire.** Un logit dans [-11, +11] face à un temporel dans [0, 1] fait du score temporel un départage entre chunks de pertinence comparable, et non un critère de classement. C'est le comportement voulu, et le commentaire dans `main.py` le dit désormais explicitement pour que personne ne « corrige » à nouveau cette asymétrie.

### Le 7 — « le dernier X » n'est pas une question de similarité

Le 6 a bien fonctionné : le logit du 31/07 est passé de -4.83 à -3.06. Insuffisant, le seuil étant à -2.0. Résultat, seule la note du 22/05 (-1.595) franchissait le seuil, et le chat affirmait « le dernier point de tracking, daté du 22/05/2026 » — la troisième plus ancienne. **Une abstention honnête s'était transformée en affirmation fausse assurée**, ce qui est un recul et non un progrès.

Le fond du problème : un cross-encoder note la proximité d'un texte à une question, il n'ordonne pas des documents entre eux. Aucun réglage de seuil ne lui fera répondre à « le dernier ». Le pipeline avait déjà le bon mécanisme pour ça — `_TEMPORAL_BROWSE_PATTERNS`, qui court-circuite la recherche pour « quoi de neuf » — mais limité à tout le Drive. Le 7 l'étend à une série identifiée par son sujet : parmi les sources dont le **nom** recoupe la question sur ≥ 2 mots et qui portent un `doc_date`, prendre la plus récente et lui garantir sa place dans le prompt indépendamment de son score.

Vérifié avant déploiement, sur les 33 cas : le 7 ne se déclenche que sur **1 cas**, `az-dernier-point-tracking`, et sélectionne bien `Notes point suivi tracking 31/07/2026`. **Aucun cas d'abstention ne le déclenche** — c'est ce qui compte, puisqu'il contourne le seuil qui protège l'abstention.

En complément, une règle de fiabilité ajoutée au prompt traite la cause directe de l'affirmation fausse : le modèle avait déduit « c'est le dernier » du seul fait qu'on lui avait fourni ce document. Les extraits sont désormais présentés comme une sélection et non un inventaire, avec interdiction explicite d'en inférer une position dans une série.

### Reste à faire

- **Migrations `c`, `d` et purge : appliquées le 27/08/2026.** Vérifié : 463 chunks / 13 sources datés, `fts` regénéré sur `source_name + chunk_text`, `match_chunks` renvoie `COALESCE(doc_date, …)`, plus aucune trace du « 29 juin » en base.
- **Repasser les 33 cas après le déploiement du 7 et de l'annulation du 5**, contre la référence du 27/08 (`source_recall` 14/15, abstention 14/14, `must_contain` 9/10). Le 7 ne touchant qu'un cas et aucun cas d'abstention, la scorecard ne devrait pas bouger ailleurs — c'est précisément ce qu'il faut confirmer.
- **`testset.json` est dans `.gitignore`** : les deux cas ajoutés le 27/08 (`az-dernier-point-tracking`, `az-point-tracking-19juin`) ne sont pas versionnés. La lacune qui a laissé passer tout cet enchaînement n'est donc pas colmatée pour un autre poste ou après un clone. À trancher : sortir le testset de l'ignore, ou versionner un jeu anonymisé.
- **`az-projet-Pierre`** — rappel insuffisant sur `PDM WEB`, hors top-15. Défaut distinct, non traité.
- **Décathlon et Ornikar n'ont aucun chunk indexé** — seul aroma-zone a du contenu. À lancer si ces espaces doivent servir.
- Le `README.md` décrivait un pipeline RAG antérieur au reranker, à HyDE et au score temporel — mis à jour en même temps.

### Leçon transférable

Un résumé généré par le modèle et réinjecté dans ses propres prompts n'est pas de la mémoire, c'est un canal de contamination : sans cadrage explicite, une erreur y devient un fait, puis se renforce à chaque tour. Tout texte produit par le modèle et réinjecté doit porter la marque de son origine.

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
