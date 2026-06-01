/**
 * src/components/knowledge/KnowledgeBase.jsx — Base de savoir (KB)
 *
 * Deux modals en un fichier :
 * 1. KbSaveModal  — Sauvegarder un insight depuis un message du chat
 * 2. KbBrowser    — Naviguer/rechercher dans tous les insights sauvegardés
 *
 * Props KbSaveModal :
 * @param {boolean}  isOpen
 * @param {Function} onClose
 * @param {string}   initialText - Texte pré-rempli (message du chat)
 * @param {object}   client      - Client courant (pour source_client)
 * @param {string}   jwtToken
 *
 * Props KbBrowser :
 * @param {boolean}  isOpen
 * @param {Function} onClose
 */
import { useState, useEffect } from 'react';
import Modal from '../shared/Modal';
import { callBackend } from '../../lib/backend';
import supabase from '../../lib/supabase';

// ── Modal de sauvegarde d'un insight ─────────────────────────────────────────

export function KbSaveModal({ isOpen, onClose, initialText, client, jwtToken }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle(''); setContent(initialText || ''); setTags(''); setError('');
    }
  }, [isOpen, initialText]);

  async function save() {
    if (!title.trim()) { setError('Le titre est obligatoire.'); return; }
    if (!content.trim()) { setError('Le contenu est obligatoire.'); return; }
    setError(''); setSaving(true);
    try {
      const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      let members = [];
      try { members = JSON.parse(client?.members || '[]'); } catch {}
      const savedBy = members[0]?.initials || '';
      await callBackend({
        action: 'save_to_kb', title: title.trim(), content: content.trim(),
        source_client: client?.name || null, tags: tagList, saved_by: savedBy,
      }, jwtToken);
      onClose();
    } catch (e) { setError('Erreur : ' + e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sauvegarder dans la base de savoir" maxWidth="480px">
      <label>Titre</label>
      <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex : Approche SEO Décathlon" />
      <label>Contenu</label>
      <textarea value={content} onChange={e => setContent(e.target.value)}
        style={{ minHeight: '100px', fontFamily: "'DM Mono', monospace", fontSize: '12px' }} />
      <label>Tags (séparés par des virgules)</label>
      <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="Ex : SEO, stratégie, technique" />
      {error && <div className="err" style={{ marginBottom: '8px' }}>{error}</div>}
      <div className="modal-foot">
        <button className="btn btn-sec" onClick={onClose}>Annuler</button>
        <button className="btn" style={{ width: 'auto' }} disabled={saving} onClick={save}>
          {saving ? '…' : 'Sauvegarder'}
        </button>
      </div>
    </Modal>
  );
}

// ── Navigateur de la base de savoir ──────────────────────────────────────────

export function KbBrowser({ isOpen, onClose }) {
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) { setSearch(''); loadEntries(); }
  }, [isOpen]);

  async function loadEntries() {
    setLoading(true);
    const { data } = await supabase.from('agency_knowledge').select('*').order('created_at', { ascending: false });
    setEntries(data || []);
    setLoading(false);
  }

  async function deleteEntry(id) {
    if (!confirm('Supprimer cet insight ?')) return;
    const { error } = await supabase.from('agency_knowledge').delete().eq('id', id);
    if (error) { alert('Erreur : ' + error.message); return; }
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  const q = search.toLowerCase();
  const filtered = entries.filter(e =>
    !q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) ||
    (e.tags || []).some(t => t.toLowerCase().includes(q))
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Base de savoir" maxWidth="600px">
      <input type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Rechercher…" style={{ marginBottom: '12px' }} />
      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {loading ? (
          <div style={{ color: 'var(--tx3)', fontSize: '13px' }}>Chargement…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--tx3)', fontSize: '13px' }}>
            {q ? 'Aucun résultat.' : 'Aucun insight sauvegardé pour le moment.'}
          </div>
        ) : filtered.map(e => {
          const date = new Date(e.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
          return (
            <div key={e.id} className="kb-entry">
              <div className="kb-entry-title">{e.title}</div>
              <div className="kb-entry-content">{e.content}</div>
              <div className="kb-entry-meta">
                {e.saved_by && <span>{e.saved_by}</span>}
                <span>{date}</span>
                {e.source_client && <span>{e.source_client}</span>}
                {(e.tags || []).map(t => <span key={t} className="kb-tag">{t}</span>)}
                <button className="kb-del" onClick={() => deleteEntry(e.id)}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="modal-foot">
        <button className="btn btn-sec" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
