/**
 * src/components/tasks/TaskModal.jsx — Modal de détail d'une tâche
 *
 * Permet de modifier tous les champs d'une tâche :
 * titre, statut, priorité, assignee, échéance, blocage, notes horodatées.
 */
import { useState, useEffect } from 'react';
import Modal from '../shared/Modal';

export default function TaskModal({ taskId, tasks, members, onSave, onDelete, onClose }) {
  const task = tasks.find(t => t.id === taskId);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('todo');
  const [prio, setPrio] = useState('P2');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [blocker, setBlocker] = useState('');
  const [noteInput, setNoteInput] = useState('');

  useEffect(() => {
    if (task) {
      setTitle(task.title || '');
      setStatus(task.status || 'todo');
      setPrio(task.prio || 'P2');
      setAssignee(task.assignee || '');
      setDue(task.due_date || '');
      setBlocker(task.blocker || '');
    }
  }, [taskId]); // eslint-disable-line

  if (!task) return null;

  function parseNotes(noteStr) {
    if (!noteStr) return [];
    return noteStr.split('\n').filter(Boolean).map(line => {
      const m = line.match(/^(\d{2}\/\d{2}(?:\s+\d{2}:\d{2})?)\s+—\s+(.+)$/);
      return m ? { date: m[1], text: m[2] } : { date: '', text: line };
    });
  }

  const notes = parseNotes(task.note);

  function addNote() {
    if (!noteInput.trim()) return;
    const now = new Date();
    const ts = now.toLocaleDateString('fr', { day: '2-digit', month: '2-digit' })
      + ' ' + now.toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' });
    const newNote = ts + ' — ' + noteInput.trim();
    onSave({ ...task, note: task.note ? task.note + '\n' + newNote : newNote });
    setNoteInput('');
  }

  function deleteNote(idx) {
    const lines = (task.note || '').split('\n').filter(Boolean);
    lines.splice(idx, 1);
    onSave({ ...task, note: lines.join('\n') || null });
  }

  function save() {
    const newTitle = title.trim() || task.title;
    const newDue = due || null;
    const newBlocker = status === 'blocked' ? (blocker.trim() || null) : null;
    const unchanged =
      newTitle === task.title &&
      status === task.status &&
      prio === task.prio &&
      assignee === (task.assignee || '') &&
      newDue === (task.due_date || null) &&
      newBlocker === (task.blocker || null);
    if (!unchanged) {
      onSave({ ...task, title: newTitle, status, prio, assignee, due_date: newDue, blocker: newBlocker });
    }
    onClose();
  }

  return (
    <Modal isOpen={true} onClose={onClose} maxWidth="520px">
      <div className="task-modal-head">
        <input type="text" value={title} onChange={e => setTitle(e.target.value)}
          style={{ fontSize: '16px', fontWeight: 500, border: 'none', borderBottom: '1px solid var(--brd2)', borderRadius: 0, padding: '4px 0', background: 'transparent', flex: 1, marginBottom: 0 }} />
        <button className="task-modal-del" onClick={() => { if (confirm(`Supprimer "${task.title}" ?`)) { onDelete(task.id); onClose(); } }}>Supprimer</button>
      </div>

      <div className="task-meta">
        <div>
          <div className="task-meta-label">Statut</div>
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ marginBottom: 0 }}>
            <option value="todo">À faire</option>
            <option value="inprogress">En cours</option>
            <option value="waiting">En attente</option>
            <option value="blocked">Bloqué</option>
            <option value="done">Fait</option>
          </select>
        </div>
        <div>
          <div className="task-meta-label">Priorité</div>
          <select value={prio} onChange={e => setPrio(e.target.value)} style={{ marginBottom: 0 }}>
            <option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
          </select>
        </div>
        <div>
          <div className="task-meta-label">Assigné à</div>
          <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ marginBottom: 0 }}>
            <option value="">—</option>
            {members.map(m => <option key={m.initials} value={m.initials}>{m.initials} — {m.name || m.initials}</option>)}
          </select>
        </div>
        <div>
          <div className="task-meta-label">Échéance</div>
          <input type="date" value={due} onChange={e => setDue(e.target.value)} style={{ marginBottom: 0, fontFamily: "'DM Mono', monospace", fontSize: '12px', padding: '6px 8px', border: '1px solid var(--brd2)', borderRadius: 'var(--rs)', background: 'var(--sur2)', color: 'var(--tx)', width: '100%' }} />
        </div>
      </div>

      {status === 'blocked' && (
        <div>
          <div className="task-meta-label">Blocage</div>
          <input type="text" value={blocker} onChange={e => setBlocker(e.target.value)} placeholder="Raison du blocage…" style={{ marginBottom: '14px' }} />
        </div>
      )}

      <div className="notes-section">
        <div className="notes-label">Notes & commentaires</div>
        <div className="notes-list">
          {notes.length === 0
            ? <div style={{ fontSize: '12px', color: 'var(--tx3)', fontStyle: 'italic' }}>Aucune note pour l'instant.</div>
            : notes.map((n, i) => (
              <div key={i} className="note-entry">
                <button className="note-del" onClick={() => deleteNote(i)}>×</button>
                {n.date && <div className="note-entry-date">{n.date}</div>}
                <div className="note-entry-text">{n.text}</div>
              </div>
            ))
          }
        </div>
        <div className="note-add">
          <textarea value={noteInput} onChange={e => setNoteInput(e.target.value)}
            placeholder="Ajouter une note…"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); } }}
            style={{ marginBottom: 0 }} />
          <button className="note-add-btn" onClick={addNote}>Ajouter</button>
        </div>
      </div>

      <div className="modal-foot">
        <button className="btn btn-sec" onClick={onClose}>Fermer</button>
        <button className="btn" style={{ width: 'auto' }} onClick={save}>Enregistrer</button>
      </div>
    </Modal>
  );
}
