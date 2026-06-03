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
import React, { useState } from 'react';
import { Layers } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

const mdComponents = {
  p: ({ children }) => {
    const processText = (child) => {
      if (typeof child !== 'string') return child;
      const parts = child.split(/(\[[^\]]+\])/g);
      return parts.map((part, i) =>
        /^\[[^\]]+\]$/.test(part)
          ? <span key={i} className="md-cite">{part}</span>
          : part
      );
    };
    return <p>{React.Children.map(children, processText)}</p>;
  },
  code: ({ inline, children }) =>
    inline
      ? <code className="md-code">{children}</code>
      : <pre className="md-pre"><code>{children}</code></pre>,
};

export default function MessageBubble({ msg, clientName, onSaveToKb }) {
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
      <div className="bubble">
        {isUser
          ? msg.text
          : <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={mdComponents}
            >
              {msg.text}
            </ReactMarkdown>
        }
      </div>

      {/* Badge modification de tâches */}
      {msg.badge && (
        <div className="msg-badge">{msg.badge}</div>
      )}

      {/* Sources RAG */}
      {!isUser && uniqueSources.length > 0 && (
        <div className="msg-sources">
          <div className="msg-sources-label">
            <Layers size={10} /> Sources
          </div>
          <div className="msg-sources-chips">
            {uniqueSources.map((s, i) => (
              <span
                key={i}
                className="src-chip"
                title={[s.source_name, s.preview ? s.preview + '…' : ''].filter(Boolean).join('\n\n')}
              >
                <SourceIcon type={s.source_type} />
                <span>{(s.source_name || 'Fichier').replace(/\.[^.]+$/, '')}</span>
              </span>
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
