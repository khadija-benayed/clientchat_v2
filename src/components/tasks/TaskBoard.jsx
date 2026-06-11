/**
 * src/components/tasks/TaskBoard.jsx — Tableau des tâches groupées par statut
 *
 * Affiche les tâches filtrées, groupées par statut (Bloqué, En cours, etc.).
 * Gère le drag & drop (réordonnancement) et le clic pour ouvrir une tâche.
 *
 * Props :
 * @param {Array}    tasks           - Toutes les tâches du client
 * @param {string}   activeFilter    - Filtre actif
 * @param {Array}    members         - Membres pour les avatars
 * @param {Array}    highlightedIds  - IDs à animer (nouveau/modifié)
 * @param {Function} onTaskClick     - Ouvre le modal tâche (id)
 * @param {Function} onTaskReorder   - Appelée avec les tâches réordonnées
 */
import { useState, useRef } from 'react';
import TaskCard from './TaskCard';

const SECTIONS = [
  { k: 'blocked',    l: 'Bloqué',      c: '#E24B4A' },
  { k: 'inprogress', l: 'En cours',    c: '#8B5CF6' },
  { k: 'waiting',    l: 'En attente',  c: '#EF9F27' },
  { k: 'todo',       l: 'À faire',     c: '#378ADD' },
  { k: 'done',       l: 'Fait',        c: '#52b788' },
];

export default function TaskBoard({ tasks, activeFilter, members, highlightedIds = [], onTaskClick, onTaskReorder }) {
  const [searchQuery, setSearchQuery] = useState('');
  const dragIdRef = useRef(null);
  const memberInitials = members.map(m => m.initials);

  // Filtrage
  const filtered = tasks.filter(t => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'external') return t.scope === 'external';
    if (activeFilter === 'deadline') {
      if (!t.due_date || t.status === 'done') return false;
      const due = new Date(t.due_date); due.setHours(23, 59, 59);
      return (due - new Date()) / (1000 * 60 * 60 * 24) <= 7;
    }
    if (memberInitials.includes(activeFilter))
      return (t.assignee || '').split(/[,+\s]+/).map(a => a.trim()).includes(activeFilter);
    return t.status === activeFilter;
  }).filter(t =>
    !searchQuery ||
    t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.note || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.assignee || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  function handleDragStart(e, taskId) {
    dragIdRef.current = taskId;
    setTimeout(() => e.target.closest('.task')?.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnd(e) {
    e.target.closest('.task')?.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    dragIdRef.current = null;
  }

  function handleDragOver(e, taskId) {
    e.preventDefault();
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (taskId !== dragIdRef.current) {
      e.target.closest('.task')?.classList.add('drag-over');
    }
  }

  function handleDragLeave(e) {
    e.target.closest('.task')?.classList.remove('drag-over');
  }

  function handleDrop(e, targetId) {
    e.preventDefault();
    const fromId = dragIdRef.current;
    if (!fromId || fromId === targetId) return;
    const fromIdx = tasks.findIndex(t => t.id === fromId);
    const toIdx   = tasks.findIndex(t => t.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const newTasks = [...tasks];
    const [moved] = newTasks.splice(fromIdx, 1);
    newTasks.splice(toIdx, 0, moved);
    onTaskReorder(newTasks);
    dragIdRef.current = null;
  }

  const taskCount = filtered.length;

  return (
    <>
      {/* Compteur et barre de recherche */}
      <div style={{ padding: '0 12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="todo-cnt" id="tcnt">
          {taskCount} tâche{taskCount !== 1 ? 's' : ''}
        </span>
      </div>

      <input
        className="todo-search"
        id="todo-search"
        type="text"
        placeholder="Rechercher une tâche…"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        autoComplete="off"
      />

      {/* Groupes par statut */}
      {filtered.length === 0 ? (
        <div style={{ padding: '16px 20px 8px', color: 'var(--tx3)', fontSize: '13px', textAlign: 'center' }}>
          Aucune tâche
        </div>
      ) : (
        SECTIONS.map(s => {
          const items = filtered.filter(t => t.status === s.k);
          if (!items.length) return null;
          return (
            <div key={s.k} className="grp">
              <div className="grp-lbl">
                <span className="gdot" style={{ background: s.c }} />
                {s.l}
                <span style={{ opacity: .6, fontWeight: 400 }}>({items.length})</span>
              </div>
              {items.map(t => (
                <TaskCard
                  key={t.id}
                  task={t}
                  isHighlighted={highlightedIds.includes(t.id)}
                  members={members}
                  onClick={() => onTaskClick(t.id)}
                  onDragStart={e => handleDragStart(e, t.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={e => handleDragOver(e, t.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, t.id)}
                />
              ))}
            </div>
          );
        })
      )}
    </>
  );
}
