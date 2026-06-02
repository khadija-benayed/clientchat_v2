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
import { Layers } from 'lucide-react';

// ── Markdown renderer ─────────────────────────────────────────────────────────
// Handles what Gemini 2.5 Flash actually outputs: bold, italic, inline code,
// ordered/bullet lists, and [citation] tags. No external dependency needed.

function parseInline(text, baseKey) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\](?!\()/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) parts.push(<strong key={baseKey + m.index}>{m[1]}</strong>);
    else if (m[2] !== undefined) parts.push(<em key={baseKey + m.index}>{m[2]}</em>);
    else if (m[3] !== undefined) parts.push(<code key={baseKey + m.index} className="md-code">{m[3]}</code>);
    else if (m[4] !== undefined) parts.push(<span key={baseKey + m.index} className="md-cite">[{m[4]}]</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.flatMap((p, i) =>
    typeof p !== 'string' ? p :
    p.split('\n').flatMap((seg, j, arr) =>
      j < arr.length - 1 ? [seg, <br key={`${baseKey}-${i}-${j}`} />] : [seg]
    )
  );
}

function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const result = [];
  let i = 0, key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\d+\.\s+/, ''));
      result.push(<ol key={key++}>{items.map((t, j) => <li key={j}>{parseInline(t, key * 1000 + j)}</li>)}</ol>);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^[-*]\s+/, ''));
      result.push(<ul key={key++}>{items.map((t, j) => <li key={j}>{parseInline(t, key * 1000 + j)}</li>)}</ul>);
      continue;
    }
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !/^\d+\.\s+/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]))
      paraLines.push(lines[i++]);
    if (paraLines.length) result.push(<p key={key++}>{parseInline(paraLines.join('\n'), key * 1000)}</p>);
  }
  return result.length ? result : text;
}

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
      <div className="bubble">{isUser ? msg.text : renderMarkdown(msg.text)}</div>

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
