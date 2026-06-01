/**
 * src/components/shared/NewClientModal.jsx — Créer un nouveau client
 */
import { useState } from 'react';
import Modal from './Modal';
import supabase from '../../lib/supabase';

export default function NewClientModal({ isOpen, onClose, currentUserId, onCreated }) {
  const [name, setName] = useState('');
  const [members, setMembers] = useState([{ ini: '', name: '' }]);
  const [error, setError] = useState('');

  function addRow() { setMembers(prev => [...prev, { ini: '', name: '' }]); }
  function removeRow(i) { setMembers(prev => prev.filter((_, idx) => idx !== i)); }
  function updateRow(i, field, val) { setMembers(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: val } : m)); }

  async function create() {
    if (!name.trim()) { setError('Le nom du client est requis.'); return; }
    setError('');
    const membersData = members.filter(m => m.ini.trim())
      .map(m => ({ initials: m.ini.trim().toUpperCase(), name: m.name.trim() || m.ini.trim().toUpperCase() }));
    const { data, error: err } = await supabase.from('clients')
      .insert({ name: name.trim(), members: JSON.stringify(membersData) })
      .select().single();
    if (err) { setError(err.message); return; }
    if (data && currentUserId) {
      await supabase.from('client_members').insert({ client_id: data.id, member_id: currentUserId, role: 'owner' })
        .then(() => {}).catch(e => console.warn('NewClient client_members:', e.message));
    }
    setName(''); setMembers([{ ini: '', name: '' }]);
    onCreated?.(data); onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nouveau client">
      <label>Nom</label>
      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex : Décathlon"
        onKeyDown={e => { if (e.key === 'Enter') create(); }} />
      <label>Membres de l'équipe</label>
      {members.map((m, i) => (
        <div key={i} className="member-row">
          <input type="text" placeholder="Initiales" value={m.ini}
            onChange={e => updateRow(i, 'ini', e.target.value.toUpperCase())} style={{ textTransform: 'uppercase', marginBottom: 0 }} maxLength={5} />
          <input type="text" placeholder="Prénom Nom" value={m.name}
            onChange={e => updateRow(i, 'name', e.target.value)} style={{ marginBottom: 0 }} />
          <button className="btn-rem-member" onClick={() => removeRow(i)}>×</button>
        </div>
      ))}
      <button className="btn-add-member" onClick={addRow}>+ Ajouter un membre</button>
      {error && <div className="err" style={{ marginTop: '6px' }}>{error}</div>}
      <div className="modal-foot">
        <button className="btn btn-sec" onClick={onClose}>Annuler</button>
        <button className="btn" style={{ width: 'auto' }} onClick={create}>Créer</button>
      </div>
    </Modal>
  );
}
