import { useState, useEffect } from 'react';
import { callBackend } from '../../lib/backend';
import { memberStyle } from '../../lib/constants';
import supabase from '../../lib/supabase';

/** Derives 2-letter initials: first letter of first word + first letter of second word */
function computeInitials(fullName, email) {
  const src = fullName || email || '?';
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Ensures no two members share the same initials — appends a digit if needed */
function uniqueInitials(base, existing) {
  if (!existing.some(m => m.initials === base)) return base;
  let n = 2;
  while (existing.some(m => m.initials === base + n)) n++;
  return base + n;
}

export default function MembersSection({ client, onMembersChange, jwtToken }) {
  const [accessData, setAccessData] = useState(null);
  const [accessError, setAccessError] = useState('');
  const [addMemberId, setAddMemberId] = useState('');

  useEffect(() => {
    loadClientMembers();
  }, [client?.id]); // eslint-disable-line

  async function loadClientMembers() {
    try {
      const data = await callBackend({ action: 'get_client_members', client_id: client.id }, jwtToken);
      setAccessData(data);
    } catch (e) { setAccessError(e.message); }
  }

  /** Reads current clients.members JSON, adds/removes an entry, persists both to DB */
  function syncTeamMember(action, tm) {
    let current = [];
    try { current = JSON.parse(client?.members || '[]'); } catch {}

    let updated;
    if (action === 'add') {
      const base = computeInitials(tm.full_name, tm.email);
      const ini = uniqueInitials(base, current);
      updated = [...current, { initials: ini, name: tm.full_name || tm.email, member_id: tm.id }];
    } else {
      updated = current.filter(m => m.member_id !== tm.id);
    }

    const json = JSON.stringify(updated);
    supabase.from('clients').update({ members: json }).eq('id', client.id)
      .catch(e => console.warn('syncTeamMember:', e.message));
    onMembersChange?.(json);
  }

  async function addClientMember() {
    if (!addMemberId) return;
    setAccessError('');
    const tm = (accessData?.available || []).find(m => m.id === addMemberId);
    try {
      await callBackend({ action: 'add_client_member', client_id: client.id, member_id: addMemberId, role: 'member' }, jwtToken);
      if (tm) syncTeamMember('add', tm);
      setAddMemberId('');
      await loadClientMembers();
    } catch (e) { setAccessError(e.message); }
  }

  async function removeClientMember(memberId, tm) {
    setAccessError('');
    try {
      await callBackend({ action: 'remove_client_member', client_id: client.id, member_id: memberId }, jwtToken);
      syncTeamMember('remove', { id: memberId, ...tm });
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
      <label>Membres de l'équipe</label>

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
              const ini = computeInitials(m.full_name, m.email);
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
                        onClick={() => removeClientMember(m.member_id, { full_name: m.full_name, email: m.email })}>
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
                <option value="">— Ajouter un membre —</option>
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
    </>
  );
}
