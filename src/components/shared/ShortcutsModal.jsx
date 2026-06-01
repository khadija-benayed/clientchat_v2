/** Modal raccourcis clavier */
import Modal from './Modal';

const SHORTCUTS = [
  { label: 'Sidebar',                   key: '⌘B' },
  { label: 'Mode sombre/clair',          key: '⌘D' },
  { label: 'Focus chat',                 key: '⌘K' },
  { label: 'Joindre un fichier',         key: '⌘J' },
  { label: 'Paramètres',                 key: '⌘,' },
  { label: 'Client précédent / suivant', key: '⌘[ / ⌘]' },
  { label: 'Recherche tâches',           key: '⌘F' },
  { label: 'Raccourcis',                 key: '?' },
];

const kbdStyle = {
  fontFamily: "'DM Mono', monospace",
  background: 'var(--sur2)', border: '1px solid var(--brd2)',
  borderRadius: '4px', padding: '2px 7px',
};

export default function ShortcutsModal({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Raccourcis clavier" maxWidth="380px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '16px 0' }}>
        {SHORTCUTS.map(s => (
          <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span>{s.label}</span>
            <kbd style={kbdStyle}>{s.key}</kbd>
          </div>
        ))}
      </div>
      <div className="modal-foot">
        <button className="btn btn-sec" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
