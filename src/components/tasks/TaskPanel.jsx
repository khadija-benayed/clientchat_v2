import { useEffect, useRef, useState } from 'react';
import { Calendar, Plus } from 'lucide-react';
import TaskFilters from './TaskFilters';
import TaskBoard from './TaskBoard';
import Modal from '../shared/Modal';

export default function TaskPanel({
  tasks, members, activeFilter, onFilterChange,
  highlightedIds, onTaskClick, onTaskReorder, onOpenCalendar, onAddTask,
}) {
  const panelRef = useRef(null);
  const resizerRef = useRef(null);

  // Modal "nouvelle tâche"
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStatus, setNewStatus] = useState('todo');
  const [newPrio, setNewPrio] = useState('P2');
  const [newAssignee, setNewAssignee] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newBlocker, setNewBlocker] = useState('');

  // Restaurer la largeur sauvegardée
  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem('cc-todo-w') || '0');
      if (saved >= 240 && saved <= 600 && panelRef.current)
        panelRef.current.style.width = saved + 'px';
    } catch (_) {}
  }, []);

  // Drag resizer
  useEffect(() => {
    const resizer = resizerRef.current;
    const panel = panelRef.current;
    if (!resizer || !panel) return;
    let drag = false, sx = 0, sw = 0;

    const onDown = e => {
      drag = true; sx = e.clientX; sw = panel.offsetWidth;
      resizer.classList.add('dragging');
      document.body.style.cssText += 'cursor:col-resize;user-select:none';
    };
    const onMove = e => {
      if (!drag) return;
      const w = Math.min(600, Math.max(240, sw + (sx - e.clientX)));
      panel.style.width = w + 'px';
    };
    const onUp = () => {
      if (!drag) return; drag = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      try { localStorage.setItem('cc-todo-w', panel.offsetWidth); } catch (_) {}
    };

    resizer.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      resizer.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  function openAddModal() {
    setNewTitle('');
    setNewStatus('todo');
    setNewPrio('P2');
    setNewAssignee('');
    setNewDue('');
    setNewBlocker('');
    setIsAddOpen(true);
  }

  function handleCreate() {
    if (!newTitle.trim()) return;
    onAddTask({
      title: newTitle.trim(),
      status: newStatus,
      prio: newPrio,
      assignee: newAssignee || null,
      due_date: newDue || null,
      blocker: newStatus === 'blocked' ? (newBlocker.trim() || null) : null,
    });
    setIsAddOpen(false);
  }

  const dateInputStyle = {
    marginBottom: 0,
    fontFamily: "'DM Mono', monospace",
    fontSize: '12px',
    padding: '6px 8px',
    width: '100%',
  };

  return (
    <>
      <div className="resizer" ref={resizerRef} />
      <div className="todo-panel" ref={panelRef}>
        <div className="todo-head">
          <div className="todo-top">
            <span className="todo-title">To-do</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                className="btn-add-task"
                onClick={openAddModal}
                title="Nouvelle tâche"
              >
                <Plus size={14} strokeWidth={2.5} />
              </button>
              <button className="btn-cal" onClick={onOpenCalendar} title="Vue calendrier">
                <Calendar size={14} />
              </button>
            </div>
          </div>
          <TaskFilters
            activeFilter={activeFilter}
            onFilterChange={onFilterChange}
            members={members}
            tasks={tasks}
          />
        </div>
        <div className="todo-body" id="tbody">
          <TaskBoard
            tasks={tasks}
            activeFilter={activeFilter}
            members={members}
            highlightedIds={highlightedIds}
            onTaskClick={onTaskClick}
            onTaskReorder={onTaskReorder}
          />
        </div>
      </div>

      <Modal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="Nouvelle tâche"
        maxWidth="460px"
      >
        <div className="new-task-form">
          {/* Titre */}
          <div className="new-task-field">
            <label>Titre</label>
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="De quoi s'agit-il ?"
              autoFocus
              style={{ marginBottom: 0 }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleCreate(); }}
            />
          </div>

          {/* Statut + Priorité + Assigné + Échéance */}
          <div className="task-meta">
            <div>
              <div className="task-meta-label">Statut</div>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{ marginBottom: 0 }}>
                <option value="todo">À faire</option>
                <option value="inprogress">En cours</option>
                <option value="waiting">En attente</option>
                <option value="blocked">Bloqué</option>
                <option value="done">Fait</option>
              </select>
            </div>
            <div>
              <div className="task-meta-label">Priorité</div>
              <select value={newPrio} onChange={e => setNewPrio(e.target.value)} style={{ marginBottom: 0 }}>
                <option value="P1">P1 — Urgent</option>
                <option value="P2">P2 — Normal</option>
                <option value="P3">P3 — Bas</option>
              </select>
            </div>
            <div>
              <div className="task-meta-label">Assigné à</div>
              <select value={newAssignee} onChange={e => setNewAssignee(e.target.value)} style={{ marginBottom: 0 }}>
                <option value="">—</option>
                {members.map(m => (
                  <option key={m.initials} value={m.initials}>
                    {m.initials} — {m.name || m.initials}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="task-meta-label">Échéance</div>
              <input
                type="date"
                value={newDue}
                onChange={e => setNewDue(e.target.value)}
                style={dateInputStyle}
              />
            </div>
          </div>

          {/* Blocage (affiché si statut = bloqué) */}
          {newStatus === 'blocked' && (
            <div className="new-task-field">
              <label>Raison du blocage</label>
              <input
                type="text"
                value={newBlocker}
                onChange={e => setNewBlocker(e.target.value)}
                placeholder="Qu'est-ce qui bloque ?"
                style={{ marginBottom: 0 }}
              />
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-sec" onClick={() => setIsAddOpen(false)}>
            Annuler
          </button>
          <button
            className="btn"
            style={{ width: 'auto' }}
            disabled={!newTitle.trim()}
            onClick={handleCreate}
          >
            Créer la tâche
          </button>
        </div>
      </Modal>
    </>
  );
}
