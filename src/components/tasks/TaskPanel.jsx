/**
 * src/components/tasks/TaskPanel.jsx — Panneau droit des tâches
 *
 * Contient le header (titre "To-do" + bouton calendrier), les filtres,
 * et le tableau de tâches. Gère aussi le panneau de redimensionnement.
 *
 * Props :
 * @param {Array}    tasks          - Tâches du client
 * @param {Array}    members        - Membres de l'équipe
 * @param {string}   activeFilter
 * @param {Function} onFilterChange
 * @param {Array}    highlightedIds
 * @param {Function} onTaskClick
 * @param {Function} onTaskReorder
 * @param {Function} onOpenCalendar
 */
import { useEffect, useRef } from 'react';
import { Calendar } from 'lucide-react';
import TaskFilters from './TaskFilters';
import TaskBoard from './TaskBoard';

export default function TaskPanel({
  tasks, members, activeFilter, onFilterChange,
  highlightedIds, onTaskClick, onTaskReorder, onOpenCalendar,
}) {
  const panelRef = useRef(null);
  const resizerRef = useRef(null);

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

  return (
    <>
      <div className="resizer" ref={resizerRef} />
      <div className="todo-panel" ref={panelRef}>
        <div className="todo-head">
          <div className="todo-top">
            <span className="todo-title">To-do</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
    </>
  );
}
