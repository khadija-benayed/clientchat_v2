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
export default function Modal({ isOpen, onClose, title, maxWidth = '560px', children }) {
  if (!isOpen) return null; // Si fermé, ne rien rendre du tout

  return (
    <div
      className="modal-bg"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" style={{ maxWidth }}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}
