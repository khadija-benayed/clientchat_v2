/**
 * src/components/shared/JoinClientModal.jsx — Rejoindre un client via lien d'invitation
 */
import { useState, useEffect } from 'react';
import Modal from './Modal';
import { callBackend } from '../../lib/backend';

export default function JoinClientModal({ isOpen, onClose, jwtToken, onJoined }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setInput(''); setError('');
  }, [isOpen]);

  async function join() {
    const token = input.includes('/join/')
      ? input.split('/join/').pop().trim()
      : input.trim();
    if (!token) { setError('Saisis un lien ou un code d\'invitation.'); return; }
    setError(''); setLoading(true);
    try {
      const data = await callBackend({ action: 'join_client_via_token', token }, jwtToken);
      if (data.error) { setError(data.error); return; }
      onJoined?.(data.client);
      onClose();
    } catch (e) {
      setError(e.message || 'Erreur inattendue.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Rejoindre un client">
      <label>Lien ou code d'invitation</label>
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="https://…/join/xxxxxx ou code seul"
        onKeyDown={e => e.key === 'Enter' && join()}
      />
      <p style={{ fontSize: '12px', color: 'var(--tx3)', margin: '4px 0 0' }}>
        Colle le lien d'invitation reçu par email ou entre le code directement.
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
