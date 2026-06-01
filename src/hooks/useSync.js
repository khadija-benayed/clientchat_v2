/**
 * src/hooks/useSync.js — Synchronisation Drive et Email (SSE streaming)
 *
 * Ce hook gère les deux opérations de synchronisation longues :
 * - sync_drive : indexe les documents Google Drive du client
 * - sync_emails : résume les emails Gmail labelisés
 *
 * Les deux utilisent le protocole SSE (Server-Sent Events) :
 * le serveur envoie des événements JSON en continu pendant le traitement.
 * C'est comme un stream de logs en temps réel.
 *
 * @param {object} params
 * @param {string|null} params.jwtToken - JWT Supabase courant
 */
import { useState, useRef, useCallback } from 'react';
import { openBackendSSE } from '../lib/backend';
import supabase from '../lib/supabase';
import { indexSourceBatched } from '../lib/backend';

export function useSync({ jwtToken }) {
  // État de progression : { done, total } ou null si pas de sync en cours
  const [driveProgress, setDriveProgress] = useState(null);
  const [emailProgress, setEmailProgress] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const abortRef = useRef(null);

  /**
   * Synchronisation complète Drive via SSE.
   * Suit le même pattern que syncSource() dans ui.js.
   *
   * @param {object} options
   * @param {string} options.folderId    - ID du dossier Drive
   * @param {string} options.clientId    - UUID du client
   * @param {boolean} options.incremental - true = ne re-indexe que les modifiés
   * @param {boolean} options.resume      - true = reprend après une coupure
   * @param {function} options.onMessage  - callback({ type, message }) pour afficher dans le chat
   * @returns {Promise<{ok, cached, errors, purged}>}
   */
  const syncDrive = useCallback(async ({ folderId, clientId, incremental = true, resume = false, onMessage }) => {
    if (!folderId) throw new Error('Folder ID manquant');
    setIsSyncing(true);
    setDriveProgress({ done: 0, total: 0 });
    onMessage?.({ type: 'info', message: '⏳ Synchronisation Drive en cours…' });

    let syncOk = 0, syncCached = 0, syncErrors = 0, syncPurged = 0, syncTotal = 0;

    try {
      const resp = await openBackendSSE(
        { action: 'sync_drive', folder_id: folderId, client_id: clientId, incremental, resume },
        jwtToken
      );
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let syncDone = false;

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.status === 'heartbeat') continue;
          if (ev.status === 'done') {
            syncTotal = ev.total; syncOk = ev.ok ?? syncOk;
            syncCached = ev.cached ?? syncCached; syncErrors = ev.errors ?? syncErrors;
            syncPurged = ev.purged ?? 0;
            syncDone = true; break outer;
          }
          if (ev.status === 'ok') syncOk++;
          if (ev.status === 'cached') syncCached++;
          if (ev.status === 'error' || ev.status === 'timeout') syncErrors++;
          if (ev.progress != null) setDriveProgress({ done: ev.progress, total: ev.total || 1 });
        }
      }

      // Reprise auto si connexion coupée avec progrès
      if (!syncDone && !resume && (syncOk + syncCached) > 0) {
        onMessage?.({ type: 'info', message: `⚡ Connexion interrompue (${syncOk} indexé(s)). Reprise…` });
        setIsSyncing(false);
        return syncDrive({ folderId, clientId, incremental: false, resume: true, onMessage });
      }

      return { ok: syncOk, cached: syncCached, errors: syncErrors, purged: syncPurged, total: syncTotal };
    } finally {
      setIsSyncing(false);
      setDriveProgress(null);
    }
  }, [jwtToken]);

  /**
   * Synchronisation emails Gmail via SSE.
   *
   * @param {object} options
   * @param {string} options.clientId   - UUID du client
   * @param {string} options.labelName  - Label Gmail (ex: "CC/Aroma-Zone")
   * @param {number} options.daysBack   - Jours en arrière à scanner
   * @param {function} options.onMessage - callback pour le chat
   * @returns {Promise<{ok, skipped, errors, total, message?}>}
   */
  const syncEmails = useCallback(async ({ clientId, labelName, daysBack = 7, onMessage }) => {
    if (!labelName) throw new Error('Label Gmail non configuré');
    setEmailProgress({ done: 0, total: 0 });
    onMessage?.({ type: 'info', message: '⏳ Synchronisation emails en cours…' });

    let ok = 0, skipped = 0, errors = 0, total = 0, doneMsg = '';

    try {
      const resp = await openBackendSSE(
        { action: 'sync_emails', client_id: clientId, label_name: labelName, days_back: daysBack },
        jwtToken
      );
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.status === 'heartbeat') continue;
          if (ev.status === 'done') {
            total = ev.total; ok = ev.ok ?? ok;
            skipped = ev.skipped ?? skipped; errors = ev.errors ?? errors;
            if (ev.message) doneMsg = ev.message;
            break outer;
          }
          if (ev.status === 'summarized') ok++;
          if (ev.status === 'skipped') skipped++;
          if (ev.status === 'error') errors++;
          if (ev.progress != null) setEmailProgress({ done: ev.progress, total: ev.total || 1 });
        }
      }
      return { ok, skipped, errors, total, message: doneMsg };
    } finally {
      setEmailProgress(null);
    }
  }, [jwtToken]);

  /**
   * Génère la fiche client depuis les chunks déjà indexés en base.
   * Appelée après une sync Drive réussie.
   */
  const generateBrief = useCallback(async (clientId, onMessage) => {
    const { data: chunkRows } = await supabase
      .from('document_chunks')
      .select('source_name, chunk_text')
      .eq('client_id', clientId)
      .in('source_type', ['doc', 'sheet', 'pdf', 'txt', 'csv', 'ppt'])
      .order('last_indexed_at', { ascending: false })
      .order('source_name');

    if (!chunkRows?.length) return null;

    const bySrc = {};
    for (const row of chunkRows) {
      if (!bySrc[row.source_name]) bySrc[row.source_name] = '';
      if (bySrc[row.source_name].length < 6000)
        bySrc[row.source_name] += (bySrc[row.source_name] ? '\n' : '') + row.chunk_text;
    }
    const docsContent = Object.entries(bySrc).slice(0, 15)
      .map(([name, text]) => ({ filename: name, content: text.slice(0, 6000) }));

    if (!docsContent.length) return null;
    onMessage?.({ type: 'info', message: '⏳ Génération de la fiche client en cours…' });

    return docsContent; // retourne les docs, l'appelant fait callBackend generate_brief
  }, []);

  return {
    syncDrive, syncEmails, generateBrief,
    driveProgress, emailProgress,
    isSyncing,
  };
}
