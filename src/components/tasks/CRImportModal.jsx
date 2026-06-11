import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Modal from '../shared/Modal';
import { callBackend } from '../../lib/backend';

const MATCH_LABELS = { update_existing: 'MAJ', new: 'Nouvelle', uncertain: 'Incertain' };
const MATCH_STYLES = {
  update_existing: { background: 'var(--c-blue-bg)', color: 'var(--c-blue)' },
  new:             { background: 'var(--c-green-bg)', color: 'var(--c-green)' },
  uncertain:       { background: 'var(--c-amb-bg)', color: 'var(--c-amb)' },
};
import { SCOPE_LABELS, SCOPE_STYLES } from '../../utils/scope';

export default function CRImportModal({
  isOpen, onClose, currentClient, members, tasks, jwtToken, onApply,
}) {
  const [step, setStep] = useState('input');
  const [crText, setCrText] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [proposals, setProposals] = useState([]);

  function reset() {
    setStep('input');
    setCrText('');
    setLoading(false);
    setErr(null);
    setProposals([]);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function analyse() {
    if (!crText.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await callBackend({
        action: 'propose_cr_tasks',
        client_id: currentClient.id,
        cr_text: crText,
      }, jwtToken);
      const items = (data.items || []).map(item => ({
        ...item,
        selected: item.confidence >= 0.65 && !item.needs_clarification,
      }));
      setProposals(items);
      setStep('review');
    } catch (e) {
      setErr(e.message || 'Erreur lors de l\'analyse');
    } finally {
      setLoading(false);
    }
  }

  function toggle(idx) {
    setProposals(prev => prev.map((p, i) => i === idx ? { ...p, selected: !p.selected } : p));
  }

  function updateField(idx, field, value) {
    setProposals(prev =>
      prev.map((p, i) => i === idx ? { ...p, fields: { ...p.fields, [field]: value || null } } : p)
    );
  }

  async function applySelected() {
    const accepted = proposals.filter(p => p.selected);
    if (!accepted.length) return;
    const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

    const tasksToApply = accepted.map(item => {
      const f = item.fields;
      if (item.match_type === 'update_existing' && item.task_id) {
        const existing = tasks.find(t => t.id === item.task_id) || {};
        return {
          ...existing,
          ...(f.title    ? { title: f.title }       : {}),
          ...(f.assignee ? { assignee: f.assignee } : {}),
          ...(f.prio     ? { prio: f.prio }         : {}),
          ...(f.status   ? { status: f.status }     : {}),
          ...(f.due_date ? { due_date: f.due_date } : {}),
          ...(f.note
            ? { note: existing.note ? `${existing.note}\n[${today}] ${f.note}` : `[${today}] ${f.note}` }
            : {}),
          scope: item.scope !== 'uncertain' ? item.scope : (existing.scope || 'internal'),
        };
      }
      return {
        title:     f.title || item.summary,
        status:    f.status || 'todo',
        prio:      f.prio || 'P2',
        assignee:  f.assignee || null,
        due_date:  f.due_date || null,
        note:      f.note || null,
        scope:     item.scope !== 'uncertain' ? item.scope : 'internal',
      };
    });

    await onApply(tasksToApply);
    handleClose();
  }

  const selectedCount = proposals.filter(p => p.selected).length;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Importer un compte-rendu" maxWidth="660px">
      {step === 'input' && (
        <>
          <textarea
            value={crText}
            onChange={e => setCrText(e.target.value)}
            placeholder="Collez votre CR ici…"
            rows={12}
            style={{
              width: '100%', resize: 'vertical',
              fontFamily: "'DM Mono', monospace", fontSize: '13px',
              marginBottom: 0,
            }}
          />
          {err && (
            <div style={{ color: 'var(--red)', fontSize: '13px', marginTop: '8px' }}>{err}</div>
          )}
          <div className="modal-foot">
            <button className="btn btn-sec" onClick={handleClose}>Annuler</button>
            <button
              className="btn"
              style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}
              disabled={!crText.trim() || loading}
              onClick={analyse}
            >
              {loading && <Loader2 size={13} className="cr-spin" />}
              {loading ? 'Analyse…' : 'Analyser'}
            </button>
          </div>
        </>
      )}

      {step === 'review' && (
        <>
          <div style={{ fontSize: '13px', color: 'var(--tx2)', marginBottom: '10px' }}>
            {proposals.length} action{proposals.length !== 1 ? 's' : ''} extraite{proposals.length !== 1 ? 's' : ''} —{' '}
            <strong>{selectedCount}</strong> sélectionnée{selectedCount !== 1 ? 's' : ''}
          </div>

          <div style={{
            display: 'flex', flexDirection: 'column', gap: '8px',
            maxHeight: '55vh', overflowY: 'auto', paddingRight: '4px',
          }}>
            {proposals.length === 0 && (
              <div style={{ color: 'var(--tx3)', fontSize: '13px', textAlign: 'center', padding: '28px 0' }}>
                Aucune action actionnable détectée.
              </div>
            )}
            {proposals.map((item, idx) => (
              <ProposalItem
                key={idx}
                item={item}
                tasks={tasks}
                members={members}
                onToggle={() => toggle(idx)}
                onFieldChange={(f, v) => updateField(idx, f, v)}
              />
            ))}
          </div>

          <div className="modal-foot">
            <button className="btn btn-sec" onClick={() => setStep('input')}>
              ← Modifier le CR
            </button>
            <button
              className="btn"
              style={{ width: 'auto' }}
              disabled={selectedCount === 0}
              onClick={applySelected}
            >
              Appliquer {selectedCount} tâche{selectedCount !== 1 ? 's' : ''}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Badge({ style, label }) {
  return (
    <span style={{
      ...style,
      fontSize: '11px', fontWeight: 600,
      padding: '2px 6px', borderRadius: '4px',
    }}>
      {label}
    </span>
  );
}

function ProposalItem({ item, tasks, members, onToggle, onFieldChange }) {
  const existingTask = item.match_type === 'update_existing' && item.task_id
    ? tasks.find(t => t.id === item.task_id)
    : null;

  return (
    <div style={{
      border: `1px solid ${item.selected ? 'var(--sb-orange)' : 'var(--brd)'}`,
      borderRadius: '8px', padding: '12px',
      background: item.selected ? 'var(--sur)' : 'var(--sur2)',
      opacity: item.selected ? 1 : 0.55,
      transition: 'border-color 0.15s, opacity 0.15s',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '6px' }}>
        <input
          type="checkbox"
          checked={item.selected}
          onChange={onToggle}
          style={{ marginTop: '3px', cursor: 'pointer', accentColor: 'var(--sb-orange)', flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx)', marginBottom: '5px' }}>
            {item.summary}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
            <Badge
              style={MATCH_STYLES[item.match_type] || MATCH_STYLES.uncertain}
              label={MATCH_LABELS[item.match_type] || item.match_type}
            />
            <Badge
              style={SCOPE_STYLES[item.scope] || SCOPE_STYLES.uncertain}
              label={SCOPE_LABELS[item.scope] || item.scope}
            />
            <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>
              {Math.round(item.confidence * 100)}%
            </span>
          </div>
          {existingTask && (
            <div style={{ fontSize: '11px', color: 'var(--tx3)', marginTop: '4px' }}>
              → Tâche #{item.task_id} : {existingTask.title}
            </div>
          )}
        </div>
      </div>

      {/* Clarification warning */}
      {item.needs_clarification && item.clarification_question && (
        <div style={{
          background: 'var(--c-amb-bg)', border: '1px solid var(--amb)',
          borderRadius: '6px', padding: '7px 10px',
          fontSize: '12px', color: 'var(--amb)',
          display: 'flex', gap: '6px', alignItems: 'flex-start',
          marginBottom: '8px',
        }}>
          <AlertTriangle size={12} style={{ marginTop: '1px', flexShrink: 0 }} />
          {item.clarification_question}
        </div>
      )}

      {/* Editable fields — only shown when selected */}
      {item.selected && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
          <div>
            <div className="task-meta-label">Titre</div>
            <input
              type="text"
              value={item.fields.title || ''}
              onChange={e => onFieldChange('title', e.target.value)}
              placeholder={item.match_type === 'update_existing' ? '— inchangé —' : 'Titre de la tâche'}
              style={{ marginBottom: 0, fontSize: '12px' }}
            />
          </div>
          <div>
            <div className="task-meta-label">Assigné</div>
            <select
              value={item.fields.assignee || ''}
              onChange={e => onFieldChange('assignee', e.target.value)}
              style={{ marginBottom: 0, fontSize: '12px' }}
            >
              <option value="">—</option>
              {members.map(m => (
                <option key={m.initials} value={m.initials}>
                  {m.initials} — {m.name || m.initials}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="task-meta-label">Statut</div>
            <select
              value={item.fields.status || ''}
              onChange={e => onFieldChange('status', e.target.value)}
              style={{ marginBottom: 0, fontSize: '12px' }}
            >
              <option value="">— inchangé —</option>
              <option value="todo">À faire</option>
              <option value="inprogress">En cours</option>
              <option value="waiting">En attente</option>
              <option value="blocked">Bloqué</option>
              <option value="done">Fait</option>
            </select>
          </div>
          <div>
            <div className="task-meta-label">Priorité</div>
            <select
              value={item.fields.prio || ''}
              onChange={e => onFieldChange('prio', e.target.value)}
              style={{ marginBottom: 0, fontSize: '12px' }}
            >
              <option value="">— inchangée —</option>
              <option value="P1">P1 — Urgent</option>
              <option value="P2">P2 — Normal</option>
              <option value="P3">P3 — Bas</option>
            </select>
          </div>
          <div>
            <div className="task-meta-label">Échéance</div>
            <input
              type="date"
              value={item.fields.due_date || ''}
              onChange={e => onFieldChange('due_date', e.target.value)}
              style={{ marginBottom: 0, fontSize: '12px', fontFamily: "'DM Mono', monospace" }}
            />
          </div>
          <div>
            <div className="task-meta-label">Note</div>
            <input
              type="text"
              value={item.fields.note || ''}
              onChange={e => onFieldChange('note', e.target.value)}
              placeholder="Note additionnelle…"
              style={{ marginBottom: 0, fontSize: '12px' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
