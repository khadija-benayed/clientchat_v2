/**
 * src/components/shared/JoinClientModal.jsx — Rejoindre un client existant
 */
import { useState, useEffect } from 'react';
import Modal from './Modal';
import supabase from '../../lib/supabase';

async function hashPass(p) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p + 'cc2026'));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function JoinClientModal({ isOpen, onClose, existingIds, currentUserId, onJoined }) {
  const [allClients, setAllClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    supabase.from('clients').select('id,name').order('name')
      .then(({ data }) => setAllClients((data || []).filter(c => !existingIds.includes(c.id))));
    setClientId(''); setPass(''); setError('');
  }, [isOpen]); // eslint-disable-line

  async function join() {
    if (!clientId) { setError('Sélectionne un client.'); return; }
    if (!pass)     { setError('Entre le mot de passe.'); return; }
    setError('');
    const hash = await hashPass(pass);
    const { data } = await supabase.from('clients').select('*').eq('id', clientId).eq('password_hash', hash).single();
    if (!data) { setError('Mot de passe incorrect.'); return; }
    if (currentUserId) {
      await supabase.from('client_members').upsert({ client_id: clientId, member_id: currentUserId, role: 'member' }, { onConflict: 'client_id,member_id' })
        .then(() => {}).catch(e => console.warn('joinExisting client_members:', e.message));
    }
    onJoined?.(data); onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Rejoindre un client">
      <label>Client</label>
      <select value={clientId} onChange={e => setClientId(e.target.value)}>
        <option value="">— Sélectionne un client —</option>
        {allClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label>Mot de passe</label>
      <input type="password" value={pass} onChange={e => setPass(e.target.value)}
        placeholder="Partagé par ton équipe"
        onKeyDown={e => { if (e.key === 'Enter') join(); }} />
      {error && <div className="err">{error}</div>}
      <div className="modal-foot">
        <button className="btn btn-sec" onClick={onClose}>Annuler</button>
        <button className="btn" style={{ width: 'auto' }} onClick={join}>Accéder</button>
      </div>
    </Modal>
  );
}
