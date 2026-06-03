/**
 * src/hooks/useClients.js — Gestion des clients et des tâches
 *
 * Ce hook est le "gestionnaire de données principal" de l'application.
 * Il remplace les variables globales de db.js : session, cur, tasks, rtChan.
 *
 * Responsabilités :
 * - Charger la liste des clients depuis /me (backend)
 * - Gérer le client actuellement sélectionné
 * - Charger et modifier les tâches (CRUD)
 * - S'abonner au Realtime Supabase pour les tâches
 * - Vérifier et indexer les mises à jour Drive au changement de client
 * - Charger le cache de documents Drive
 *
 * Concept React : useState stocke des données qui, quand elles changent,
 * déclenchent un re-rendu du composant. C'est l'équivalent d'un champ
 * Observable en Java/Kotlin avec MVVM.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import supabase from '../lib/supabase';
import { callBackend } from '../lib/backend';
import { EXPORTABLE_MIMETYPES } from '../lib/constants';

/**
 * @param {object} params
 * @param {string|null} params.jwtToken      - JWT de la session courante
 * @param {string|null} params.currentUserId - UUID de l'utilisateur connecté
 */
export function useClients({ jwtToken, currentUserId }) {
  // Liste des espaces clients accessibles à cet utilisateur
  const [clients, setClients] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cc-sess') || '[]'); } catch { return []; }
  });

  // Client actuellement ouvert (objet complet depuis Supabase)
  const [currentClient, setCurrentClient] = useState(null);

  // Tâches du client courant
  const [tasks, setTasks] = useState([]);

  // Résumés de sessions précédentes (pour le contexte IA)
  const [summaries, setSummaries] = useState([]);

  // Cache des documents Drive indexés (pour le prompt L2)
  const [docCache, setDocCache] = useState([]);

  // Indicateur de synchronisation Drive
  const [syncStatus, setSyncStatus] = useState({ color: '#52b788', label: 'synchronisé' });
  const [syncProgress, setSyncProgress] = useState(null); // { done, total } ou null

  // Fichiers Drive détectés comme nouveaux/modifiés depuis la dernière sync
  const [driveOutdated, setDriveOutdated] = useState(null); // { count, newCount, modifiedCount } ou null

  // Référence au canal Realtime Supabase (pas dans le state car pas besoin de re-rendu)
  const rtChanRef = useRef(null);
  const indexingRef = useRef(false);

  // ── Chargement initial des clients depuis le backend ─────────────────────
  const loadClients = useCallback(async () => {
    if (!jwtToken) return;
    try {
      const data = await callBackend({ action: 'me' }, jwtToken);
      if (data.error) return;
      const clientList = data.clients || [];
      if (clientList.length) {
        setClients(clientList);
        localStorage.setItem('cc-sess', JSON.stringify(clientList));
      }
    } catch (e) {
      console.warn('loadClients error:', e.message);
    }
  }, [jwtToken]);

  useEffect(() => {
    if (jwtToken) loadClients();
  }, [jwtToken, loadClients]);

  // ── Sélection d'un client ─────────────────────────────────────────────────
  const selectClient = useCallback(async (client) => {
    // Recharger les données fraîches depuis Supabase (nom, context, sources…)
    const { data } = await supabase.from('clients').select('*').eq('id', client.id).single();
    const freshClient = data || client;
    setCurrentClient(freshClient);

    // Mettre à jour la liste locale + localStorage
    setClients(prev => {
      const updated = [freshClient, ...prev.filter(c => c.id !== freshClient.id)];
      localStorage.setItem('cc-sess', JSON.stringify(updated));
      return updated;
    });

    // Réinitialiser le state chat/tâches pour ce nouveau client
    setTasks([]);
    setSummaries([]);
    setDocCache([]);

    setSyncStatus({ color: '#EF9F27', label: 'chargement…' });

    // Charger tâches + résumés en parallèle
    const [_, prevSummaries] = await Promise.all([
      loadTasksForClient(freshClient.id),
      loadSummaries(freshClient.id),
    ]);
    setSummaries(prevSummaries);

    // Souscrire au Realtime pour les tâches
    subscribeRealtime(freshClient.id);

    // Vérifier silencieusement si des fichiers Drive ont changé (pas d'indexation)
    setDriveOutdated(null);
    checkDriveOutdated(freshClient).then(() => loadDocCache(freshClient));

  }, [jwtToken]); // eslint-disable-line

  // ── Tâches ────────────────────────────────────────────────────────────────

  const loadTasksForClient = useCallback(async (clientId) => {
    const { data } = await supabase.from('tasks').select('*')
      .eq('client_id', clientId).order('id');
    const loaded = data || [];
    // Appliquer l'ordre sauvegardé (drag & drop)
    setTasks(applyTaskOrder(loaded, clientId));
    setSyncStatus({ color: '#52b788', label: 'synchronisé' });
    return loaded;
  }, []);

  const upsertTask = useCallback(async (task) => {
    if (task.id && task.id > 0) {
      await supabase.from('tasks').update({
        title: task.title, prio: task.prio, status: task.status,
        assignee: task.assignee, blocker: task.blocker, note: task.note,
        due_date: task.due_date || null,
        updated_at: new Date().toISOString(),
      }).eq('id', task.id);
    } else {
      const { data } = await supabase.from('tasks').insert({
        client_id: currentClient?.id, title: task.title,
        prio: task.prio || 'P2', status: task.status || 'todo',
        assignee: task.assignee || '', blocker: task.blocker || null,
        note: task.note || null, due_date: task.due_date || null,
      }).select().single();
      if (data) task.id = data.id;
    }
    return task;
  }, [currentClient]);

  const deleteTask = useCallback(async (id) => {
    await supabase.from('tasks').delete().eq('id', id);
  }, []);

  /** Sauvegarde l'ordre des tâches après un drag & drop */
  const saveTaskOrder = useCallback((reorderedTasks) => {
    if (!currentClient) return;
    setTasks(reorderedTasks);
    try {
      localStorage.setItem(
        'cc-task-order-' + currentClient.id,
        JSON.stringify(reorderedTasks.map(t => t.id))
      );
    } catch (_) {}
  }, [currentClient]);

  // ── Realtime ──────────────────────────────────────────────────────────────

  function subscribeRealtime(clientId) {
    if (rtChanRef.current) supabase.removeChannel(rtChanRef.current);
    rtChanRef.current = supabase.channel('t-' + clientId)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tasks',
        filter: 'client_id=eq.' + clientId,
      }, () => loadTasksForClient(clientId))
      .subscribe();
  }

  // ── Résumés de sessions ───────────────────────────────────────────────────

  async function loadSummaries(clientId, limit = 5) {
    try {
      const { data } = await supabase.from('session_summaries')
        .select('summary_text, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(limit);
      return ((data || []).reverse()); // ordre chronologique pour le prompt
    } catch { return []; }
  }

  const addSummary = useCallback((summary) => {
    setSummaries(prev => {
      const updated = [...prev, { summary_text: summary, created_at: new Date().toISOString() }];
      return updated.slice(-5); // max 5
    });
  }, []);

  // ── Drive updates ─────────────────────────────────────────────────────────

  async function checkDriveOutdated(client) {
    if (!client?.drive_folder_id) return;
    try {
      // 1. Métadonnées Drive (appel léger — pas de téléchargement de contenu)
      const metaData = await callBackend(
        { action: 'list_drive_metadata', folder_id: client.drive_folder_id }, jwtToken
      );
      if (!metaData.files?.length) return;

      // 2. État des chunks indexés en base — paginé (PostgREST limite à 1000 lignes
      //    par défaut ; sans pagination, les gros clients semblent avoir des fichiers
      //    "nouveaux" alors qu'ils sont déjà indexés).
      const indexedMap = {};
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data: rows } = await supabase
          .from('document_chunks')
          .select('source_id, last_indexed_at')
          .eq('client_id', client.id)
          .not('source_id', 'is', null)
          .range(offset, offset + PAGE - 1);
        if (!rows?.length) break;
        for (const row of rows) {
          if (!indexedMap[row.source_id] || row.last_indexed_at > indexedMap[row.source_id])
            indexedMap[row.source_id] = row.last_indexed_at;
        }
        if (rows.length < PAGE) break;
        offset += PAGE;
      }

      // 3. Compter les fichiers nouveaux / modifiés (tolérance 5 min)
      const TOLERANCE_MS = 5 * 60 * 1000;
      let newCount = 0, modifiedCount = 0;
      for (const f of metaData.files) {
        if (!EXPORTABLE_MIMETYPES.includes(f.mimeType)) continue;
        const lastIndexed = indexedMap[f.id];
        if (!lastIndexed) {
          newCount++;
        } else {
          const modT = new Date(f.modifiedTime).getTime();
          const idxT = new Date(lastIndexed).getTime();
          if (modT > idxT + TOLERANCE_MS) modifiedCount++;
        }
      }

      const count = newCount + modifiedCount;
      if (count > 0) setDriveOutdated({ count, newCount, modifiedCount });
    } catch (e) {
      console.warn('checkDriveOutdated error:', e.message);
    }
  }

  async function loadDocCache(client) {
    try {
      const { data } = await supabase
        .from('document_chunks')
        .select('source_name, source_id, chunk_text, last_indexed_at, drive_modified_at')
        .eq('client_id', client.id)
        .in('source_type', ['doc', 'sheet', 'pdf', 'file'])
        .order('last_indexed_at', { ascending: false })
        .order('source_name');

      if (!data?.length) { setDocCache([]); return; }

      const bySource = {};
      for (const row of data) {
        if (!bySource[row.source_name])
          bySource[row.source_name] = {
            source_id: row.source_id,
            last_indexed_at: row.last_indexed_at,
            drive_modified_at: row.drive_modified_at,
            text: '',
          };
        if (bySource[row.source_name].text.length < 8000)
          bySource[row.source_name].text += (bySource[row.source_name].text ? '\n' : '') + row.chunk_text;
      }
      const docs = Object.entries(bySource).slice(0, 10).map(([name, v]) => ({
        driveId: v.source_id, filename: name,
        content: v.text.slice(0, 8000),
        modifiedTime: v.drive_modified_at || v.last_indexed_at || null,
      }));
      setDocCache(docs);
    } catch (e) {
      console.warn('loadDocCache error:', e.message);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Retoque les membres depuis le champ JSON clients.members */
  function getMembers(client) {
    try { return JSON.parse(client?.members || '[]'); } catch { return []; }
  }

  function getSources(client) {
    try { return JSON.parse(client?.sources || '[]'); } catch { return []; }
  }

  return {
    clients, setClients,
    currentClient, setCurrentClient,
    tasks, setTasks,
    summaries, setSummaries, addSummary,
    docCache,
    syncStatus, setSyncStatus,
    syncProgress, setSyncProgress,
    driveOutdated, clearDriveOutdated: () => setDriveOutdated(null),
    checkDriveOutdated,
    loadClients, selectClient,
    upsertTask, deleteTask, saveTaskOrder,
    loadTasksForClient,
    getMembers, getSources,
    loadDocCache,
    indexingRef,
  };
}

// ── Utilitaire : ordonnancement des tâches ────────────────────────────────

function applyTaskOrder(tasks, clientId) {
  try {
    const saved = JSON.parse(localStorage.getItem('cc-task-order-' + clientId) || 'null');
    if (!saved?.length) return tasks;
    const map = Object.fromEntries(tasks.map(t => [t.id, t]));
    const ordered = saved.map(id => map[id]).filter(Boolean);
    const orderedIds = new Set(ordered.map(x => x.id));
    tasks.forEach(t => { if (!orderedIds.has(t.id)) ordered.push(t); });
    return ordered;
  } catch { return tasks; }
}
