/**
 * src/components/settings/EmailSection.jsx — Sync emails Gmail
 *
 * Section dans les paramètres client pour configurer le label Gmail
 * et lancer une synchronisation des emails.
 *
 * Props :
 * @param {object}   client        - Client courant (avec gmail_label)
 * @param {Function} onClientUpdate - Appelée quand gmail_label change
 * @param {Function} onSyncMessage  - Pour afficher des messages dans le chat
 * @param {object}   syncHook       - { syncEmails }
 * @param {Function} onOpenGmailPrefs - Ouvre le modal préférences Gmail
 * @param {string}   jwtToken
 */
import { useState } from 'react';

export default function EmailSection({ client, onClientUpdate, onSyncMessage, syncHook, onOpenGmailPrefs, jwtToken }) {
  const [labelInput, setLabelInput] = useState(client?.gmail_label || '');
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    const label = labelInput.trim() || client?.gmail_label?.trim();
    if (!label) {
      onSyncMessage?.({ type: 'warn', message: '⚠ Configure d\'abord le label Gmail dans les paramètres du client.' });
      return;
    }
    setSyncing(true);
    try {
      const result = await syncHook.syncEmails({
        clientId: client.id, labelName: label, daysBack: 7,
        onMessage: onSyncMessage,
      });
      if (result.message) {
        onSyncMessage?.({ type: 'info', message: result.message });
      } else if (result.total === 0) {
        onSyncMessage?.({ type: 'info', message: `Aucun email trouvé pour le label "${label}".` });
      } else {
        const parts = [];
        if (result.ok) parts.push(`${result.ok} email(s) résumé(s)`);
        if (result.skipped) parts.push(`${result.skipped} sans info métier`);
        if (result.errors) parts.push(`${result.errors} erreur(s)`);
        onSyncMessage?.({ type: 'ok', message: '✓ ' + (parts.join(', ') || 'Sync terminée') + '.' });
      }
    } catch (e) {
      onSyncMessage?.({ type: 'error', message: '⚠ Erreur sync emails : ' + e.message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="gmail-section">
      <div className="sources-label"><span>Sync emails Gmail</span></div>
      <div className="gmail-label-row">
        <input
          type="text"
          value={labelInput}
          onChange={e => { setLabelInput(e.target.value); onClientUpdate?.({ gmail_label: e.target.value || null }); }}
          placeholder="Ex : CC/Aroma-Zone"
          style={{ marginBottom: 0 }}
        />
        <button className="src-sync-btn" disabled={syncing} onClick={handleSync}>
          {syncing ? '…' : 'Sync emails'}
        </button>
      </div>
      <div className="note-txt" style={{ marginTop: '4px' }}>
        Label Gmail des emails de ce client.{' '}
        <span className="gmail-prefs-link" onClick={onOpenGmailPrefs}>
          Activer pour mes emails →
        </span>
      </div>
    </div>
  );
}
