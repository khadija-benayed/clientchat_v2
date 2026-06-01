# MIGRATION_NOTES.md — Passage de vanilla JS à React/Vite

## Pour qui ce document ?

Ce document s'adresse à quelqu'un qui connaît Java/SQL mais qui découvre React.
Il explique les décisions prises, les analogies Java/React, et comment lire le code.

---

## Pourquoi cette migration ?

| Problème (avant) | Solution (après) |
|---|---|
| `ui.js` = 1900 lignes, tout mélangé | ~20 composants, 1 responsabilité chacun |
| Variables globales `cur`, `tasks`, `session`… | State React local + hooks spécialisés |
| `innerHTML` avec `esc()` partout | JSX sécurisé par défaut (React échappe automatiquement) |
| `localStorage` pour le cache docs | State React en mémoire (hooks) |
| `document.getElementById` partout | Références React (`useRef`) ou state |

---

## Analogies Java → React

### Composant React ≈ classe avec affichage

```jsx
// En Java :
public class TaskCard {
    private Task task;
    public String render() { return "<div>" + task.title + "</div>"; }
}

// En React :
function TaskCard({ task }) {
    return <div>{task.title}</div>;
}
```

### `useState` ≈ champ observable

```jsx
// En Java (simplifié) : un champ qui notifie ses observers
private ObservableValue<String> text = new SimpleStringProperty();

// En React :
const [text, setText] = useState('');
// setText('nouveau') déclenche automatiquement un re-rendu
```

### `useEffect` ≈ @PostConstruct + finalize

```jsx
useEffect(() => {
    // Code exécuté après le rendu (= @PostConstruct)
    loadData();
    return () => {
        // Code de nettoyage (= finalize / AutoCloseable.close())
        subscription.unsubscribe();
    };
}, [dep1, dep2]); // Re-exécuté si dep1 ou dep2 changent
```

### `useCallback` ≈ mémoïsation

Évite de recréer une fonction à chaque rendu.  
Inutile la plupart du temps — ne l'utilise que si une fonction est passée en prop à un enfant.

### Hook personnalisé ≈ classe Service

```jsx
// En Java :
@Service
public class ClientService {
    public List<Client> getClients() { ... }
    public void selectClient(Client c) { ... }
}

// En React :
function useClients() {
    const [clients, setClients] = useState([]);
    function selectClient(c) { ... }
    return { clients, selectClient };
}
```

---

## Architecture des fichiers

```
src/
  main.jsx          Point d'entrée (= main() Java)
  App.jsx           Composant racine — orchestre tout
  index.css         Variables CSS + Tailwind + styles globaux

  lib/
    constants.js    BACKEND_URL, SB_URL, SB_KEY, helpers utilitaires
    supabase.js     Client Supabase singleton
    backend.js      callBackend(), openBackendSSE() — couche réseau

  hooks/
    useAuth.js      Auth Supabase (SIGNED_IN, TOKEN_REFRESHED…)
    useClients.js   Liste clients, sélection, tâches, Drive, Realtime
    useChat.js      Messages, send(), L1/L2/L3 prompts, task updates
    useSync.js      SSE streaming Drive sync + Email sync

  components/
    auth/           LoginScreen (animation canvas + bee + flower)
    layout/         Sidebar, ClientHeader
    chat/           ChatPanel, MessageList, MessageBubble, ChatInput
    tasks/          TaskPanel, TaskBoard, TaskCard, TaskFilters, TaskModal, CalendarModal
    settings/       ClientSettings, MembersSection, DriveSection, EmailSection
    knowledge/      KbSaveModal, KbBrowser
    shared/         Modal, SyncStatus, ShortcutsModal, GmailPrefsModal,
                    NewClientModal, JoinClientModal
```

---

## Flux de données (sens unique, comme Redux)

```
App.jsx (state global)
  ├── useAuth      → user, jwtToken
  ├── useClients   → clients, currentClient, tasks
  ├── useSync      → syncDrive(), syncEmails()
  └── passe tout ça en props aux composants enfants

ChatPanel
  └── useChat (reçoit client, tasks en paramètres)
         └── sendMessage() appelle callBackend()
                └── onTasksUpdate() remonte les modifications à App.jsx
```

Le state ne descend jamais vers le haut directement — il remonte via des callbacks (`onXxx`).

---

## Décisions techniques

### CSS hybride (Tailwind + variables CSS)

Le projet utilise une approche hybride :
- **Variables CSS** (`--tx`, `--sur`, `--brd2`…) pour les couleurs et le thème sombre/clair.
  Ces variables sont définies dans `src/index.css` et sont utilisées dans toutes les classes CSS existantes.
- **Tailwind** pour les utilitaires de layout (`flex`, `gap-2`, etc.) dans les nouveaux composants.
- **Classes CSS nommées** (`.modal`, `.btn`, `.task`…) conservées telles quelles pour
  garantir zéro régression visuelle.

**Pourquoi pas Tailwind pur ?**  
Migrer 963 lignes de CSS finement réglé vers des utilitaires Tailwind aurait causé des régressions
visuelles. L'approche hybride est plus sûre pendant la transition.

### Pas de Redux / Zustand

L'app n'est pas assez complexe pour justifier une librairie de state management globale.
Le state est géré au niveau `App.jsx` et distribué via les props. Si l'app grandit,
Zustand est une migration simple (1-2h).

### Pas de React Router

L'app est "single-page" avec des modals — pas besoin de routing d'URL.

### HTML5 Drag & Drop natif

Pas de `@dnd-kit` ou `react-beautiful-dnd`. Le DnD des tâches est implémenté avec
les événements HTML5 natifs (`draggable`, `onDragStart`, `onDrop`…) dans `TaskBoard.jsx`.
Avantage : zéro dépendance supplémentaire, comportement identique à l'original.

### SSE (Server-Sent Events) non changé

Le pattern SSE (stream de progression pour sync Drive et emails) est identique à
l'original — `fetch()` → `getReader()` → boucle de lecture. React ne change rien
à ça ; c'est dans `useSync.js`.

---

## Fichiers conservés pour référence

Les anciens fichiers vanilla JS ont été renommés en `.old` :
- `app.js.old` — initialisation, dark mode, animations, DnD
- `db.js.old` — state global, Supabase, helpers
- `ui.js.old` — rendu DOM, chat, todo, modals
- `styles.css.old` — CSS original complet

Ces fichiers ne sont **pas** utilisés en production. Ils servent de référence
pendant la période de transition.

---

## Lancer en local

```bash
# Installer les dépendances
npm install

# Démarrer le serveur de développement
npm run dev
# → http://localhost:5173/clientchat_v2/

# Builder pour la production
npm run build

# Déployer sur GitHub Pages (branche main → CI)
git push origin main
```

---

## Contribuer

1. Toujours travailler sur une branche feature (jamais directement sur `main`)
2. Un composant = un fichier dans le bon dossier
3. Commenter en français : "pourquoi" plutôt que "quoi"
4. Pas de `any` TypeScript (le projet est en JS) — mais typer les props dans les commentaires JSDoc
5. Tester visuellement dans le navigateur avant de merger
