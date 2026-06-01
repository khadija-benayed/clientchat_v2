/**
 * src/App.jsx — Composant racine de l'application
 *
 * C'est le chef d'orchestre : il assemble tous les composants et hooks.
 * Pense-y comme la classe Main d'une application Java Spring :
 * elle configure tout et lance l'application.
 *
 * Responsabilités :
 * - Gérer le dark mode (data-theme sur <html>)
 * - Gérer le collapse de la sidebar
 * - Routage entre LoginScreen et l'app principale (selon auth)
 * - Orchestrer les modals (Settings, KB, Task, Calendar, Gmail prefs…)
 * - Raccourcis clavier globaux (⌘B, ⌘D, ⌘K, ⌘,…)
 * - Transmettre les mises à jour de tâches au hook useClients
 */
import { useState, useEffect, useCallback } from 'react';

// Hooks
import { useAuth } from './hooks/useAuth';
import { useClients } from './hooks/useClients';
import { useSync } from './hooks/useSync';

// Composants
import LoginScreen from './components/auth/LoginScreen';
import Sidebar from './components/layout/Sidebar';
import ClientHeader from './components/layout/ClientHeader';
import ChatPanel from './components/chat/ChatPanel';
import TaskPanel from './components/tasks/TaskPanel';
import ClientSettings from './components/settings/ClientSettings';
import { KbSaveModal, KbBrowser } from './components/knowledge/KnowledgeBase';

// Modals additionnels (Task, Calendar, Shortcuts, Gmail prefs, New client, Join)
import TaskModal from './components/tasks/TaskModal';
import CalendarModal from './components/tasks/CalendarModal';
import ShortcutsModal from './components/shared/ShortcutsModal';
import GmailPrefsModal from './components/shared/GmailPrefsModal';
import NewClientModal from './components/shared/NewClientModal';
import JoinClientModal from './components/shared/JoinClientModal';

import supabase from './lib/supabase';
import { callBackend } from './lib/backend';

export default function App() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { user, jwtToken, currentUserId, authReady, signInWithGoogle, logout } = useAuth();

  // ── Dark mode ─────────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('cc-dark');
    return saved !== null ? saved === '1' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('cc-dark', isDark ? '1' : '0');
  }, [isDark]);

  // ── Sidebar collapse ──────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('cc-sb-collapsed') === '1'
  );

  function toggleSidebar() {
    setSidebarCollapsed(prev => {
      localStorage.setItem('cc-sb-collapsed', !prev ? '1' : '0');
      return !prev;
    });
  }

  // ── Clients & tâches ──────────────────────────────────────────────────────
  const clientStore = useClients({ jwtToken, currentUserId });
  const {
    clients, setClients, currentClient, setCurrentClient,
    tasks, setTasks, summaries, docCache,
    syncStatus, setSyncStatus, syncProgress,
    selectClient, upsertTask, deleteTask, saveTaskOrder,
    getMembers, addSummary, loadClients,
  } = clientStore;

  // ── Sync ──────────────────────────────────────────────────────────────────
  const syncHook = useSync({ jwtToken });

  // ── État UI ───────────────────────────────────────────────────────────────
  const [activeFilter, setActiveFilter] = useState('all');
  const [highlightedIds, setHighlightedIds] = useState([]);
  const [chatSyncStatus, setChatSyncStatus] = useState({ color: '#52b788', label: 'synchronisé' });

  // Modals
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [kbSaveOpen, setKbSaveOpen]     = useState(false);
  const [kbSaveText, setKbSaveText]     = useState('');
  const [kbBrowserOpen, setKbBrowserOpen] = useState(false);
  const [taskModalId, setTaskModalId]   = useState(null);
  const [calOpen, setCalOpen]           = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [gmailPrefsOpen, setGmailPrefsOpen] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [joinClientOpen, setJoinClientOpen] = useState(false);

  // ── Raccourcis clavier ────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      const meta = e.metaKey || e.ctrlKey;
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (meta && e.key === 'b') { e.preventDefault(); toggleSidebar(); return; }
      if (meta && e.key === 'd') { e.preventDefault(); setIsDark(p => !p); return; }
      if (meta && e.key === 'k') { e.preventDefault(); document.getElementById('inp')?.focus(); return; }
      if (meta && e.key === 'j') { e.preventDefault(); document.getElementById('attach-btn')?.click(); return; }
      if (meta && e.key === ',') { e.preventDefault(); if (currentClient) setSettingsOpen(true); return; }
      if (meta && e.key === ']') { e.preventDefault(); navigateClient(1); return; }
      if (meta && e.key === '[') { e.preventDefault(); navigateClient(-1); return; }
      if (meta && e.key === 'f') {
        const s = document.getElementById('todo-search');
        if (s) { e.preventDefault(); s.focus(); s.select(); }
        return;
      }
      if (!inField && e.key === '?') { setShortcutsOpen(true); return; }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [currentClient, clients]); // eslint-disable-line

  function navigateClient(dir) {
    if (!clients.length) return;
    const idx = currentClient ? clients.findIndex(c => c.id === currentClient.id) : -1;
    const next = clients[(idx + dir + clients.length) % clients.length];
    if (next) handleSelectClient(next);
  }

  // ── Sélection client ──────────────────────────────────────────────────────
  const handleSelectClient = useCallback(async (client) => {
    setActiveFilter('all');
    setHighlightedIds([]);
    setSyncStatus({ color: '#EF9F27', label: 'chargement…' });
    await selectClient(client);
  }, [selectClient]); // eslint-disable-line

  function handleLeaveClient(e, clientId) {
    e.stopPropagation();
    setClients(prev => {
      const updated = prev.filter(c => c.id !== clientId);
      localStorage.setItem('cc-sess', JSON.stringify(updated));
      return updated;
    });
    if (currentClient?.id === clientId) {
      setCurrentClient(null);
      setTasks([]);
    }
  }

  // ── Mise à jour de tâches depuis le chat ──────────────────────────────────
  const handleTasksUpdate = useCallback(async (result) => {
    if (!result) return;
    const { tasks: newTasks, ops } = result;
    const toHighlight = [];

    setSyncStatus({ color: '#EF9F27', label: 'sauvegarde…' });
    try {
      // Upsert/delete via Supabase
      const ops_list = [];
      for (const u of (ops.updates || [])) {
        const t = newTasks.find(x => x.id === u.id);
        if (t) ops_list.push(upsertTask(t).then(() => toHighlight.push(t.id)));
      }
      for (const nt of (ops.new_tasks || [])) {
        const t = newTasks.find(x => x.title === nt.title && x.id < 0);
        if (t) ops_list.push(upsertTask(t).then(saved => { if (saved?.id > 0) toHighlight.push(saved.id); }));
      }
      for (const did of (ops.delete_ids || [])) ops_list.push(deleteTask(did));
      await Promise.all(ops_list);

      setTasks(newTasks);
      setHighlightedIds(toHighlight);
      setTimeout(() => setHighlightedIds([]), 2000);
    } finally {
      setSyncStatus({ color: '#52b788', label: 'synchronisé' });
    }
  }, [upsertTask, deleteTask]); // eslint-disable-line

  // ── Mise à jour locale du client (depuis settings) ────────────────────────
  const handleClientUpdate = useCallback((fields) => {
    setCurrentClient(prev => prev ? { ...prev, ...fields } : prev);
    setClients(prev => prev.map(c => currentClient?.id === c.id ? { ...c, ...fields } : c));
    // Persister localStorage
    const updated = { ...currentClient, ...fields };
    setClients(prev => {
      const next = prev.map(c => c.id === updated.id ? updated : c);
      localStorage.setItem('cc-sess', JSON.stringify(next));
      return next;
    });
  }, [currentClient]); // eslint-disable-line

  // ── Messages dans le chat depuis les syncs ────────────────────────────────
  const [chatMessages, setChatMessages] = useState(null); // piloté par ChatPanel

  function handleSyncMessage({ type, message }) {
    // On ne peut pas écrire dans ChatPanel directement depuis ici,
    // on passe par un state "pendingChatMsg" que ChatPanel consomme
    setPendingChatMsg({ type, message, id: Date.now() });
  }
  const [pendingChatMsg, setPendingChatMsg] = useState(null);

  // ── Membres du client courant ─────────────────────────────────────────────
  const members = getMembers(currentClient);

  // ── Render ────────────────────────────────────────────────────────────────

  // Attendre que l'auth soit déterminée avant d'afficher quoi que ce soit
  if (!authReady) return null;

  // Non connecté → Login
  if (!user) return <LoginScreen onSignIn={signInWithGoogle} />;

  return (
    <div className="app-layout">
      <Sidebar
        clients={clients}
        currentClient={currentClient}
        onSelectClient={handleSelectClient}
        onLeaveClient={handleLeaveClient}
        onNewClient={() => setNewClientOpen(true)}
        onJoinClient={() => setJoinClientOpen(true)}
        onOpenKb={() => setKbBrowserOpen(true)}
        onGmailPrefs={() => setGmailPrefsOpen(true)}
        onLogout={logout}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      <div className="main">
        {!currentClient ? (
          /* Écran vide — aucun client sélectionné */
          <div className="empty">
            <svg width="90" height="90" viewBox="0 0 100 100" fill="none"
              style={{ marginBottom: '12px', filter: 'drop-shadow(0 4px 6px rgba(25,54,68,.1))' }}>
              <path d="M46 20 L28 20 L10 50 L28 80 L46 80 Z" fill="var(--sb-orange)"/>
              <path d="M54 20 L72 20 L90 50 L72 80 L54 80 Z" fill="var(--sb-navy)"/>
            </svg>
            <div className="empty-t" style={{ color: 'var(--sb-navy)' }}>Bienvenue dans la Ruche</div>
            <div className="empty-s">Sélectionne un espace client pour commencer à butiner.</div>
          </div>
        ) : (
          /* Workspace client */
          <>
            <ClientHeader
              client={currentClient}
              syncColor={chatSyncStatus.color}
              syncLabel={chatSyncStatus.label}
              syncProgress={syncProgress}
              isDark={isDark}
              onToggleDark={() => setIsDark(p => !p)}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenShortcuts={() => setShortcutsOpen(true)}
            />
            <div className="workspace">
              <ChatPanel
                client={currentClient}
                tasks={tasks}
                summaries={summaries}
                docCache={docCache}
                jwtToken={jwtToken}
                onTasksUpdate={handleTasksUpdate}
                onSessionSave={summary => {
                  addSummary(summary);
                  // Afficher badge "Session sauvegardée"
                  showSessionSavedBadge();
                }}
                onOpenKbModal={text => { setKbSaveText(text); setKbSaveOpen(true); }}
                onSetSyncStatus={setChatSyncStatus}
                pendingChatMsg={pendingChatMsg}
                onPendingChatMsgConsumed={() => setPendingChatMsg(null)}
              />
              <TaskPanel
                tasks={tasks}
                members={members}
                activeFilter={activeFilter}
                onFilterChange={setActiveFilter}
                highlightedIds={highlightedIds}
                onTaskClick={id => setTaskModalId(id)}
                onTaskReorder={saveTaskOrder}
                onOpenCalendar={() => setCalOpen(true)}
              />
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      <ClientSettings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        client={currentClient}
        onClientUpdate={handleClientUpdate}
        onSyncMessage={handleSyncMessage}
        onDeleteClient={id => {
          setClients(prev => { const u = prev.filter(c => c.id !== id); localStorage.setItem('cc-sess', JSON.stringify(u)); return u; });
          setCurrentClient(null); setTasks([]);
        }}
        onOpenGmailPrefs={() => setGmailPrefsOpen(true)}
        syncHook={syncHook}
        jwtToken={jwtToken}
      />

      <KbSaveModal isOpen={kbSaveOpen} onClose={() => setKbSaveOpen(false)}
        initialText={kbSaveText} client={currentClient} jwtToken={jwtToken} />
      <KbBrowser isOpen={kbBrowserOpen} onClose={() => setKbBrowserOpen(false)} />

      {taskModalId != null && (
        <TaskModal
          taskId={taskModalId}
          tasks={tasks}
          members={members}
          onSave={async (updated) => {
            await upsertTask(updated);
            setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
          }}
          onDelete={async (id) => {
            await deleteTask(id);
            setTasks(prev => prev.filter(t => t.id !== id));
          }}
          onClose={() => setTaskModalId(null)}
        />
      )}

      {calOpen && (
        <CalendarModal tasks={tasks} onTaskClick={id => { setCalOpen(false); setTaskModalId(id); }}
          onClose={() => setCalOpen(false)} />
      )}

      <ShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <GmailPrefsModal isOpen={gmailPrefsOpen} onClose={() => setGmailPrefsOpen(false)}
        currentUserId={currentUserId} jwtToken={jwtToken} />

      <NewClientModal isOpen={newClientOpen} onClose={() => setNewClientOpen(false)}
        currentUserId={currentUserId}
        onCreated={client => {
          setClients(prev => { const u = [client, ...prev]; localStorage.setItem('cc-sess', JSON.stringify(u)); return u; });
          handleSelectClient(client);
        }} />

      <JoinClientModal isOpen={joinClientOpen} onClose={() => setJoinClientOpen(false)}
        existingIds={clients.map(c => c.id)}
        currentUserId={currentUserId}
        onJoined={client => {
          setClients(prev => { const u = [client, ...prev]; localStorage.setItem('cc-sess', JSON.stringify(u)); return u; });
          handleSelectClient(client);
        }} />
    </div>
  );
}

// Affiche un badge discret "Session sauvegardée ✓"
function showSessionSavedBadge() {
  const existing = document.querySelector('.session-saved-badge');
  if (existing) existing.remove();
  const badge = document.createElement('div');
  badge.className = 'session-saved-badge';
  badge.textContent = 'Session sauvegardée ✓';
  document.body.appendChild(badge);
  setTimeout(() => { badge.style.opacity = '0'; setTimeout(() => badge.remove(), 400); }, 3000);
}
