/**
 * src/components/chat/ChatInput.jsx — Zone de saisie du chat
 *
 * Contient le textarea, le bouton d'envoi, l'attachement de fichier
 * et le badge du fichier sélectionné.
 *
 * Props :
 * @param {Function} onSend         - Appelée avec (text, fileAttachment)
 * @param {boolean}  disabled       - Désactive le champ pendant l'envoi
 * @param {string}   [id="inp"]     - ID de l'input (pour les raccourcis clavier)
 */
import { useState, useRef } from 'react';
import { Paperclip } from 'lucide-react';

export default function ChatInput({ onSend, disabled = false }) {
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null); // { data, mediaType, name }
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  function handleSend() {
    if (!text.trim() || disabled) return;
    onSend(text.trim(), selectedFile);
    setText('');
    setSelectedFile(null);
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput(e) {
    setText(e.target.value);
    // Auto-resize textarea (max 120px)
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  }

  function handleFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.type)) {
      alert('Format non supporté. PDF, JPG ou PNG uniquement.');
      e.target.value = ''; return;
    }
    if (file.size > 20 * 1024 * 1024) {
      alert('Fichier trop volumineux (max 20 Mo).'); e.target.value = ''; return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = ev.target.result.split(',')[1];
      setSelectedFile({ data: b64, mediaType: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div className="chat-foot">
      {/* Badge fichier sélectionné */}
      {selectedFile && (
        <div className="file-badge-wrap">
          <div className="file-badge">
            <Paperclip size={12} style={{ verticalAlign: '-1px' }} />
            <span className="file-badge-name">{selectedFile.name}</span>
            <button className="file-badge-rem" onClick={() => setSelectedFile(null)}>×</button>
          </div>
        </div>
      )}

      <div className="chat-row">
        <input
          type="file"
          ref={fileInputRef}
          accept=".pdf,.jpg,.jpeg,.png"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
        <button
          className="attach-btn"
          id="attach-btn"
          disabled={!!selectedFile}
          onClick={() => fileInputRef.current?.click()}
          title="Joindre un fichier (PDF, image)"
        >
          <Paperclip size={16} strokeWidth={2} />
        </button>

        <textarea
          ref={textareaRef}
          className="chat-ta"
          id="inp"
          rows={1}
          value={text}
          placeholder="Pose une question, dis ce que tu avances ou sur quoi tu es bloqué…"
          disabled={disabled}
          onChange={handleInput}
          onKeyDown={handleKey}
        />

        <button
          className="send"
          disabled={disabled || !text.trim()}
          onClick={handleSend}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"
            stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 8h12M9 3l5 5-5 5"/>
          </svg>
        </button>
      </div>

      <div className="hint">Entrée pour envoyer · Shift+Entrée pour saut de ligne · PDF ou image acceptés</div>
    </div>
  );
}
