import { useState, useEffect } from 'react';
import { callBackend } from '../../lib/backend';
import { memberStyle } from '../../lib/constants';
import { computeInitials } from '../../utils/initials';

export default function MembersSection({ client, jwtToken, onMembersRefresh }) {
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

  async function addClientMember() {
    if (!addMemberId) return;
    setAccessError('');
    try {
      await callBackend({ action: 'add_client_member', client_id: client.id, member_id: addMemberId, role: 'member' }, jwtToken);
      setAddMemberId('');
      await loadClientMembers();
      onMembersRefresh?.();
    } catch (e) { setAccessError(e.message); }
  }

  async function removeClientMember(memberId) {
    setAccessError('');
    try {
      await callBackend({ action: 'remove_client_member', client_id: client.id, member_id: memberId }, jwtToken);
      await loadClientMembers();
      onMembersRefresh?.();
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
                        onClick={() => removeClientMember(m.member_id)}>
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
