/**
 * src/components/shared/SyncStatus.jsx — Indicateur de synchronisation
 *
 * Petit composant dans la topbar qui affiche :
 * - Un point coloré (vert = synchronisé, orange = en cours, rouge = erreur)
 * - Un label textuel
 * - Une barre de progression optionnelle (ex: "12/45 indexés")
 *
 * Props :
 * @param {string}      color    - Couleur CSS du point
 * @param {string}      label    - Texte du statut
 * @param {object|null} progress - { done, total } ou null
 */
export default function SyncStatus({ color = '#52b788', label = 'synchronisé', progress = null }) {
  return (
    <>
      <div className="sync-dot" style={{ background: color }} />
      <span className="sync-lbl">{label}</span>
      {progress && (
        <span className="sync-progress">
          {progress.done}/{progress.total} indexés
        </span>
      )}
    </>
  );
}
