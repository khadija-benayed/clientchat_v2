/**
 * src/components/tasks/TaskFilters.jsx — Filtres de la liste de tâches
 *
 * Boutons de filtre : Tout / Bloqué / En cours / etc. + membres de l'équipe.
 * Calcule aussi si le filtre "Cette semaine" doit être affiché.
 *
 * Props :
 * @param {string}   activeFilter   - Filtre actif ('all', 'blocked', initiale…)
 * @param {Function} onFilterChange - Appelée avec la nouvelle valeur du filtre
 * @param {Array}    members        - Membres de l'équipe
 * @param {Array}    tasks          - Tâches (pour compter les échéances proches)
 */
export default function TaskFilters({ activeFilter, onFilterChange, members, tasks }) {
  const statuses = [
    { k: 'all', l: 'Tout' },
    { k: 'blocked', l: 'Bloqué' },
    { k: 'inprogress', l: 'En cours' },
    { k: 'waiting', l: 'En attente' },
    { k: 'todo', l: 'À faire' },
    { k: 'done', l: 'Fait' },
  ];

  // Calcule les tâches avec échéance dans les 7 prochains jours
  const dueSoonCount = tasks.filter(t => {
    if (!t.due_date || t.status === 'done') return false;
    const due = new Date(t.due_date); due.setHours(23, 59, 59);
    return (due - new Date()) / (1000 * 60 * 60 * 24) <= 7;
  }).length;
  const externalCount = tasks.filter(t => t.scope === 'external').length;

  return (
    <div className="filters" id="frow">
      {statuses.map(s => (
        <button
          key={s.k}
          className={`fil${activeFilter === s.k ? ' on' : ''}`}
          onClick={() => onFilterChange(s.k)}
        >
          {s.l}
        </button>
      ))}

      {/* Filtres par membre */}
      {members.map(m => (
        <button
          key={m.initials}
          className={`fil${activeFilter === m.initials ? ' on' : ''}`}
          onClick={() => onFilterChange(m.initials)}
        >
          {m.initials}
        </button>
      ))}

      {externalCount > 0 && (
        <button
          className={`fil${activeFilter === 'external' ? ' on' : ''}`}
          data-f="external"
          onClick={() => onFilterChange('external')}
        >
          Externe ({externalCount})
        </button>
      )}

      {/* Filtre "Cette semaine" — affiché seulement si des tâches sont proches */}
      {dueSoonCount > 0 && (
        <button
          className={`fil${activeFilter === 'deadline' ? ' on' : ''}`}
          data-f="deadline"
          onClick={() => onFilterChange('deadline')}
        >
          ⏰ Cette semaine ({dueSoonCount})
        </button>
      )}
    </div>
  );
}
