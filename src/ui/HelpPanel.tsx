/** In-app "Aide" bubble — the everyday-use instructions in French, always one
 *  tap away. Mirrors the printed guide and references the app's own labels. */

import { BIN_RETENTION_DAYS } from '../store/schema';

export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="panel help-panel" role="dialog" aria-label="Aide">
      <div className="panel-header">
        <h2>Comment utiliser l’arbre</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
      </div>

      <p className="hint">
        Tout s’enregistre automatiquement. N’ayez pas peur de vous tromper — rien ne se
        perd.
      </p>

      <ol className="help-steps">
        <li>
          <strong>Ajouter une personne.</strong> Touchez «&nbsp;Ajouter la première
          personne&nbsp;» (ou «&nbsp;＋ Ajouter&nbsp;» en haut) et écrivez le
          <em> Prénom</em>. C’est la seule chose obligatoire.
        </li>
        <li>
          <strong>Ajouter la famille.</strong> Touchez une personne, puis les grands
          boutons&nbsp;: <em>+ Parent</em>, <em>+ Conjoint</em> ou <em>+ Enfant</em>. Une
          personne peut avoir plusieurs conjoints — l’appli vous demandera de quel côté
          est l’enfant.
        </li>
        <li>
          <strong>Ajouter une photo.</strong> Sur la fiche, touchez <em>+ Photo</em> et
          choisissez une image.
        </li>
        <li>
          <strong>Raconter une histoire.</strong> Dans «&nbsp;Histoires &amp;
          souvenirs&nbsp;», écrivez tout ce dont vous vous souvenez.
        </li>
        <li>
          <strong>Retrouver quelqu’un.</strong> Tapez un nom dans la barre de recherche en
          haut, puis touchez-le.
        </li>
        <li>
          <strong>Revoir tout l’arbre.</strong> Touchez «&nbsp;⤢ Voir tout l’arbre&nbsp;»
          (en bas à gauche).
        </li>
      </ol>

      <div className="help-safe">
        <h3>Si vous faites une erreur</h3>
        <ul>
          <li>
            <strong>↶ Annuler</strong> — revient en arrière.
          </li>
          <li>
            <strong>Historique</strong> — retrouve une version précédente.
          </li>
          <li>
            <strong>Corbeille</strong> — une personne supprimée y reste{' '}
            {BIN_RETENTION_DAYS} jours et peut être récupérée.
          </li>
        </ul>
      </div>

      <p className="hint">
        Si la barre du bas devient <strong>rouge</strong>, ce n’est pas grave&nbsp;: vos
        données restent sur l’appareil. Prévenez Salman.
      </p>
    </aside>
  );
}
