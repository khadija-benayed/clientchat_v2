/**
 * src/components/tasks/CalendarModal.jsx — Calendrier des échéances
 */
import { useState } from 'react';
import Modal from '../shared/Modal';

const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const JOURS  = ['L','M','M','J','V','S','D'];

export default function CalendarModal({ tasks, onTaskClick, onClose }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [dayTasks, setDayTasks] = useState([]);
  const [dayLabel, setDayLabel] = useState('');

  function nav(dir) {
    let m = month + dir, y = year;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setMonth(m); setYear(y); setDayTasks([]); setDayLabel('');
  }

  const taskMap = {};
  tasks.forEach(t => { if (t.due_date && t.status !== 'done') (taskMap[t.due_date] = taskMap[t.due_date] || []).push(t); });
  const today   = new Date().toISOString().slice(0, 10);
  const lastDay = new Date(year, month + 1, 0).getDate();
  let startDow  = new Date(year, month, 1).getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  function dayClick(ds) {
    const dt = tasks.filter(t => t.due_date === ds && t.status !== 'done');
    if (!dt.length) return;
    setDayLabel(new Date(ds + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
    setDayTasks(dt);
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Calendrier des échéances" maxWidth="360px">
      <div className="cal-nav">
        <button onClick={() => nav(-1)}>‹</button>
        <span>{MONTHS[month]} {year}</span>
        <button onClick={() => nav(1)}>›</button>
      </div>
      <div className="cal-grid">
        {JOURS.map(j => <div key={j} className="cal-dow">{j}</div>)}
        {Array.from({ length: startDow }, (_, i) => <div key={'e' + i} className="cal-empty" />)}
        {Array.from({ length: lastDay }, (_, i) => {
          const d = i + 1;
          const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const isToday = ds === today, isPast = ds < today;
          const dt = taskMap[ds] || [];
          const cls = ['cal-cell', isToday ? 'cal-today' : '', isPast && dt.length ? 'cal-overdue' : '', dt.length ? 'cal-has-tasks' : ''].filter(Boolean).join(' ');
          const dots = dt.map((t, ti) => {
            const c = t.prio === 'P1' ? 'var(--red)' : t.prio === 'P3' ? 'var(--sb-blue-md)' : 'var(--amb)';
            return <span key={ti} className="cal-dot" style={{ background: c }} />;
          });
          return (
            <div key={d} className={cls} onClick={() => dayClick(ds)}>
              {d}{dots.length > 0 && <div className="cal-dots">{dots}</div>}
            </div>
          );
        })}
      </div>
      {dayTasks.length > 0 && (
        <div>
          <div className="cal-day-label">{dayLabel}</div>
          {dayTasks.map(t => (
            <div key={t.id} className="cal-task-item" onClick={() => onTaskClick(t.id)}>
              <span className={`prio ${(t.prio || 'P2').toLowerCase()}`}>{t.prio || 'P2'}</span>
              <span>{t.title}</span>
            </div>
          ))}
        </div>
      )}
      <div className="modal-foot">
        <button className="btn btn-sec" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
