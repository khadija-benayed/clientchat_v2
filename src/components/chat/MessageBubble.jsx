/**
 * src/components/chat/MessageBubble.jsx — Bulle d'un message individuel
 *
 * Affiche un message utilisateur ou assistant avec :
 * - La bulle de texte
 * - Les sources RAG dépliables
 * - Le bouton "+ KB" pour sauvegarder dans la base de savoir
 * - Le badge de modification de tâches
 * - L'horodatage
 *
 * Props :
 * @param {object}   msg         - Message { id, role, text, sources, badge, time }
 * @param {string}   clientName  - Nom du client (affiché dans "Claude · NomClient")
 * @param {Function} onSaveToKb  - Appelée avec le texte pour ouvrir la modal KB
 */
import { useState } from 'react';
import { Layers, ChevronDown } from 'lucide-react';

// Icônes des types de sources
function SourceIcon({ type }) {
  if (type === 'email_summary') return <span>📧</span>;
  if (type === 'session') return <span style={{ fontSize: '12px' }}>🕐</span>;
  return <span style={{ fontSize: '12px' }}>📂</span>;
}

function formatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return hm;
  if (d.toDateString() === yesterday.toDateString()) return 'Hier ' + hm;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}

export default function MessageBubble({ msg, clientName, onSaveToKb }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [kbSaved, setKbSaved] = useState(false);

  const isUser = msg.role === 'u';
  const sources = msg.sources || [];
  // Dédupliquer les sources par nom
  const uniqueSources = sources.filter((s, i, arr) =>
    arr.findIndex(x => x.source_name === s.source_name) === i
  );

  return (
    <div className={`msg ${isUser ? 'u' : 'a'}`}>
      {/* En-tête "Claude · NomClient" pour les messages assistant */}
      {!isUser && (
        <div className="msg-who">Claude · {clientName || ''}</div>
      )}

      {/* Badge fichier attaché */}
      {msg.file && (
        <div className="msg-file-badge">
          📎 {msg.file.name}
        </div>
      )}

      {/* Bulle de texte */}
      <div className="bubble">{msg.text}</div>

      {/* Badge modification de tâches */}
      {msg.badge && (
        <div className="msg-badge">{msg.badge}</div>
      )}

      {/* Sources RAG dépliables */}
      {!isUser && uniqueSources.length > 0 && (
        <div className="msg-sources">
          <button
            className="msg-sources-toggle"
            onClick={() => setSourcesOpen(!sourcesOpen)}
          >
            <Layers size={11} />
            {' '}{uniqueSources.length} source{uniqueSources.length > 1 ? 's' : ''}
            {' '}<ChevronDown
              size={11}
              style={{ transition: 'transform .15s', transform: sourcesOpen ? 'rotate(180deg)' : '' }}
            />
          </button>
          <div className={`msg-sources-list${sourcesOpen ? ' open' : ''}`}>
            {uniqueSources.map((s, i) => (
              <div key={i} className="msg-source-item">
                <div className="src-name">
                  <SourceIcon type={s.source_type} />
                  {s.source_name || 'Fichier sans nom'}
                </div>
                {s.preview && (
                  <div className="src-preview">{s.preview}…</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bouton "+ KB" pour messages assistant */}
      {!isUser && msg.text && (
        <button
          className={`kb-btn${kbSaved ? ' saved' : ''}`}
          disabled={kbSaved}
          onClick={() => { onSaveToKb?.(msg.text); }}
        >
          {kbSaved ? '✓ KB' : '+ KB'}
        </button>
      )}

      <div className="msg-time">{formatTime(msg.time)}</div>
    </div>
  );
}
