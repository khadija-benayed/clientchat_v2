/**
 * src/components/settings/ClientSettings.jsx — Modal paramètres client
 *
 * Modal à deux onglets : Paramètres | Historique sessions.
 * Orchestre les sous-sections : Membres, Drive, Email, Fiche client.
 *
 * Props :
 * @param {boolean}  isOpen
 * @param {Function} onClose
 * @param {object}   client           - Client courant
 * @param {Function} onClientUpdate   - Appelée avec les champs modifiés
 * @param {Function} onSyncMessage    - Pour afficher dans le chat
 * @param {Function} onDeleteClient
 * @param {Function} onOpenGmailPrefs
 * @param {object}   syncHook         - { syncDrive, syncEmails, generateBrief }
 * @param {string}   jwtToken
 */
import { useState, useEffect } from 'react';
import Modal from '../shared/Modal';
import MembersSection from './MembersSection';
import DriveSection from './DriveSection';
import EmailSection from './EmailSection';
import { callBackend } from '../../lib/backend';
import supabase from '../../lib/supabase';

export default function ClientSettings({
  isOpen, onClose, client, myRole, onClientUpdate, onSyncMessage,
  onDeleteClient, onOpenGmailPrefs, syncHook, onSyncComplete, indexingRef, jwtToken,
  onMembersRefresh,
}) {
  const [tab, setTab] = useState('params');
  const [ctx, setCtx] = useState('');
  const [histSummaries, setHistSummaries] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [brief, setBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  // Buffer des modifications en attente (flush à "Enregistrer")
  const [pendingUpdates, setPendingUpdates] = useState({});

  // Invitation state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLink, setInviteLink] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');

  // Dérivé directement depuis myRole — pas de state pour éviter le re-render parasite
  const canInvite = myRole === 'owner';

  useEffect(() => {
    if (!isOpen || !client) return;
    // Initialiser le contexte manuel
    const b = getBrief(client);
    setBrief(b);
    setCtx(b ? '' : (client.context || '').replace(/\n*---\s*Contenu Drive[\s\S]*$/, '').trim());
    setPendingUpdates({});
    setTab('team');
    setInviteEmail(''); setInviteRole('member'); setInviteLink(null); setInviteError('');
  }, [isOpen, client?.id]); // eslint-disable-line

  // Reset des champs d'invitation si le rôle change pendant que le modal est ouvert.
  // Séparé du useEffect principal pour ne pas écraser ctx/pendingUpdates/tab lors d'un
  // changement de rôle mid-session (ex : promotion Realtime pendant une édition).
  useEffect(() => {
    if (!isOpen) return;
    setInviteEmail(''); setInviteRole('member'); setInviteLink(null); setInviteError('');
  }, [myRole]); // eslint-disable-line

  function getBrief(c) {
    if (!c?.context) return null;
    try {
      const p = JSON.parse(c.context);
      const keys = ['secteur','enjeux_principaux','kpis','equipe','historique','notes'];
      return keys.every(k => k in p) ? p : null;
    } catch { return null; }
  }

  function handleClientUpdate(fields) {
    setPendingUpdates(prev => ({ ...prev, ...fields }));
    onClientUpdate?.(fields); // mise à jour locale immédiate
  }

  async function saveSettings() {
    const hasBrief = !!getBrief(client);
    const gmailLabel = pendingUpdates.gmail_label !== undefined
      ? pendingUpdates.gmail_label
      : client?.gmail_label || null;

    let updates;
    if (hasBrief) {
      updates = {
        drive_folder_id: client?.drive_folder_id || '',
        members: client?.members || '[]',
        sources: client?.sources || '[]',
        gmail_label: gmailLabel,
      };
    } else {
      const manualCtx = ctx.replace(/\n*---\s*Contenu Drive[\s\S]*$/, '').trim();
      updates = {
        context: manualCtx, drive_folder_id: client?.drive_folder_id || '',
        members: client?.members || '[]', sources: client?.sources || '[]',
        gmail_label: gmailLabel,
      };
    }

    await supabase.from('clients').update(updates).eq('id', client.id);
    onClientUpdate?.(updates);
    onClose();
  }

  async function loadHistory() {
    if (!client) return;
    setHistLoading(true);
    const { data } = await supabase.from('session_summaries')
      .select('summary_text, created_at').eq('client_id', client.id)
      .order('created_at', { ascending: false }).limit(20);
    setHistSummaries((data || []).reverse());
    setHistLoading(false);
  }

  async function regenerateBrief() {
    setBriefLoading(true);
    try {
      const docsContent = await syncHook.generateBrief(client.id, onSyncMessage);
      if (!docsContent) { onSyncMessage?.({ type: 'error', message: '⚠ Aucun document indexé. Lance d\'abord une sync Drive.' }); return; }
      const data = await callBackend({
        action: 'generate_brief',
        client_id: client.id,
        docs_content: docsContent,
        existing_brief: client?.context || null,
      }, jwtToken);
      if (data.brief) {
        setBrief(data.brief);
        onClientUpdate?.({ context: JSON.stringify(data.brief) });
        onSyncMessage?.({ type: 'ok', message: '✓ Fiche client générée avec succès.' });
      } else throw new Error(data.error || 'Fiche non générée');
    } catch (e) { onSyncMessage?.({ type: 'error', message: '⚠ ' + e.message }); }
    finally { setBriefLoading(false); }
  }

  async function deleteClient() {
    if (!confirm(`Supprimer définitivement "${client.name}" et toutes ses tâches ?\n\nCette action est irréversible.`)) return;
    await callBackend({ action: 'delete_client', client_id: client.id }, jwtToken);
    onDeleteClient?.(client.id);
    onClose();
  }

  async function createInvitation() {
    setInviteLoading(true);
    setInviteError('');
    try {
      const data = await callBackend({
        action: 'create_invitation',
        client_id: client.id,
        invited_email: inviteEmail,
        role: inviteRole,
      }, jwtToken);
      if (data.error) { setInviteError(data.error); return; }
      setInviteLink(data.url);
    } catch (e) {
      setInviteError(e.message);
    } finally {
      setInviteLoading(false);
    }
  }

  const hasDrive = (() => {
    try { return JSON.parse(client?.sources || '[]').some(s => s.type === 'drive' && s.folder_id); } catch { return false; }
  })();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Paramètres — ${client?.name || ''}`}>
      <div className="settings-tabs">
        <button className={`stab${tab === 'team' ? ' on' : ''}`} onClick={() => setTab('team')}>Équipe</button>
        <button className={`stab${tab === 'sources' ? ' on' : ''}`} onClick={() => setTab('sources')}>Sources</button>
        <button className={`stab${tab === 'brief' ? ' on' : ''}`} onClick={() => setTab('brief')}>Fiche client</button>
        <button className={`stab${tab === 'hist' ? ' on' : ''}`}
          onClick={() => { setTab('hist'); loadHistory(); }}>
          Historique
        </button>
      </div>

      {/* ── Onglet Équipe ─────────────────────────────────────────── */}
      {tab === 'team' && (
        <div>
          <MembersSection client={client} jwtToken={jwtToken} onMembersRefresh={onMembersRefresh} />

          {canInvite && (
            <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--brd)' }}>
              <label>Inviter un membre</label>
              {!inviteLink ? (
                <>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="email@domaine.com"
                      style={{ flex: '1 1 180px', marginBottom: 0 }}
                    />
                    <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ marginBottom: 0, flex: '0 0 auto' }}>
                      <option value="member">Membre</option>
                      <option value="owner">Owner</option>
                    </select>
                    <button className="btn btn-sec" style={{ width: 'auto', padding: '7px 14px', flex: '0 0 auto' }}
                      onClick={createInvitation} disabled={inviteLoading || !inviteEmail}>
                      {inviteLoading ? '…' : 'Générer le lien'}
                    </button>
                  </div>
                  {inviteError && <div className="err" style={{ marginTop: '6px' }}>{inviteError}</div>}
                </>
              ) : (
                <>
                  <input type="text" readOnly value={inviteLink} style={{ marginBottom: '6px', fontFamily: "'DM Mono', monospace", fontSize: '12px' }} />
                  <div style={{ fontSize: '12px', color: 'var(--tx3)', marginBottom: '8px' }}>
                    Expire dans 7 jours · Usage unique · Réservé à {inviteEmail}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-sec" style={{ width: 'auto', padding: '7px 14px' }}
                      onClick={() => navigator.clipboard.writeText(inviteLink)}>
                      Copier
                    </button>
                    <button className="btn btn-sec" style={{ width: 'auto', padding: '7px 14px' }}
                      onClick={() => { setInviteLink(null); setInviteEmail(''); setInviteRole('member'); }}>
                      Nouveau lien
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {myRole === 'owner' && (
            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--brd)' }}>
              <button className="btn" style={{ width: 'auto', background: 'var(--rbg)', color: 'var(--red)', border: '1px solid var(--red)' }}
                onClick={deleteClient}>
                Supprimer ce client
              </button>
              <div className="note-txt" style={{ marginTop: '6px' }}>Supprime définitivement le client et toutes ses tâches. Irréversible.</div>
            </div>
          )}

          <div className="modal-foot">
            <button className="btn btn-sec" onClick={onClose}>Fermer</button>
          </div>
        </div>
      )}

      {/* ── Onglet Sources ────────────────────────────────────────── */}
      {tab === 'sources' && (
        <div>
          <label>Contexte client</label>
          <textarea value={ctx} onChange={e => setCtx(e.target.value)}
            style={{ minHeight: '110px', fontFamily: "'DM Mono', monospace", fontSize: '12px', marginBottom: '4px' }}
            placeholder="Infos clés : secteur, stack, interlocuteurs, enjeux…" />

          <DriveSection client={client} onClientUpdate={handleClientUpdate}
            onSyncMessage={onSyncMessage} syncHook={syncHook}
            onSyncComplete={onSyncComplete} indexingRef={indexingRef} jwtToken={jwtToken} />

          <EmailSection client={client} onClientUpdate={handleClientUpdate}
            onSyncMessage={onSyncMessage} syncHook={syncHook}
            onOpenGmailPrefs={onOpenGmailPrefs} jwtToken={jwtToken} />

          <div className="modal-foot">
            <button className="btn btn-sec" onClick={onClose}>Annuler</button>
            <button className="btn" style={{ width: 'auto' }} onClick={saveSettings}>Enregistrer</button>
          </div>
        </div>
      )}

      {/* ── Onglet Fiche client ───────────────────────────────────── */}
      {tab === 'brief' && (
        <div>
          <div className="brief-section">
            <div className="brief-header">
              <span className="brief-label">Fiche générée automatiquement à partir des documents indexés</span>
              <button className="brief-regen-btn" disabled={!hasDrive || briefLoading}
                title={hasDrive ? '' : 'Connecte d\'abord une source Drive'}
                onClick={regenerateBrief}>
                {briefLoading ? '…génération' : '↻ Régénérer'}
              </button>
            </div>
            {brief ? <BriefDisplay brief={brief} /> : (
              <div className="brief-empty">
                {hasDrive ? 'Aucune fiche générée — clique sur Régénérer.' : 'Connecte d\'abord une source Drive.'}
              </div>
            )}
          </div>
          <div className="modal-foot">
            <button className="btn btn-sec" onClick={onClose}>Fermer</button>
          </div>
        </div>
      )}

      {/* ── Onglet Historique ─────────────────────────────────────── */}
      {tab === 'hist' && (
        <div>
          {histLoading ? (
            <div style={{ fontSize: '12px', color: 'var(--tx3)', fontStyle: 'italic' }}>Chargement…</div>
          ) : histSummaries.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--tx3)', fontStyle: 'italic' }}>Aucun résumé de session enregistré.</div>
          ) : [...histSummaries].reverse().map((s, i) => {
            const d = new Date(s.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            return (
              <div key={i} className="hist-entry">
                <div className="hist-date">{d}</div>
                <div className="hist-text">{s.summary_text}</div>
              </div>
            );
          })}
          <div className="modal-foot">
            <button className="btn btn-sec" onClick={onClose}>Fermer</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function BriefDisplay({ brief }) {
  const arrayField = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return <span style={{ color: 'var(--tx3)', fontStyle: 'italic' }}>—</span>;
    const label = (v) => {
      if (typeof v === 'string') return v;
      if (typeof v === 'object' && v !== null) {
        const name = [v.prenom, v.nom].filter(Boolean).join(' ') || v.nom || v.name || '?';
        return v.role ? `${name} — ${v.role}` : name;
      }
      return String(v);
    };
    return <div className="brief-field-value tags">
      {arr.map((v, i) => <span key={i} className="brief-tag">{label(v)}</span>)}
    </div>;
  };
  const fields = [
    { label: 'Secteur', value: brief.secteur, isText: true },
    { label: 'Enjeux principaux', value: brief.enjeux_principaux },
    { label: 'KPIs', value: brief.kpis },
    { label: 'Équipe client', value: brief.equipe },
    { label: 'Historique', value: brief.historique, isText: true },
    { label: 'Notes', value: brief.notes, isText: true },
  ];
  return (
    <div className="brief-fields">
      {fields.map((f, i) => (
        <div key={i} className="brief-field">
          <div className="brief-field-label">{f.label}</div>
          {f.isText
            ? <div className="brief-field-value">{String(f.value || '—')}</div>
            : arrayField(f.value)
          }
        </div>
      ))}
    </div>
  );
}
