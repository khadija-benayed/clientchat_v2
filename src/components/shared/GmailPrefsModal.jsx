/**
 * src/components/shared/GmailPrefsModal.jsx — Toggle Gmail sync utilisateur
 */
import { useState, useEffect } from 'react';
import Modal from './Modal';
import supabase from '../../lib/supabase';
import { callBackend } from '../../lib/backend';

export default function GmailPrefsModal({ isOpen, onClose, currentUserId, jwtToken }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!isOpen || !currentUserId) return;
    supabase.from('team_members').select('gmail_sync_enabled').eq('id', currentUserId).single()
      .then(({ data }) => setEnabled(!!(data?.gmail_sync_enabled)));
  }, [isOpen, currentUserId]);

  async function toggle(val) {
    setEnabled(val);
    try { await callBackend({ action: 'update_gmail_sync', enabled: val }, jwtToken); }
    catch (e) { console.error('updateGmailSync:', e.message); setEnabled(!val); }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Préférences Gmail" maxWidth="380px">
      <div className="gmail-prefs-row">
        <div>
          <div className="gmail-prefs-title">Activer la sync Gmail</div>
          <div className="gmail-prefs-sub">
            Permet à ClientChat de lire vos emails labelisés pour en extraire des résumés métier.
            Le corps des emails n'est jamais stocké.
          </div>
        </div>
        <label className="toggle-switch">
          <input type="checkbox" checked={enabled} onChange={e => toggle(e.target.checked)} />
          <span className="toggle-slider" />
        </label>
      </div>
      <div className="modal-foot">
        <button className="btn btn-sec" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
