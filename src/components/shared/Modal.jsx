/**
 * src/components/shared/Modal.jsx — Composant modal générique
 *
 * En React, on évite de manipuler le DOM directement (document.getElementById,
 * classList.add…). À la place, on passe un booléen "isOpen" et React s'occupe
 * d'afficher ou masquer le composant.
 *
 * Ce composant encapsule le backdrop (fond semi-transparent) et la boîte modale.
 * Il se ferme en cliquant en dehors (sur le backdrop) ou via la prop onClose.
 *
 * Props (comme les paramètres d'une fonction Java) :
 * @param {boolean}  isOpen    - true = modal visible
 * @param {Function} onClose   - appelée pour fermer la modal
 * @param {string}   title     - titre affiché en haut
 * @param {string}   [maxWidth='560px'] - largeur max de la boîte
 * @param {ReactNode} children - contenu à l'intérieur (JSX entre balises ouvrante/fermante)
 */
export default function Modal({ isOpen, onClose, title, maxWidth = '560px', closeColor, children }) {
  if (!isOpen) return null;

  const xColor = closeColor || 'var(--tx3)';
  const xHoverBg = closeColor ? 'rgba(255,255,255,0.2)' : 'var(--brd2, rgba(25,54,68,0.08))';
  const xHoverColor = closeColor ? closeColor : 'var(--tx)';

  return (
    <div
      className="modal-bg"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" style={{ maxWidth, position: 'relative' }}>
        <button
          onClick={onClose}
          aria-label="Fermer"
          style={{
            position: 'absolute', top: '12px', right: '12px', zIndex: 1,
            width: '28px', height: '28px', borderRadius: '8px',
            border: 'none', background: 'transparent',
            color: xColor, cursor: 'pointer', fontSize: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, transition: 'background .15s, color .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = xHoverBg; e.currentTarget.style.color = xHoverColor; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = xColor; }}
        >✕</button>
        {title && <h2 style={{ paddingRight: '36px' }}>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
