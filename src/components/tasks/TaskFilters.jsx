import { useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import { memberStyle } from '../../lib/constants';

export default function TaskFilters({ activeFilter, onFilterChange, members, tasks }) {
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem('cc-filters-expanded') !== 'false'; }
    catch { return true; }
  });

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    try { localStorage.setItem('cc-filters-expanded', String(next)); } catch {}
  };

  const statuses = [
    { k: 'all',        l: 'Tout' },
    { k: 'blocked',    l: 'Bloqué' },
    { k: 'inprogress', l: 'En cours' },
    { k: 'waiting',    l: 'En attente' },
    { k: 'todo',       l: 'À faire' },
    { k: 'done',       l: 'Fait' },
  ];

  const dueSoonCount = tasks.filter(t => {
    if (!t.due_date || t.status === 'done') return false;
    const due = new Date(t.due_date); due.setHours(23, 59, 59);
    return (due - new Date()) / (1000 * 60 * 60 * 24) <= 7;
  }).length;
  const externalCount = tasks.filter(t => t.scope === 'external').length;

  const hasSecondaryContent = members.length > 0 || dueSoonCount > 0 || externalCount > 0;
  const hasChips = dueSoonCount > 0 || externalCount > 0;

  return (
    <div className="filters" id="frow">
      <div className="filter-row-primary">
        {statuses.map(s => (
          <button
            key={s.k}
            className={`fil${activeFilter === s.k ? ' on' : ''}`}
            onClick={() => onFilterChange(s.k)}
          >
            {s.l}
          </button>
        ))}
      </div>

      {hasSecondaryContent && (
        <div className="filter-row-secondary">
          <button
            className={`fil-toggle${expanded ? ' open' : ''}`}
            onClick={toggleExpanded}
            title={expanded ? 'Masquer les filtres' : 'Plus de filtres'}
          >
            <ChevronDown size={12} />
          </button>

          {expanded && (
            <>
              {members.length > 0 && <span className="fil-divider" />}

              {members.map(m => {
                const isActive = activeFilter === m.initials;
                const st = memberStyle(m.initials);
                return (
                  <button
                    key={m.initials}
                    className={`fil-avatar${isActive ? ' on' : ''}`}
                    onClick={() => onFilterChange(m.initials)}
                    title={m.name || m.initials}
                    style={{ background: st.bg, color: st.c }}
                  >
                    {m.initials}
                  </button>
                );
              })}

              {hasChips && (members.length > 0 || true) && <span className="fil-divider" />}

              {dueSoonCount > 0 && (
                <button
                  className={`fil-chip${activeFilter === 'deadline' ? ' on' : ''}`}
                  onClick={() => onFilterChange('deadline')}
                >
                  <Clock size={11} />
                  Cette semaine ({dueSoonCount})
                </button>
              )}

              {externalCount > 0 && (
                <button
                  className={`fil-chip${activeFilter === 'external' ? ' on' : ''}`}
                  onClick={() => onFilterChange('external')}
                >
                  Externe ({externalCount})
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
