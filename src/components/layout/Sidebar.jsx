/**
 * src/components/layout/Sidebar.jsx — Barre latérale gauche
 *
 * Affiche la liste des clients, les boutons de navigation et de logout.
 * Se réduit (collapsed) via un bouton ou le raccourci ⌘B.
 *
 * Props :
 * @param {Array}    clients         - Liste des espaces clients
 * @param {object}   currentClient   - Client actuellement sélectionné
 * @param {Function} onSelectClient  - Appelée quand on clique sur un client
 * @param {Function} onLeaveClient   - Appelée pour quitter un espace
 * @param {Function} onNewClient     - Ouvre le modal "Nouveau client"
 * @param {Function} onJoinClient    - Ouvre le modal "Rejoindre un client"
 * @param {Function} onOpenKb        - Ouvre la base de savoir
 * @param {Function} onGmailPrefs    - Ouvre les préférences Gmail
 * @param {Function} onLogout        - Déconnexion
 * @param {boolean}  collapsed       - true = sidebar réduite
 * @param {Function} onToggle        - Toggle collapsed/expanded
 */
import { PanelLeftClose, PanelLeftOpen, UserPlus, Plus, BookOpen, LogOut } from 'lucide-react';

export default function Sidebar({
  clients, currentClient, onSelectClient, onLeaveClient,
  onNewClient, onJoinClient, onOpenKb, onLogout,
  collapsed, onToggle, onGoHome, user,
}) {
  return (
    <div className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      {/* En-tête avec logo et bouton collapse */}
      <div className="sb-top">
        <div
          className="sb-brand"
          onClick={onGoHome}
          title="Accueil"
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >Client Chat</div>
        <button className="collapse-btn" onClick={onToggle} title="Réduire (⌘B)">
          {collapsed
            ? <PanelLeftOpen size={16} />
            : <PanelLeftClose size={16} />
          }
        </button>
      </div>

      <div className="sb-section">Mes clients</div>

      {/* Liste des clients */}
      <div id="cli-list">
        {clients.length === 0 ? (
          <div style={{ padding: '8px 16px', fontSize: '12px', color: 'var(--tx3)' }}>
            Aucun client
          </div>
        ) : clients.map(c => (
          <ClientItem
            key={c.id}
            client={c}
            isActive={currentClient?.id === c.id}
            onClick={() => onSelectClient(c)}
            onLeave={e => onLeaveClient(e, c.id)}
          />
        ))}
      </div>

      {/* Actions principales */}
      <div className="sb-actions">
        <button className="sb-act" onClick={onJoinClient}>
          <UserPlus size={14} /> Rejoindre
        </button>
        <button className="sb-act" onClick={onNewClient}>
          <Plus size={14} /> Créer un client
        </button>
        <button className="sb-act" onClick={onOpenKb}>
          <BookOpen size={14} /> Base de savoir
        </button>
      </div>

      {/* Zone utilisateur */}
      <div className="sb-user">
        <div className="sb-user-av">
          {user?.user_metadata?.full_name
            ? user.user_metadata.full_name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
            : '?'}
        </div>
        <div className="sb-user-info">
          <div className="sb-user-name">
            {user?.user_metadata?.full_name || 'Utilisateur'}
          </div>
          <div className="sb-user-email">{user?.email || ''}</div>
        </div>
        <button className="sb-user-logout" onClick={onLogout} title="Déconnexion">
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}

/** Élément individuel d'un client dans la sidebar */
function ClientItem({ client, isActive, onClick, onLeave }) {
  const initials = client.name.substring(0, 2).toUpperCase();
  return (
    <div className={`cli-item${isActive ? ' on' : ''}`} onClick={onClick}>
      <div className="cli-av">{initials}</div>
      <span className="cli-name">{client.name}</span>
      <span
        className="cli-leave"
        title="Quitter ce client"
        onClick={e => { e.stopPropagation(); onLeave(e); }}
      >
        ×
      </span>
    </div>
  );
}
