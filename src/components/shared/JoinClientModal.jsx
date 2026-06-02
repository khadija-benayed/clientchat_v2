/**
 * src/components/shared/JoinClientModal.jsx — Rejoindre un client existant
 */
import { useState, useEffect } from 'react';
import Modal from './Modal';
import supabase from '../../lib/supabase';

export default function JoinClientModal({ isOpen, onClose, existingIds, currentUserId, onJoined }) {
  const [allClients, setAllClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    supabase.from('clients').select('id,name').order('name')
      .then(({ data }) => setAllClients((data || []).filter(c => !existingIds.includes(c.id))));
    setClientId(''); setError('');
  }, [isOpen]); // eslint-disable-line

  async function join() {
    if (!clientId) { setError('Sélectionne un client.'); return; }
    if (!currentUserId) { setError('Tu dois être connecté.'); return; }
    setError(''); setLoading(true);
    try {
      const { error: err } = await supabase.from('client_members')
        .upsert({ client_id: clientId, member_id: currentUserId, role: 'member' }, { onConflict: 'client_id,member_id' });
      if (err) { setError(err.message); return; }
      const { data, error: fetchErr } = await supabase.from('clients').select('*').eq('id', clientId).single();
      if (fetchErr || !data) { setError(fetchErr?.message || 'Client introuvable après la jonction.'); return; }
      onJoined?.(data); onClose();
    } catch (e) {
      setError(e.message || 'Erreur inattendue.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Rejoindre un client">
      <label>Client</label>
      <select value={clientId} onChange={e => setClientId(e.target.value)}>
        <option value="">— Sélectionne un client —</option>
        {allClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <p style={{ fontSize: '12px', color: 'var(--tx3)', margin: '4px 0 0' }}>
        Tu rejoins en tant que membre. Un owner peut modifier ton rôle via les paramètres du client.
      </p>
      {error && <div className="err">{error}</div>}
      <div className="modal-foot">
        <button className="btn btn-sec" onClick={onClose}>Annuler</button>
        <button className="btn" style={{ width: 'auto' }} onClick={join} disabled={loading}>
          {loading ? 'En cours…' : 'Rejoindre'}
        </button>
      </div>
    </Modal>
  );
}
