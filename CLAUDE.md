# CLAUDE.md — clientchat_v2

## Stack technique

- **Frontend** : HTML/CSS/JS vanilla — aucun framework, aucun bundler
- **Styles** : `styles.css` pur, variables CSS (`--tx`, `--sur`, `--brd2`…) pour le thème clair/sombre
- **Icônes** : Lucide (CDN) — appeler `lucide.createIcons()` après tout `innerHTML` contenant `<i data-lucide="...">`
- **Polices** : DM Sans + DM Mono (Google Fonts)
- **Base de données** : Supabase (PostgreSQL) — client JS `@supabase/supabase-js@2` via CDN
- **Backend** : Supabase Edge Functions (Deno) — point d'entrée unique `EDGE_URL = SB_URL + '/functions/v1/chat'`
- **IA** : Claude (Anthropic) appelé côté Edge Function, jamais directement depuis le front
- **Embeddings / RAG** : Supabase.ai gte-small (natif Edge Runtime) — 384 dims, gratuit, sans rate limit
- **Stockage documents** : Google Drive (export via Edge Function)
- **Déploiement** : GitHub Pages (push sur `main` → CI → `public/`) ; Netlify en fallback (`publish = "public"`)

## Architecture des fichiers

- `index.html` — structure HTML + chargement des scripts (ordre : `db.js` → `ui.js` → `app.js`)
- `db.js` — constantes globales, état global (`cur`, `tasks`, `session`…), Supabase, helpers utilitaires
- `ui.js` — rendu DOM (chat, todo, modals, sources, KB), logique d'envoi `send()`, prompts Claude
- `app.js` — initialisation (dark mode, sidebar, DnD tâches), raccourcis clavier, boot `window.load`
- `styles.css` — tout le CSS, variables de thème en `:root`
- `supabase/functions/chat/` — Edge Function (Deno) — ne pas modifier sans déployer via Supabase CLI
- `supabase/seed.sql` — schéma et données initiales

## Commandes

- **Lancer localement** : ouvrir `index.html` dans un navigateur (aucun serveur requis — pas de build)
- **Déployer** : `git push origin main` → GitHub Actions déploie automatiquement sur GitHub Pages
- **Edge Functions** : `supabase functions deploy chat` (nécessite Supabase CLI + accès projet)
- **Tests** : aucun framework de test — vérifier manuellement dans le navigateur

## Conventions de code

### Nommage
- **Fonctions** : `camelCase` — ex. `renderTodo`, `selectClient`, `makeDueBadge`
- **Constantes globales** : `SCREAMING_SNAKE_CASE` — ex. `EDGE_URL`, `EXPORTABLE_MIMETYPES`
- **Variables locales** : `camelCase` court — ex. `srcs`, `mems`, `sc`
- **IDs HTML** : `kebab-case` — ex. `todo-search`, `modal-settings`
- **Classes CSS** : `kebab-case` — ex. `task-clickable`, `msg-badge`

### Helpers globaux (définis dans `db.js`, utilisables partout)
- `$(id)` → `document.getElementById(id)`
- `esc(s)` → échappement HTML anti-XSS — **toujours utiliser pour afficher du contenu utilisateur**
- `show(id)` / `hide(id)` → toggle classe `hide`
- `openModal(id)` / `closeModal(id)` → toggle classe `open`
- `callEdge(payload)` → wrapper `fetch` vers l'Edge Function (throw si HTTP non-2xx)
- `setSyncDot(color, txt)` → indicateur de synchronisation dans la barre

### Formatage
- Indentation : **2 espaces**
- Accolades sur la même ligne : `function foo() {`
- Code dense accepté pour le rendu HTML inline (concaténation de strings)
- Pas de point-virgule oublié — style implicitement standard JS

### Gestion des erreurs
- Les appels Supabase sont toujours destructurés : `const {data, error} = await sb.from(…)`
- Les erreurs non bloquantes (Drive, cache) utilisent `console.warn` + `catch` silencieux
- Les erreurs bloquantes (auth, sauvegarde) remontent via `showErr(id, msg)`

### Sécurité XSS
- Tout contenu issu de la DB ou de l'utilisateur affiché dans `innerHTML` **doit passer par `esc()`**
- Utiliser `createElement` + `.value` / `.textContent` pour les inputs dynamiques (éviter `value="..."` dans l'HTML)

### Patterns à suivre
- Appels Edge Function : toujours via `callEdge({action: '...', ...})`, jamais `fetch(EDGE_URL, ...)` brut
- Icônes Lucide : `<i data-lucide="nom">` dans le HTML, puis `lucide.createIcons()` après injection
- Thème clair/sombre : utiliser les variables CSS `--tx`, `--sur`, `--brd2` — jamais de couleurs en dur
- Persistance légère : `localStorage` avec préfixe `cc-` (ex. `cc-dark`, `cc-sess`, `cc-todo-w`)
- Realtime Supabase : un seul canal actif par client (`rtChan`), toujours `removeChannel` avant d'en créer un nouveau

### Ce qu'il ne faut pas faire
- Ne pas définir `EXPORTABLE_MIMETYPES` localement — utiliser la constante module dans `db.js`
- Ne pas écrire dans `innerHTML` sans `esc()` sur les données externes
- Ne pas ajouter de listener `document.addEventListener('click', …)` par message — utiliser le handler partagé
- Ne pas appeler `lucide.createIcons()` sans avoir injecté les `<i data-lucide>` au préalable
