/**
 * src/components/settings/MembersSection.jsx — Section membres de l'équipe
 *
 * Gère deux niveaux de membres :
 * 1. Membres de l'équipe (initiales + nom) — stockés dans clients.members (JSON)
 * 2. Accès à l'espace (client_members + team_members) — géré via le backend
 *
 * Props :
 * @param {object}   client       - Client courant
 * @param {Function} onMembersChange - Appelée quand les membres changent
 * @param {string}   jwtToken
 */
import { useState, useEffect } from 'react';
import { callBackend } from '../../lib/backend';
import { memberStyle } from '../../lib/constants';
import supabase from '../../lib/supabase';

export default function MembersSection({ client, onMembersChange, jwtToken }) {
  // Membres de l'équipe (initiales)
  const [members, setMembers] = useState([]);
  const [newInitials, setNewInitials] = useState('');
  const [newName, setNewName] = useState('');

  // Accès à l'espace (client_members)
  const [accessData, setAccessData] = useState(null);
  const [accessError, setAccessError] = useState('');
  const [addMemberId, setAddMemberId] = useState('');

  useEffect(() => {
    try { setMembers(JSON.parse(client?.members || '[]')); } catch { setMembers([]); }
    loadClientMembers();
  }, [client?.id]); // eslint-disable-line

  async function loadClientMembers() {
    try {
      const data = await callBackend({ action: 'get_client_members', client_id: client.id }, jwtToken);
      setAccessData(data);
    } catch (e) { setAccessError(e.message); }
  }

  // ── Membres équipe ────────────────────────────────────────────────────────

  function addMember() {
    const ini = newInitials.trim().toUpperCase();
    if (!ini || members.find(m => m.initials === ini)) return;
    const updated = [...members, { initials: ini, name: newName.trim() || ini }];
    setMembers(updated);
    setNewInitials(''); setNewName('');
    persist(updated);
  }

  function removeMember(i) {
    const updated = members.filter((_, idx) => idx !== i);
    setMembers(updated);
    persist(updated);
  }

  function persist(list) {
    const json = JSON.stringify(list);
    supabase.from('clients').update({ members: json }).eq('id', client.id)
      .catch(e => console.warn('persistMembers:', e.message));
    onMembersChange?.(json);
  }

  // ── Accès espace ─────────────────────────────────────────────────────────

  async function addClientMember() {
    if (!addMemberId) return;
    setAccessError('');
    try {
      await callBackend({ action: 'add_client_member', client_id: client.id, member_id: addMemberId, role: 'member' }, jwtToken);
      setAddMemberId('');
      await loadClientMembers();
    } catch (e) { setAccessError(e.message); }
  }

  async function removeClientMember(memberId, name) {
    if (!confirm(`Retirer "${name || 'ce membre'}" de l'espace ?`)) return;
    try {
      await callBackend({ action: 'remove_client_member', client_id: client.id, member_id: memberId }, jwtToken);
      await loadClientMembers();
    } catch (e) { setAccessError(e.message); }
  }

  async function setRole(memberId, role) {
    try {
      await callBackend({ action: 'set_member_role', client_id: client.id, member_id: memberId, role }, jwtToken);
      await loadClientMembers();
    } catch (e) { setAccessError(e.message); }
  }

  async function claimOwnership() {
    try {
      await callBackend({ action: 'claim_ownership', client_id: client.id }, jwtToken);
      await loadClientMembers();
    } catch (e) { setAccessError(e.message); }
  }

  return (
    <>
      {/* ── Membres équipe ──────────────────────────────────────────────── */}
      <label>Membres de l'équipe</label>
      <div className="note-txt">
        Format : initiales + prénom+nom complet. Ex : KB = Khadija Ben Ayed.
      </div>
      <div className="members-wrap">
        {members.map((m, i) => (
          <div key={i} className="mtag">
            <span>{m.initials}{m.name && m.name !== m.initials ? ' — ' + m.name : ''}</span>
            <span className="mrem" onClick={() => removeMember(i)}>×</span>
          </div>
        ))}
      </div>
      <div className="add-row" style={{ marginBottom: '14px' }}>
        <input type="text" placeholder="Initiales (KB)"
          value={newInitials} onChange={e => setNewInitials(e.target.value.toUpperCase())}
          style={{ textTransform: 'uppercase', marginBottom: 0 }} maxLength={5}
        />
        <input type="text" placeholder="Prénom + Nom"
          value={newName} onChange={e => setNewName(e.target.value)}
          style={{ marginBottom: 0 }}
        />
        <button className="btn btn-sec" style={{ width: 'auto' }} onClick={addMember}>Ajouter</button>
      </div>

      {/* ── Accès à l'espace ────────────────────────────────────────────── */}
      <div className="members-access-section">
        <div className="section-divider-label">Accès à cet espace</div>

        {accessData?.can_claim ? (
          <div className="cm-claim-banner">
            <span>⚠️ Cet espace n'a pas encore d'owner.</span>
            <button className="cm-claim-btn" onClick={claimOwnership}>Devenir owner</button>
          </div>
        ) : accessData ? (
          <>
            <div className="cm-list">
              {!accessData.members?.length ? (
                <div className="cm-empty">Aucun membre assigné.</div>
              ) : accessData.members.map(m => {
                const ini = initials(m.full_name, m.email);
                const st = memberStyle(ini);
                return (
                  <div key={m.member_id} className="cm-row">
                    <div className="cm-avatar" style={{ background: st.bg, color: st.c }}>{ini}</div>
                    <div className="cm-info">
                      <div className="cm-name">{m.full_name || m.email || 'Utilisateur'}</div>
                      <div className="cm-email">{m.email || ''}</div>
                    </div>
                    <span className={`cm-role-badge ${m.role}`}>{m.role === 'owner' ? 'owner' : 'membre'}</span>
                    {accessData.is_owner && (
                      <div className="cm-actions">
                        <button className="cm-role-btn"
                          onClick={() => setRole(m.member_id, m.role === 'owner' ? 'member' : 'owner')}>
                          {m.role === 'owner' ? '→ membre' : '→ owner'}
                        </button>
                        <button className="cm-remove-btn"
                          onClick={() => removeClientMember(m.member_id, m.full_name || m.email)}>
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {accessData.is_owner && (
              <div className="cm-add-row" style={{ marginTop: '8px' }}>
                <select value={addMemberId} onChange={e => setAddMemberId(e.target.value)}
                  style={{ marginBottom: 0 }}>
                  <option value="">— Sélectionner un membre —</option>
                  {(accessData.available || []).map(m => (
                    <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
                  ))}
                </select>
                <button className="btn btn-sec" style={{ width: 'auto', padding: '7px 14px' }}
                  onClick={addClientMember}>
                  Ajouter
                </button>
              </div>
            )}

            {!accessData.is_owner && (
              <div className="cm-hint">
                {accessData.current_role === 'member'
                  ? 'Demande à un owner de te promouvoir pour gérer les accès.'
                  : "Tu n'es pas encore assigné à cet espace."}
              </div>
            )}
          </>
        ) : (
          <div className="cm-empty">Chargement…</div>
        )}

        {accessError && <div className="err" style={{ marginTop: '6px' }}>{accessError}</div>}
      </div>
    </>
  );
}

function initials(fullName, email) {
  const src = fullName || email || '?';
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
