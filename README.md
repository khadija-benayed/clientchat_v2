# Client Chat — Smart Bees

Interface interne de l'agence Smart Bees pour la gestion de projets clients. Chaque client dispose d'un espace de travail partagé combinant un **chat IA contextuel**, une **to-do collaborative en temps réel**, un accès intelligent aux **documents Google Drive**, une **mémoire des sessions**, et une **base de savoir partagée** entre tous les comptes clients.

L'application est conçue pour des équipes sans accès à des APIs payantes avancées : elle fonctionne sans serveur propre, sans build step, et avec un coût marginal par usage.

---

## Table des matières

1. [Contexte & Objectif](#1-contexte--objectif)
2. [Stack Technique](#2-stack-technique)
3. [Architecture Générale](#3-architecture-générale)
4. [Structure des fichiers](#4-structure-des-fichiers)
5. [Fonctionnalités détaillées](#5-fonctionnalités-détaillées)
6. [Schéma de base de données](#6-schéma-de-base-de-données)
7. [Variables d'environnement & Secrets](#7-variables-denvironnement--secrets)
8. [Installation locale](#8-installation-locale)
9. [Déploiement](#9-déploiement)
10. [Contraintes & Workarounds](#10-contraintes--workarounds)
11. [Roadmap](#11-roadmap)

---

## 1. Contexte & Objectif

Smart Bees est une agence dont les équipes travaillent sur plusieurs comptes clients simultanément. Le problème récurrent : le contexte client se perd entre les sessions (réunions, Slack, mails, docs dispersés), ce qui force à se répéter à chaque fois qu'on pose une question à l'IA ou à un coéquipier.

**Client Chat résout ça en centralisant :**
- Les **tâches** du compte client avec statuts, priorités, assignés et deadlines
- Le **chat IA** qui connaît le client grâce aux documents Drive et aux résumés de sessions passées
- L'**historique des échanges** sous forme de résumés vectorisés et réinjectés automatiquement
- La **base de savoir agence** pour capitaliser sur les apprentissages cross-clients

**Qui l'utilise :** Les membres de l'équipe Smart Bees. Chaque compte client est un espace protégé par mot de passe, accessible depuis n'importe quel navigateur sans installation.

---

## 2. Stack Technique

| Couche | Technologie | Hébergement |
|--------|------------|-------------|
| **Frontend** | HTML / CSS / JavaScript vanilla (SPA) | GitHub Pages |
| **Backend** | Supabase Edge Functions (Deno / TypeScript) | Supabase |
| **Base de données** | PostgreSQL + Realtime | Supabase |
| **IA Chat** | Claude Sonnet (`claude-sonnet-4-6`) | API Anthropic |
| **IA Tâches** | Claude Haiku (`claude-haiku-4-5-20251001`) | API Anthropic |
| **Embeddings** | Voyage-3 (1024 dimensions) | API Voyage AI |
| **Documents** | Google Drive API (Service Account) | Google Cloud |
| **Icônes** | Lucide Icons (CDN) | jsDelivr |

**Pas de framework, pas de bundler.** Les fichiers HTML/CSS/JS sont servis directement depuis GitHub Pages. Aucun `npm install` requis pour faire tourner le frontend.

---

## 3. Architecture Générale

```
┌─────────────────────────────────────────────────────┐
│                  NAVIGATEUR (GitHub Pages)          │
│                                                     │
│  index.html  ←  styles.css                         │
│       │                                             │
│  app.js   ──  db.js   ──  ui.js                    │
│  (init)      (state/DB)   (rendu/logique UI)        │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP (fetch)
                       ▼
┌─────────────────────────────────────────────────────┐
│           SUPABASE EDGE FUNCTION  /chat             │
│                (Deno / TypeScript)                  │
│                                                     │
│  Actions : chat, summarize_session, index_source,  │
│  read_drive_folder, list_drive_metadata,            │
│  export_single_file, generate_brief, save_to_kb,   │
│  check_updates, delete_source_chunks               │
└──────┬───────────┬──────────────┬───────────────────┘
       │           │              │
       ▼           ▼              ▼
  Anthropic    Voyage AI    Google Drive API
  (Claude)    (Embeddings)  (Service Account)
       │                         │
       └──────────┬──────────────┘
                  ▼
┌─────────────────────────────────────────────────────┐
│              SUPABASE POSTGRESQL                    │
│                                                     │
│  clients  tasks  session_summaries                 │
│  document_chunks  usage_logs  embedding_logs        │
│  agency_knowledge                                   │
│                                                     │
│  + Realtime subscriptions (tâches sync)            │
│  + pgvector (recherche vectorielle)                │
└─────────────────────────────────────────────────────┘
```

**Flux d'un message utilisateur :**
1. L'utilisateur tape un message dans le chat
2. `ui.js` analyse l'intention : action sur une tâche → Haiku, question complexe → Sonnet
3. Un appel HTTP est fait à la Supabase Edge Function avec le message + contexte (L1/L2/L3)
4. L'Edge Function vectorise la requête via Voyage AI, cherche les chunks similaires en DB (RAG)
5. Claude génère une réponse avec les documents pertinents injectés
6. La réponse est parsée : texte affiché + éventuelles mutations JSON de tâches appliquées
7. Les tokens utilisés sont loggés dans `usage_logs`

---

## 4. Structure des fichiers

```
clientchat_v2/
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD : déploiement auto sur GitHub Pages
├── .claude/
│   └── settings.local.json     # Permissions Claude Code (dev only)
├── supabase/
│   ├── .temp/
│   │   └── linked-project.json # Référence projet Supabase (git-ignored)
│   └── functions/
│       └── chat/
│           └── index.ts        # Edge Function principale (Deno/TS, ~1200 lignes)
├── index.html                  # Page unique de l'application
├── app.js                      # Initialisation, raccourcis clavier, drag-and-drop
├── db.js                       # État global, client Supabase, auth, Drive sync
├── ui.js                       # Tout le rendu et la logique UI
├── styles.css                  # Système de design complet (dark/light mode)
├── netlify.toml                # Config legacy (remplacée par GitHub Pages)
└── README.md                   # Ce fichier
```

### `index.html`

L'unique page HTML de l'application. Elle contient :

- **`#login`** : Écran d'accueil avec deux onglets (Rejoindre / Créer un espace client). Formulaire de mot de passe, liste dynamique des membres de l'équipe, animations hexagonales de branding.
- **`#app`** : Application principale avec :
  - Une sidebar (liste des clients rejoints, navigation)
  - Un panneau chat (messages, input, badge de fichier joint)
  - Une liste de tâches (filtres, groupes par statut, drag-and-drop)
  - Des modales : paramètres/historique, raccourcis, éditeur de tâche, KB browser, sauvegarde KB, explorateur de sources Drive

Pas de build step. Les dépendances sont chargées depuis des CDN (`@supabase/supabase-js`, `lucide`, `DM Sans`).

---

### `app.js`

Point d'entrée de l'application. Responsibilities :

- **Raccourcis clavier globaux** (gérés via `keydown`) :
  - `Cmd+K` — Focus sur l'input chat
  - `Cmd+J` — Ouvre le sélecteur de fichier (pièce jointe)
  - `Cmd+B` — Collapse/expand la sidebar
  - `Cmd+D` — Bascule dark/light mode
  - `Cmd+,` — Ouvre les paramètres
  - `Cmd+[` / `Cmd+]` — Navigation entre les clients
  - `Ctrl+F` — Focus sur la recherche de tâches
  - `?` — Ouvre la modale des raccourcis

- **Dark mode** : Toggleable, persiste dans `localStorage`.

- **Drag-and-drop des tâches** : Réordonnancement manuel par glisser-déposer. L'ordre personnalisé est sauvegardé dans `localStorage` par client (clé `cc-task-order-{clientId}`).

- **Initialisation au chargement** : Restaure l'état UI (dark mode, sidebar), connecte le client Supabase, charge la liste des clients, entre directement dans l'app si une session `cc-sess` existe en `localStorage`.

---

### `db.js`

La couche données et l'état global de l'application.

**État global :**
```js
cur        // Objet client actif (id, name, members, context, drive_folder_id, _docCache)
tasks      // Tableau des tâches du client actif
session    // Tableau des espaces clients rejoints (persiste dans localStorage 'cc-sess')
activeF    // Filtre actif sur la liste de tâches
rtChan     // Canal Realtime Supabase (pour le sync des tâches)
selectedFile // Fichier joint en attente d'envoi (PDF/image)
```

**Authentification :**
- `hashPass(password)` — Hashage SHA-256 avec salt pour stocker les mots de passe
- `joinClient(name, pass)` — Authentifie sur un espace existant, ajoute à la session locale
- `createClient(name, pass, members)` — Crée un nouvel espace client avec liste de membres
- `logout()` — Vide la session et recharge la page

**Gestion des membres :**
Les membres sont stockés en JSON dans `clients.members` sous la forme `[{initials, name}]`. Les fonctions `addMemberRow()`, `getMembersFromList()` et `parseMembersStr()` gèrent l'UI dynamique d'ajout/suppression de membres.

**Pièces jointes :**
- `onFileSelected()` — Charge un PDF/JPG/PNG (max 20 Mo) en base64 pour l'envoyer avec le message
- `renderFileBadge()` / `clearFile()` — Affiche/masque le badge de fichier joint

**Synchronisation Google Drive (`checkDriveUpdates`) :**
Processus en 2 étapes déclenché à chaque ouverture d'un client :
1. **Appel léger** (`list_drive_metadata`) : récupère uniquement id, nom, type MIME et date de modification des fichiers Drive
2. **Comparaison** avec `document_chunks.last_indexed_at` en base
3. **Ré-export + ré-indexation** uniquement des fichiers modifiés (max 5 par run)
4. **Purge** des chunks orphelins (fichiers supprimés du Drive)

**Cache de documents L2 (`loadDocCache` / `refreshDocCache`) :**
Charge les 10 fichiers Drive les plus récents en texte brut dans `cur._docCache`. Ce cache est injecté directement dans le system prompt (contexte L2) à chaque message, contournant les limites de rate-limit du RAG.

La fonction `refreshDocCache()` est "smart" : elle réutilise les fichiers non modifiés depuis le `localStorage`, et ne ré-exporte que les fichiers dont la date a changé.

**Mémoire des sessions :**
- `saveSessionSummary()` — Déclenché au 3e, 5e, 10e, 20e échange, ou après 10 min d'inactivité. Extrait l'historique visible et appelle l'action `summarize_session` de l'Edge Function.
- `resetInactivityTimer()` — Remet à zéro le timer de 10 min à chaque message envoyé.

**Helpers :**
- `$()`, `show()`, `hide()` — Sélecteurs et utilitaires DOM
- `esc()` — Échappe le HTML
- `mStyle()` — Génère une couleur déterministe pour les avatars de membres
- `loadTasks()`, `upsertTask()`, `delTask()` — CRUD des tâches via Supabase

---

### `ui.js`

Le fichier le plus lourd (~76 KB). Il contient tout le rendu UI et la logique métier côté client.

#### Construction du contexte système (L1 / L2 / L3)

Le system prompt envoyé à Claude est constitué de trois couches :

- **L1** (`buildL1()`) — Contexte "opérationnel" : snapshot des tâches actuelles, liste des membres, schéma JSON pour les mutations de tâches (créer/modifier/supprimer), règles de matching des assignés
- **L2** (`buildL2()`) — Contexte "client" : brief auto-généré du client + 3 résumés de sessions récentes + 10 fichiers Drive récents injectés en texte brut. Ce cache couvre ~80% des cas sans appeler le RAG.
- **L3** (`buildL3()`) — Résumés de sessions plus anciens, injectés uniquement pour les requêtes complexes

#### Routage intelligent des messages (`send()`)

La fonction `send()` est le cœur de l'application :

1. **Détection d'intention** via `isTaskAction()`, `isClientQuestion()`, `isComplexQuery()` :
   - Action sur tâche → **Haiku** (rapide, moins cher)
   - Question sur le client → **Sonnet** (plus intelligent)
   - Requête complexe → Sonnet + L3

2. **Pipeline RAG** : Le message est vectorisé via Voyage AI, cherché dans `document_chunks` (similarité cosinus via pgvector), les 5 chunks les plus pertinents (> 0.55 de similarité) sont injectés dans le prompt.

3. **Appel Claude** via `callClaude()` → POST à l'Edge Function avec le system prompt L1+L2+[L3] + historique visible + message utilisateur + éventuel fichier joint

4. **Parsing de la réponse** : Claude peut répondre avec un séparateur `---JSON---` pour inclure des mutations de tâches. Le texte avant est affiché dans le chat, le JSON après est appliqué immédiatement sur le tableau des tâches.

5. **Affichage des sources** : `addSourcesBadge()` affiche quels fichiers Drive ou résumés de sessions ont informé la réponse.

6. **Compteur de session** : Incrémenté à chaque échange ; déclenche `saveSessionSummary()` aux paliers 3/5/10/20…

#### Gestion des tâches (`renderTodo()`)

- **Filtres** : Tous, Bloqué, En cours, En attente, Terminé, Par assigné, Cette semaine
- **Recherche live** sur titre / note / assigné
- **Groupement par statut** avec badges colorés
- **Informations affichées** : priorité (P1/P2/P3), assignés (avatars), deadline (⏳ bientôt, ⚠ dépassée, 📅 ok), blocker, note
- **Drag-and-drop** : Réordonnancement interactif, listeners réinitialisés à chaque rendu
- **`openTaskModal()`** : Éditeur complet d'une tâche (titre, statut, priorité, assignés, deadline, blocker, notes)
- **`snap()`** : Sérialise l'état courant des tâches en texte lisible pour l'injection dans L1

#### Base de savoir agence (`openKbBrowser()`, `addKbButton()`)

- Bouton "Ajouter à la KB" sur chaque message assistant
- Modal de sauvegarde : titre, contenu pré-rempli, tags, client source
- Navigateur de la KB : liste paginée de tous les insights, suppression possible
- Les insights sont stockés dans `agency_knowledge` et partagés entre tous les clients

#### Paramètres et historique (`openSettings()`)

Modal avec deux onglets :
- **Paramètres** : Modifier le nom du client, le mot de passe, les membres de l'équipe
- **Historique** : Affiche les 20 derniers résumés de sessions dans l'ordre chronologique

---

### `styles.css`

Système de design complet en CSS pur (pas de framework).

**Design tokens** (variables CSS) :
- Couleurs de marque Smart Bees : `--sb-navy`, `--sb-orange`, `--sb-coral`, `--sb-blue`
- Couleurs sémantiques : vert (done), bleu (info), ambre (warning), rouge (error), violet (neutral)
- Espacement, typographie, bordures, ombres

**Dark mode** : Implémenté via le sélecteur `[data-theme="dark"]` sur le `<body>`. Inversion complète de la palette sans JavaScript supplémentaire.

**Composants stylisés** :
- Écran de login (animations hexagonales, onglets, formulaires)
- Sidebar (état réduit, avatars clients, boutons d'action)
- Panneau chat (bulles de messages, animation "thinking", badge fichier)
- Liste de tâches (groupes, pills de statut, badges priorité, avatars, états drag-over)
- Modales (paramètres, KB browser, éditeur de tâche, explorateur de fichiers)
- Boutons (primary, ghost, destructive)

---

### `supabase/functions/chat/index.ts`

L'unique Edge Function Deno (~1200 lignes). Elle est le backend de toute l'application et expose plusieurs **actions** dans un seul endpoint via le champ `action` du body JSON.

#### Actions disponibles

| Action | Description |
|--------|-------------|
| `chat` | Message principal → Claude Sonnet ou Haiku + RAG + logging |
| `summarize_session` | Résume l'historique de chat → sauvegarde + vectorise |
| `read_drive_folder` | Liste et exporte tous les fichiers d'un dossier Drive |
| `list_drive_metadata` | Métadonnées légères (id, nom, type, modifiedTime) sans contenu |
| `export_single_file` | Export d'un fichier Drive par ID |
| `generate_brief` | Génère le brief client structuré (JSON) à partir des docs |
| `index_source` | Pipeline complet d'indexation vectorielle d'un document |
| `check_updates` | Ré-indexe uniquement les fichiers Drive modifiés |
| `delete_source_chunks` | Supprime les chunks d'une source de la DB |
| `save_to_kb` | Sauvegarde un insight dans `agency_knowledge` |

#### Détails des actions clés

**`chat`** :
- Détermine le modèle selon `message_type` (task_action → Haiku, sinon Sonnet)
- Vectorise le message via Voyage AI et cherche les chunks similaires (pgvector RPC `match_chunks`)
- Injecte les 5 chunks les plus pertinents (seuil 0.55) dans le system prompt
- Supporte les fichiers joints (PDF en `document`, images en `image`)
- Retourne la réponse + `sources_used`
- Logge les tokens et le coût dans `usage_logs` (non-bloquant)

**`summarize_session`** :
- Appelle Claude Sonnet pour résumer l'historique de chat en points-clés
- Sauvegarde le résumé dans `session_summaries`
- Vectorise le résumé via Voyage AI et le stocke dans `document_chunks` (source_type = 'session') → devient cherchable via RAG

**`index_source`** :
- Reçoit un document (texte, CSV ou PDF en base64)
- **Extraction PDF** : Envoie le base64 à Claude Sonnet avec type `document` pour extraire le texte
- **Chunking** : Texte → chunks de 2000 chars avec overlap de 200 chars. CSV → blocs de 15 lignes avec header répété
- **Vectorisation** : Batches de 128 chunks via Voyage AI avec retry sur 429
- **Déduplication** : Supprime les anciens chunks pour le même `source_id` avant réinsertion
- **Stockage** : Insère les chunks avec embeddings dans `document_chunks`

**`read_drive_folder`** :
- Authentifie via un Service Account Google (JWT custom, sans librairie externe)
- Parcours récursif du dossier avec pagination
- Exporte Docs, Sheets, Présentations en texte (limité à 50k chars/fichier)
- Trie par type puis par date de modification

**`generate_brief`** :
- Prend un tableau de contenus de documents
- Prompt Claude Sonnet (~96k chars max) pour générer un JSON structuré : secteur, enjeux, KPIs, équipe, historique, notes
- Sauvegarde dans `clients.context`

**Utilitaires internes** :
- `importPrivateKey()`, `makeGoogleJWT()`, `getGoogleAccessToken()` — Auth Service Account sans dépendances externes
- `chunkText()`, `chunkCSV()` — Découpage intelligent des documents
- `embedChunks()`, `embedQuery()` — Intégration Voyage AI avec retry sur 429
- `calculateCost()` — Estimation du coût par modèle (Sonnet: $0.003/$0.015 per 1K tokens, Haiku: $0.00025/$0.00125)

---

## 5. Fonctionnalités détaillées

### Espaces clients

Chaque "client" est un espace isolé protégé par mot de passe. Un utilisateur peut rejoindre plusieurs clients et switcher entre eux depuis la sidebar. La session est persistée dans `localStorage` sous la clé `cc-sess`.

**Création** : Nom + mot de passe + membres de l'équipe (initiales + nom). Les membres permettent l'assignation des tâches et la génération d'avatars colorés.

**Connexion** : Le mot de passe est hashé côté client (SHA-256 + salt) avant comparaison avec la DB. Aucun token JWT n'est émis — l'accès est mémorisé localement.

---

### Chat IA

Le chat utilise **deux modèles Claude** selon l'intention détectée :

- **Haiku** pour les actions rapides sur les tâches (créer, modifier, assigner, marquer comme fait). Moins cher, latence plus faible.
- **Sonnet** pour les questions sur le client, les analyses, les résumés. Plus intelligent, accès complet au contexte.

Le contexte injecté est composé de :
1. **L1** — Tâches actuelles + membres + schéma JSON de mutation
2. **L2** — Brief client + 3 derniers résumés de session + 10 derniers documents Drive en texte
3. **L3** (optionnel) — Résumés de sessions plus anciens

Le système peut aussi recevoir des **pièces jointes** (PDF, JPG, PNG jusqu'à 20 Mo) envoyées directement dans le message.

---

### Gestion des tâches

| Champ | Valeurs |
|-------|---------|
| Statut | `todo` / `inprogress` / `blocked` / `waiting` / `done` |
| Priorité | `P1` / `P2` / `P3` |
| Assignés | Multi-valeur (séparé par `+` ou virgule), affiché en avatars |
| Deadline | Date ISO, affichée avec indicateurs visuels |
| Blocker | Texte libre décrivant ce qui bloque |
| Note | Texte libre |

Les tâches se **synchronisent en temps réel** via Supabase Realtime : un changement fait sur un client est immédiatement visible pour les autres membres connectés.

L'**ordre d'affichage** est géré par drag-and-drop et persiste par client dans `localStorage`.

**Mutations par IA** : Claude peut créer, modifier et supprimer des tâches en répondant avec un bloc JSON après `---JSON---`. Ce bloc est parsé et appliqué immédiatement, puis synchronisé en DB.

---

### Google Drive

**Prérequis** : Un Service Account Google doit avoir accès au dossier Drive du client. L'ID du dossier est configuré dans les paramètres du client.

**Synchronisation** (déclenchée à l'ouverture d'un client) :
1. Récupère les métadonnées de tous les fichiers du dossier
2. Compare avec les timestamps `last_indexed_at` en DB
3. Ré-indexe uniquement les fichiers modifiés (max 5 par run pour éviter les timeouts)
4. Purge les chunks des fichiers supprimés du Drive

**Types de fichiers supportés** : Google Docs (exporté en texte), Google Sheets (exporté en texte), Google Slides (exporté en texte), PDF (extraction via Claude), JPEG/PNG (vision Claude)

**Injection en contexte** : Les 10 fichiers les plus récents sont injectés directement en texte dans le system prompt L2, indépendamment du RAG.

---

### Mémoire des sessions (CC-102)

L'application garde une mémoire persistante des échanges sous forme de résumés :

- **Déclenchement automatique** : 3e, 5e, 10e, 20e échange (et paliers suivants de 10 en 10), ou après 10 min d'inactivité
- **Résumé** : L'historique visible est envoyé à Claude Sonnet qui génère un résumé en points-clés
- **Stockage** : Sauvegardé dans `session_summaries` ET vectorisé dans `document_chunks` (source_type = 'session')
- **Réinjection** : Les 3-5 résumés les plus récents sont automatiquement inclus dans L2 à la session suivante
- **Recherche** : Les résumés plus anciens sont accessibles via RAG si une question les concerne
- **Visibilité** : Historique consultable dans l'onglet "Historique" des paramètres du client

---

### RAG (Retrieval-Augmented Generation)

Pipeline de recherche vectorielle sur les documents indexés :

1. La requête utilisateur est vectorisée via Voyage AI (`voyage-3`, 1024 dimensions)
2. Recherche cosinus dans `document_chunks` via la fonction RPC PostgreSQL `match_chunks()`
3. Les 5 chunks les plus similaires (seuil ≥ 0.55) sont injectés dans le prompt
4. Un badge "Sources utilisées" s'affiche dans l'interface avec les fichiers cités
5. Si aucun chunk pertinent : instruction à Claude de ne pas inventer et d'indiquer l'absence d'info

**Fallback** : Si le RAG ne trouve rien (ou en cas d'erreur), le cache L2 (10 docs en texte) prend le relais, couvrant ~80% des cas d'usage.

---

### Base de savoir agence (Agency KB — CC-213)

Espace partagé entre tous les clients pour capitaliser sur les apprentissages de l'agence.

- **Sauvegarde manuelle** : Bouton "Ajouter à la KB" sur chaque réponse de l'IA
- **Champs** : Titre, contenu, tags, client source, auteur
- **Navigateur** : Modal accessible depuis la sidebar listant tous les insights enregistrés
- **Partage** : Les insights sont visibles sur tous les espaces clients

---

## 6. Schéma de base de données

```sql
-- Espaces clients
CREATE TABLE clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  password_hash   text NOT NULL,
  members         text,                    -- JSON: [{initials, name}]
  context         jsonb,                   -- Brief auto-généré
  drive_folder_id text,                    -- ID du dossier Google Drive
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Tâches
CREATE TABLE tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid REFERENCES clients(id) ON DELETE CASCADE,
  title       text NOT NULL,
  prio        text DEFAULT 'P2',           -- P1 | P2 | P3
  status      text DEFAULT 'todo',         -- todo | inprogress | blocked | waiting | done
  assignee    text,                        -- Initiales séparées par +
  blocker     text,
  note        text,
  due_date    date,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Résumés de sessions (CC-102)
CREATE TABLE session_summaries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid REFERENCES clients(id) ON DELETE CASCADE,
  summary_text text NOT NULL,
  created_at   timestamptz DEFAULT now()
);

-- Chunks vectorisés (RAG)
CREATE TABLE document_chunks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid REFERENCES clients(id) ON DELETE CASCADE,
  source_type      text,                   -- doc | sheet | pdf | session
  source_name      text,
  source_id        text,                   -- ID Google Drive (stable)
  chunk_text       text,
  embedding        vector(1024),           -- Voyage-3 embeddings
  last_indexed_at  timestamptz DEFAULT now()
);

-- Suivi des coûts API (CC-211)
CREATE TABLE usage_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES clients(id) ON DELETE SET NULL,
  model         text NOT NULL,
  message_type  text NOT NULL,
  tokens_input  int,
  tokens_output int,
  cost_usd      numeric(10,6),
  created_at    timestamptz DEFAULT now()
);

-- Logs d'indexation
CREATE TABLE embedding_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid REFERENCES clients(id) ON DELETE CASCADE,
  source_name      text,
  chunks_count     int,
  tokens_estimated int,
  created_at       timestamptz DEFAULT now()
);

-- Base de savoir agence (CC-213)
CREATE TABLE agency_knowledge (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  content       text NOT NULL,
  source_client text,
  tags          text[],
  saved_by      text,
  created_at    timestamptz DEFAULT now()
);

-- Fonction RPC : recherche vectorielle
CREATE FUNCTION match_chunks(
  query_embedding vector(1024),
  match_threshold float,
  match_count     int,
  filter_client   uuid
)
RETURNS TABLE (
  id          uuid,
  chunk_text  text,
  source_name text,
  source_type text,
  similarity  float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT dc.id, dc.chunk_text, dc.source_name, dc.source_type,
         1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE dc.client_id = filter_client
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
```

---

## 7. Variables d'environnement & Secrets

### Secrets Supabase (Edge Function)

Configurés dans le dashboard Supabase → Settings → Edge Functions :

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_KEY` | Clé API Anthropic (Claude) |
| `VOYAGE_API_KEY` | Clé API Voyage AI (embeddings) |
| `GOOGLE_SA_KEY` | JSON complet du Service Account Google |
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role (accès admin DB) |

### Variables frontend (hardcodées dans `db.js`)

Le frontend est public (GitHub Pages), les valeurs suivantes sont donc des clés **publiques** par nature :

```js
const SB_URL  = "https://[PROJECT_ID].supabase.co";
const SB_KEY  = "[SUPABASE_ANON_KEY]";          // Clé publique, protégée par RLS
const EDGE_URL = `${SB_URL}/functions/v1/chat`;
```

> La sécurité des données repose sur les **Row Level Security (RLS)** de Supabase et le hashage des mots de passe, pas sur la confidentialité de la clé anon.

---

## 8. Installation locale

### Prérequis

- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- Un projet Supabase existant avec le schéma ci-dessus
- Python 3 (ou tout autre serveur HTTP statique)

### Étapes

```bash
# 1. Cloner le repo
git clone https://github.com/[ORG]/clientchat_v2.git
cd clientchat_v2

# 2. Lier au projet Supabase
supabase link --project-ref [PROJECT_ID]

# 3. Configurer les variables frontend
# Éditer db.js : remplacer SB_URL et SB_KEY par les valeurs de votre projet

# 4. Déployer l'Edge Function en local (optionnel)
supabase functions serve chat --env-file .env.local

# 5. Servir le frontend
python3 -m http.server 8000
# Ouvrir http://localhost:8000
```

**Fichier `.env.local`** (pour le dev de l'Edge Function, ne pas committer) :
```env
ANTHROPIC_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
GOOGLE_SA_KEY={"type":"service_account",...}
SUPABASE_URL=https://[PROJECT_ID].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

## 9. Déploiement

### Frontend — GitHub Pages

Le workflow `.github/workflows/deploy.yml` se déclenche automatiquement à chaque push sur `main`. Il copie les fichiers statiques dans `public/` et les publie sur GitHub Pages.

```yaml
# Résumé du workflow
on: push (main)
steps:
  - Checkout
  - Copy HTML/CSS/JS to public/
  - Deploy to GitHub Pages
```

> Netlify a été remplacé par GitHub Pages pour corriger des erreurs 403 sur les Edge Functions.

### Backend — Supabase Edge Function

```bash
# Déploiement de l'Edge Function
supabase functions deploy chat --project-ref [PROJECT_ID]

# Vérifier les secrets configurés
supabase secrets list --project-ref [PROJECT_ID]

# Configurer un secret manquant
supabase secrets set ANTHROPIC_KEY=sk-ant-... --project-ref [PROJECT_ID]
```

### Base de données

Le schéma est géré manuellement via le dashboard Supabase ou via des migrations SQL. Il n'y a pas de système de migrations automatisé dans ce repo.

---

## 10. Contraintes & Workarounds

### Le "Problème Voyage AI"

**Constat** : Le Free Tier de Voyage AI limite à **3 requêtes/minute** et 10K tokens/minute. Il est impossible d'indexer un dossier Drive complet (ex: 98 fichiers) sans déclencher des erreurs 429, même avec une file d'attente et des délais.

**Solution temporaire — Cache L2** :
1. Le brief client auto-généré fournit le contexte global
2. Au chargement de chaque client, les 10 fichiers Drive les plus récents sont exportés et injectés en texte brut dans le system prompt
3. Résultat : l'IA dispose des documents "chauds" immédiatement, couvrant ~80% des cas sans RAG

Le RAG complet reste actif pour la recherche dans les sessions passées et les fichiers indexés lors des runs précédents. Seule l'indexation initiale d'un gros Drive est lente.

### Limitations connues

| Limitation | Impact | Contournement |
|-----------|--------|---------------|
| Voyage AI 3 req/min | Indexation lente des gros Drives | Cache L2 (10 docs en texte) |
| Edge Functions timeout ~50s | Max 5 fichiers Drive ré-indexés par run | Re-runs automatiques au prochain chargement |
| Export Drive limité à 50k chars/fichier | Gros documents tronqués | Découpage par chunks avec overlap |
| Extraction PDF via Claude | Coûte des tokens à chaque ré-indexation | Déduplication par `source_id` stable |
| Clés frontend hardcodées | Visibles dans le code source | Clé anon publique + RLS Supabase |

---

## 11. Roadmap

### NEXT — Optimisations (sans coût supplémentaire)

- **Fix Sync Reliability** : Stabiliser la synchronisation Drive en arrière-plan (gestion des timeouts et des retries sur les gros dossiers)
- **Sync Progress UX** : Afficher un compteur persistant dans l'UI ("X/98 indexés") qui survit entre les sessions et donne de la visibilité sur l'avancement de l'indexation
- **Notion Source** : Préparer le pipeline d'export pour l'API Notion (stub architecture, même pattern que Drive)

### LATER — Déblocage APIs payantes

- **Migration OpenAI Embeddings** : Passer sur `text-embedding-3-small` (~$0.02/1M tokens) pour lever les rate-limits et permettre l'indexation instantanée de gros Drives
- **Full RAG** : Avec des embeddings sans limite, indexation complète en < 2 min et recherche sémantique sur l'intégralité des documents clients
- **Agency KB auto-populée** : Détecter automatiquement les patterns cross-clients et enrichir la base de savoir sans intervention manuelle
- **Cross-client search** : Permettre d'interroger la base globale ("Comment a-t-on géré cette situation pour un autre client ?")
