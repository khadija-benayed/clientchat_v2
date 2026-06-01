/**
 * src/components/layout/ClientHeader.jsx — Barre du haut (topbar)
 *
 * Affiche le nom du client actif, le statut de sync, les boutons d'action.
 *
 * Props :
 * @param {object}      client        - Client courant
 * @param {string}      syncColor     - Couleur du point de sync
 * @param {string}      syncLabel     - Label de sync
 * @param {object|null} syncProgress  - { done, total } ou null
 * @param {boolean}     isDark        - Mode sombre actif
 * @param {Function}    onToggleDark  - Toggle mode sombre
 * @param {Function}    onOpenSettings - Ouvre les paramètres
 * @param {Function}    onOpenShortcuts - Ouvre le modal raccourcis
 */
import { Moon, Sun } from 'lucide-react';
import SyncStatus from '../shared/SyncStatus';

export default function ClientHeader({
  client, syncColor, syncLabel, syncProgress,
  isDark, onToggleDark, onOpenSettings, onOpenShortcuts,
}) {
  const initials = client?.name?.substring(0, 2).toUpperCase() || '?';
  return (
    <div className="topbar">
      <div className="tb-av">{initials}</div>
      <div className="tb-name">{client?.name || '—'}</div>
      <div className="tb-right">
        <SyncStatus color={syncColor} label={syncLabel} progress={syncProgress} />
        <button className="btn-dark-mode" onClick={onToggleDark} title="Mode sombre (⌘D)">
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="btn-sm" onClick={onOpenShortcuts} title="Raccourcis clavier (?)">⌨</button>
        <button className="btn-sm" onClick={onOpenSettings}>Paramètres</button>
      </div>
    </div>
  );
}
