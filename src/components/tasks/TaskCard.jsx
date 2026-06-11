/**
 * src/components/tasks/TaskCard.jsx — Carte d'une tâche individuelle
 *
 * Affiche les informations d'une tâche : titre, priorité, assignee,
 * statut, note, blocage et badge d'échéance.
 *
 * Supporte le drag & drop HTML5 natif (pas de bibliothèque externe).
 * Les handlers drag sont passés par le parent TaskBoard.
 *
 * Props :
 * @param {object}   task         - Objet tâche (id, title, prio, status…)
 * @param {boolean}  isHighlighted - Animation "new" après création
 * @param {Array}    members       - Membres de l'équipe pour les avatars
 * @param {Function} onClick       - Ouvre le modal de détail
 * @param {Function} onDragStart
 * @param {Function} onDragEnd
 * @param {Function} onDragOver
 * @param {Function} onDragLeave
 * @param {Function} onDrop
 */
import { memberStyle } from '../../lib/constants';
import { SCOPE_LABELS, SCOPE_STYLES } from '../../utils/scope';

const STATUS_CLASS = {
  todo: 's-todo', inprogress: 's-inp', blocked: 's-blk',
  waiting: 's-wait', done: 's-done',
};
const STATUS_LABEL = {
  todo: 'à faire', inprogress: 'en cours', blocked: 'bloqué',
  waiting: 'en attente', done: 'fait',
};

export default function TaskCard({
  task, isHighlighted, members, onClick,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}) {
  const sc = STATUS_CLASS[task.status] || 's-todo';
  const sl = STATUS_LABEL[task.status] || task.status;

  // Calcul du badge d'échéance
  const dueBadge = makeDueBadge(task);

  // Calcul des classes CSS supplémentaires
  const now = new Date();
  const due = task.due_date ? new Date(task.due_date + 'T23:59:59') : null;
  const isOverdue = due && task.status !== 'done' && due < now;
  const isDoneLate = due && task.status === 'done' && due < now;
  const isP1 = (task.prio || 'P2') === 'P1';

  let extraCls = '';
  if (isHighlighted) extraCls += ' new';
  if (isOverdue) extraCls += ' overdue';
  if (isP1 && task.status !== 'done') extraCls += ' p1-urgent';
  if (isDoneLate) extraCls += ' done-late';

  // Assignees → avatars
  const assigneeList = (task.assignee || '').split(/[,+\s]+/).map(a => a.trim()).filter(Boolean);
  const assigneeLabel = assigneeList.join(' + ') || '—';

  return (
    <div
      className={`task task-clickable${extraCls}`}
      draggable
      data-id={task.id}
      data-status={task.status}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="t1">
        <span className={`prio ${(task.prio || 'P2').toLowerCase()}`}>
          {task.prio || 'P2'}
        </span>
        <span className="ttl">{task.title}</span>
        {dueBadge}
      </div>
      {task.blocker && (
        <div className="textra blk">Blocage : {task.blocker}</div>
      )}
      {task.note && (
        <div className="textra note" style={{ whiteSpace: 'pre-wrap' }}>{task.note}</div>
      )}
      <div className="t2">
        <div className="tperson">
          {assigneeList.length > 0
            ? assigneeList.map(a => {
                const st = memberStyle(a);
                return (
                  <div key={a} className="av" style={{ background: st.bg, color: st.c }}>
                    {a.substring(0, 2)}
                  </div>
                );
              })
            : <div className="av" style={{ background: 'var(--sur2)', color: 'var(--tx3)' }}>?</div>
          }
          <span>{assigneeLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {task.scope && task.scope !== 'internal' && (
            <span style={{
              ...SCOPE_STYLES[task.scope],
              fontSize: '10px', fontWeight: 600, padding: '1px 7px',
              borderRadius: '6px', whiteSpace: 'nowrap',
            }}>
              {SCOPE_LABELS[task.scope]}
            </span>
          )}
          <span className={`spill ${sc}`}>{sl}</span>
        </div>
      </div>
    </div>
  );
}

function makeDueBadge(task) {
  if (!task.due_date) return null;
  const due = new Date(task.due_date); due.setHours(23, 59, 59);
  const now = new Date();
  const [y, mo, d] = task.due_date.split('-');
  const label = `${d}/${mo}/${y}`;
  if (task.status === 'done') {
    return due < now
      ? <span key="db" className="due-badge done-late-badge">✓ {label}</span>
      : null;
  }
  const diff = (due - now) / (1000 * 60 * 60 * 24);
  if (diff < 0)  return <span key="db" className="due-badge overdue">⚠ {label}</span>;
  if (diff <= 7) return <span key="db" className="due-badge soon">⏳ {label}</span>;
  return <span key="db" className="due-badge ok">📅 {label}</span>;
}
