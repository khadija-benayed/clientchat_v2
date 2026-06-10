import { useState, useEffect } from 'react';
import Modal from './Modal';
import supabase from '../../lib/supabase';
import { callBackend } from '../../lib/backend';

function computeInitials(fullName, email) {
  const src = fullName || email || '?';
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function NewClientModal({ isOpen, onClose, currentUserId, jwtToken, onCreated }) {
  const [name, setName] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(''); setSelectedIds([]); setError('');
    supabase.from('team_members').select('id, full_name, email').order('full_name')
      .then(({ data }) => setTeamMembers(data || []));
  }, [isOpen]);

  function toggle(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function create() {
    if (!name.trim()) { setError('Le nom du client est requis.'); return; }
    setError(''); setLoading(true);
    try {
      // Build clients.members: creator always included, plus selected others
      const membersList = teamMembers.filter(m => m.id === currentUserId || selectedIds.includes(m.id));
      const usedInitials = [];
      const membersJson = membersList.map(m => {
        const base = computeInitials(m.full_name, m.email);
        let ini = base;
        let n = 2;
        while (usedInitials.includes(ini)) { ini = base + n++; }
        usedInitials.push(ini);
        return { initials: ini, name: m.full_name || m.email, member_id: m.id };
      });

      const memberRows = [
        { member_id: currentUserId, role: 'owner' },
        ...selectedIds.filter(id => id !== currentUserId).map(id => ({ member_id: id, role: 'member' })),
      ];

      const result = await callBackend({
        action: 'create_client',
        name: name.trim(),
        members_json: membersJson,
        member_rows: memberRows,
      }, jwtToken);

      if (result.error) { setError(result.error); return; }

      setName(''); setSelectedIds([]);
      onCreated?.(result.client); onClose();
    } catch (e) {
      setError(e.message || 'Erreur inattendue.');
    } finally {
      setLoading(false);
    }
  }

  const others = teamMembers.filter(m => m.id !== currentUserId);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nouveau client">
      <label>Nom du client</label>
      <input type="text" value={name} onChange={e => setName(e.target.value)}
        placeholder="Ex : Décathlon" onKeyDown={e => { if (e.key === 'Enter') create(); }} />

      <label style={{ marginTop: '12px' }}>Membres de l'équipe</label>

      {/* Current user — always added as owner */}
      {teamMembers.find(m => m.id === currentUserId) && (() => {
        const me = teamMembers.find(m => m.id === currentUserId);
        return (
          <div className="cm-row" style={{ opacity: 0.7, marginBottom: '4px' }}>
            <div className="cm-info">
              <div className="cm-name">{me.full_name || me.email}</div>
              <div className="cm-email">toi — owner</div>
            </div>
          </div>
        );
      })()}

      {others.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
          {others.map(m => (
            <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal' }}>
              <input type="checkbox" checked={selectedIds.includes(m.id)}
                onChange={() => toggle(m.id)} style={{ width: 'auto', margin: 0 }} />
              <span>{m.full_name || m.email}</span>
            </label>
          ))}
        </div>
      )}

      {error && <div className="err" style={{ marginTop: '8px' }}>{error}</div>}
      <div className="modal-foot">
        <button className="btn btn-sec" onClick={onClose}>Annuler</button>
        <button className="btn" style={{ width: 'auto' }} onClick={create} disabled={loading}>
          {loading ? 'Création…' : 'Créer'}
        </button>
      </div>
    </Modal>
  );
}
