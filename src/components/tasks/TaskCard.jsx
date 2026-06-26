import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { memberStyle } from '../../lib/constants';
import { SCOPE_LABELS, SCOPE_STYLES } from '../../utils/scope';

const STATUS_BORDER = {
  blocked:    '#E24B4A',
  inprogress: '#8B5CF6',
  waiting:    '#EF9F27',
  todo:       '#378ADD',
  done:       '#52b788',
};

export default function TaskCard({
  task, isHighlighted, members, onClick,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}) {
  const [expandedNote, setExpandedNote] = useState(false);
  const [expandedBlocker, setExpandedBlocker] = useState(false);

  const borderColor = STATUS_BORDER[task.status] || STATUS_BORDER.todo;
  const dueBadge = makeDueBadge(task);

  const noteLong = task.note && task.note.length > 120;
  const blockerLong = task.blocker && task.blocker.length > 80;

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

  const assigneeList = (task.assignee || '').split(/[,+\s]+/).map(a => a.trim()).filter(Boolean);

  return (
    <div
      className={`task task-clickable${extraCls}`}
      style={{ borderLeftColor: borderColor }}
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
      <div className="ttl">{task.title}</div>

      {task.blocker && (
        <>
          <div
            className="textra blk-encart"
            style={(!expandedBlocker && blockerLong) ? {
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            } : {}}
          >
            <AlertCircle size={12} style={{ flexShrink: 0 }} />
            {task.blocker}
          </div>
          {blockerLong && (
            <span
              className="note-expand"
              onClick={e => { e.stopPropagation(); setExpandedBlocker(v => !v); }}
            >
              {expandedBlocker ? 'voir moins' : 'voir plus'}
            </span>
          )}
        </>
      )}

      {task.note && (
        <>
          <div
            className="textra note"
            style={{
              whiteSpace: 'pre-wrap',
              ...(!expandedNote && noteLong ? {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              } : {}),
            }}
          >
            {task.note}
          </div>
          {noteLong && (
            <span
              className="note-expand"
              onClick={e => { e.stopPropagation(); setExpandedNote(v => !v); }}
            >
              {expandedNote ? 'voir moins' : 'voir plus'}
            </span>
          )}
        </>
      )}

      <div className="task-meta-row">
        <span className={`prio ${(task.prio || 'P2').toLowerCase()}`}>
          {task.prio || 'P2'}
        </span>

        <span className="task-meta-sep" />

        <div className="tperson">
          {assigneeList.length > 0 ? (
            <div className={assigneeList.length > 1 ? 'av-stack' : ''}>
              {assigneeList.map((a, i) => {
                const st = memberStyle(a);
                const member = (members || []).find(m => m.initials === a);
                return (
                  <div
                    key={a}
                    className="av"
                    style={{
                      background: st.bg,
                      color: st.c,
                      ...(i > 0 ? { marginLeft: '-6px' } : {}),
                      ...(assigneeList.length > 1 ? { border: '1.5px solid var(--sur2)' } : {}),
                    }}
                    title={member?.name || a}
                  >
                    {a.substring(0, 2)}
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="meta-unassigned">non assigné</span>
          )}
        </div>

        {dueBadge && (
          <>
            <span className="task-meta-sep" />
            {dueBadge}
          </>
        )}

        {task.scope && task.scope !== 'internal' && (
          <span style={{
            ...SCOPE_STYLES[task.scope],
            fontSize: '10px', fontWeight: 600, padding: '1px 7px',
            borderRadius: '6px', whiteSpace: 'nowrap',
            marginLeft: 'auto',
          }}>
            {SCOPE_LABELS[task.scope]}
          </span>
        )}
      </div>
    </div>
  );
}

function makeDueBadge(task) {
  if (!task.due_date) return null;
  const due = new Date(task.due_date); due.setHours(23, 59, 59);
  const now = new Date();
  const [, mo, d] = task.due_date.split('-');
  const label = `${d}/${mo}`;
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
