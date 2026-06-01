/**
 * src/components/settings/DriveSection.jsx — Sources de contexte + Drive sync
 *
 * Gère la liste des sources connectées (Drive, PDF) et la fiche client générée.
 * Orchestre le sync Drive via useSync.
 *
 * Props :
 * @param {object}   client         - Client courant
 * @param {Function} onClientUpdate - Appelée quand client.sources ou context change
 * @param {Function} onSyncMessage  - Appelée avec { type, message } pour le chat
 * @param {object}   syncHook       - { syncDrive, generateBrief }
 * @param {string}   jwtToken
 */
import { useState } from 'react';
import { FolderOpen, FileText } from 'lucide-react';
import { callBackend, indexSourceBatched } from '../../lib/backend';
import supabase from '../../lib/supabase';

export default function DriveSection({ client, onClientUpdate, onSyncMessage, syncHook, jwtToken }) {
  const [showAddForm, setShowAddForm] = useState(null); // 'drive' | 'file' | null
  const [driveFolderId, setDriveFolderId] = useState('');
  const [driveName, setDriveName] = useState('');
  const [syncing, setSyncing] = useState({});
  const [tokenCount, setTokenCount] = useState('~0 tokens');

  function getSources() {
    try { return JSON.parse(client?.sources || '[]'); } catch { return []; }
  }
  function setSources(arr) {
    onClientUpdate?.({ sources: JSON.stringify(arr) });
  }

  const sources = getSources();

  // Calcul de l'estimation de tokens
  function updateTokenCount(manualCtxLen) {
    const briefLen = (() => { try { const b = JSON.parse(client?.context || ''); return b ? client.context.length : 0; } catch { return 0; } })();
    let total = Math.round((manualCtxLen + briefLen) / 4);
    sources.forEach(s => { total += Math.round((s.content_length || 0) / 4); });
    setTokenCount(total > 999 ? '~' + (total / 1000).toFixed(1) + 'k tokens' : '~' + total + ' tokens');
  }

  async function addDriveSource() {
    if (!driveFolderId.trim()) { alert('Entre un Folder ID Drive.'); return; }
    if (sources.find(s => s.type === 'drive' && s.folder_id === driveFolderId)) {
      alert('Ce dossier est déjà connecté.'); return;
    }
    const newSrc = { type: 'drive', name: driveName || 'Google Drive — ' + client.name, folder_id: driveFolderId.trim(), status: 'ok', last_synced_at: null, content_length: 0 };
    const updated = [...sources, newSrc];
    setSources(updated);
    await supabase.from('clients').update({ sources: JSON.stringify(updated), drive_folder_id: driveFolderId.trim() }).eq('id', client.id);
    onClientUpdate?.({ sources: JSON.stringify(updated), drive_folder_id: driveFolderId.trim() });
    setShowAddForm(null); setDriveFolderId(''); setDriveName('');
    syncSource(updated.length - 1, updated);
  }

  async function removeSource(idx) {
    const s = sources[idx];
    if (!s || !confirm(`Supprimer la source "${s.name}" ?`)) return;
    const updated = sources.filter((_, i) => i !== idx);
    setSources(updated);
    try {
      if (s.type === 'drive') {
        await callBackend({ action: 'delete_source_chunks', client_id: client.id, source_type_filter: ['doc','sheet','txt','csv','pdf','ppt'] }, jwtToken);
        await supabase.from('clients').update({ sources: JSON.stringify(updated), drive_folder_id: '', context: '' }).eq('id', client.id);
        onClientUpdate?.({ sources: JSON.stringify(updated), drive_folder_id: '', context: '' });
      } else {
        await callBackend({ action: 'delete_source_chunks', client_id: client.id, source_name: s.name }, jwtToken);
        await supabase.from('clients').update({ sources: JSON.stringify(updated) }).eq('id', client.id);
        onClientUpdate?.({ sources: JSON.stringify(updated) });
      }
    } catch (e) { console.warn('removeSource:', e.message); }
  }

  async function syncSource(idx, srcsOverride) {
    const srcs = srcsOverride || getSources();
    const s = srcs[idx];
    if (!s) return;
    setSyncing(prev => ({ ...prev, [idx]: true }));
    if (s.type === 'drive') {
      try {
        const result = await syncHook.syncDrive({
          folderId: s.folder_id, clientId: client.id, incremental: true,
          onMessage: onSyncMessage,
        });
        const cachedNote = result.cached > 0 ? `, ${result.cached} déjà indexé(s)` : '';
        const purgedNote = result.purged > 0 ? `, ${result.purged} supprimé(s)` : '';
        onSyncMessage?.({ type: 'ok', message: `✓ ${result.ok + result.cached} document(s) indexé(s)${cachedNote}${purgedNote}${result.errors ? ` (${result.errors} erreur(s))` : ''}.` });

        // Générer la fiche client après sync
        const docsForBrief = await syncHook.generateBrief(client.id, onSyncMessage);
        if (docsForBrief) {
          const data = await callBackend({ action: 'generate_brief', client_id: client.id, docs_content: docsForBrief }, jwtToken);
          if (data.brief) {
            onClientUpdate?.({ context: JSON.stringify(data.brief) });
            onSyncMessage?.({ type: 'ok', message: '✓ Fiche client générée avec succès.' });
          }
        }

        const updatedSrcs = srcs.map((x, i) => i === idx ? { ...x, status: 'ok', last_synced_at: new Date().toISOString(), content_length: result.ok + result.cached } : x);
        setSources(updatedSrcs);
        await supabase.from('clients').update({ sources: JSON.stringify(updatedSrcs), drive_folder_id: s.folder_id }).eq('id', client.id);
        onClientUpdate?.({ sources: JSON.stringify(updatedSrcs) });
      } catch (e) {
        const updatedSrcs = srcs.map((x, i) => i === idx ? { ...x, status: 'err' } : x);
        setSources(updatedSrcs);
        onSyncMessage?.({ type: 'error', message: '⚠ Erreur sync : ' + e.message });
      }
    }
    setSyncing(prev => ({ ...prev, [idx]: false }));
  }

  const iconMap = {
    drive: <FolderOpen size={16} style={{ color: 'var(--sb-blue-md)' }} />,
    file:  <FileText size={16} style={{ color: 'var(--sb-orange)' }} />,
  };

  return (
    <div className="sources-section">
      <div className="sources-label"><span>Sources de contexte</span></div>

      {sources.length === 0 ? (
        <div className="src-empty">Aucune source connectée.</div>
      ) : sources.map((s, i) => {
        const statusCls = s.status === 'ok' ? 'ok' : s.status === 'syncing' ? 'syncing' : 'err';
        const statusLbl = s.status === 'ok' ? '✓ Connecté' : s.status === 'syncing' ? '⟳ Sync…' : '✗ Erreur';
        const syncDate = s.last_synced_at
          ? new Date(s.last_synced_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
          : 'jamais';
        return (
          <div key={i} className="src-item">
            <div className="src-icon">{iconMap[s.type] || '📎'}</div>
            <div className="src-info">
              <div className="src-name">{s.name || s.type}</div>
              <div className="src-meta">Dernière sync : {syncDate}</div>
            </div>
            <span className={`src-status ${statusCls}`}>{statusLbl}</span>
            <div className="src-actions">
              <button className="src-sync-btn" disabled={syncing[i] || s.type === 'notion'}
                onClick={() => syncSource(i)}>
                {syncing[i] ? '…' : 'Sync'}
              </button>
              <button className="src-del-btn" onClick={() => removeSource(i)} title="Supprimer">×</button>
            </div>
          </div>
        );
      })}

      <div className="token-bar">
        <span className="token-bar-lbl">Contexte total estimé</span>
        <span className="token-bar-val">{tokenCount}</span>
      </div>

      {/* Bouton + Ajouter une source */}
      {!showAddForm ? (
        <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn-add-member" onClick={() => setShowAddForm('drive')}>
            + Google Drive
          </button>
          <button className="btn-add-member" onClick={() => setShowAddForm('file')}>
            + Fichier PDF
          </button>
        </div>
      ) : showAddForm === 'drive' ? (
        <div className="add-src-form open" style={{ marginTop: '10px' }}>
          <label>ID du dossier Google Drive</label>
          <input type="text" value={driveFolderId} onChange={e => setDriveFolderId(e.target.value)}
            placeholder="Ex : 1BxiMVs0XRA5..." />
          <div className="note-txt">L'ID se trouve dans l'URL Drive : drive.google.com/drive/folders/<strong>[ID ICI]</strong></div>
          <label>Nom (optionnel)</label>
          <input type="text" value={driveName} onChange={e => setDriveName(e.target.value)}
            placeholder="Ex : Docs Décathlon" />
          <div className="modal-foot" style={{ borderTop: 'none', paddingTop: '0' }}>
            <button className="btn btn-sec" onClick={() => { setShowAddForm(null); setDriveFolderId(''); setDriveName(''); }}>Annuler</button>
            <button className="btn" style={{ width: 'auto' }} onClick={addDriveSource}>Ajouter</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
