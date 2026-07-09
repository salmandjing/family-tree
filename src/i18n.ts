/**
 * French UI strings. The app is built for a single French-speaking user, so we
 * translate directly (no runtime language switch). All user-facing text lives
 * here so the translation is auditable in one place.
 */

export const t = {
  appName: 'Arbre Généalogique',

  // TreeContext
  loading: 'Chargement de votre arbre…',
  fatalTitle: 'Un problème est survenu',
  fatalStorage:
    "Impossible d'ouvrir le stockage local. Votre navigateur est peut-être en navigation privée ou manque d'espace.",

  // Passphrase gate
  gate: {
    prompt: 'Entrez le mot de passe de la famille pour continuer.',
    placeholder: 'Mot de passe de la famille',
    unlock: 'Déverrouiller',
    checking: 'Vérification…',
    empty: 'Veuillez entrer le mot de passe de la famille.',
    wrong: "Ce mot de passe n'est pas correct.",
    network: (msg: string) =>
      `Impossible de joindre le service de sauvegarde. Vous pouvez tout de même travailler hors ligne. (${msg})`,
  },

  // Toolbar
  toolbar: {
    addPerson: '＋ Ajouter',
    undo: '↶ Annuler',
    redo: '↷ Rétablir',
    history: 'Historique',
    bin: 'Corbeille',
    download: 'Télécharger',
    upload: 'Importer',
    help: 'Aide',
    exportFailed: (msg: string) => `Échec du téléchargement : ${msg}`,
    importFailed: (msg: string) => `Échec de l'import : ${msg}`,
  },

  // Search
  search: {
    placeholder: 'Rechercher un nom…',
    aria: 'Rechercher une personne',
  },

  // Empty state
  empty: {
    heading: 'Commencez votre arbre généalogique',
    desc: 'Ajoutez la première personne — vous-même, ou le plus ancien parent dont vous vous souvenez.',
    button: 'Ajouter la première personne',
  },

  // Tree canvas
  wholeTree: '⤢ Voir tout l’arbre',
  wholeTreeAria: 'Voir tout l’arbre',

  // Person card
  person: {
    gone: 'Cette personne n’existe plus.',
    close: 'Fermer',
    detailsFor: (name: string) => `Fiche de ${name}`,
    addParent: '+ Parent',
    addSpouse: '+ Conjoint',
    addChild: '+ Enfant',
    addPhoto: '+ Photo',
    whichPartner: 'Ajouter un enfant avec quel conjoint ?',
    unknownPartner: 'Conjoint inconnu',
    cancel: 'Annuler',
    givenName: 'Prénom',
    familyName: 'Nom de famille',
    nicknames: 'Surnoms (séparés par des virgules)',
    sex: 'Sexe',
    sexMale: 'Homme',
    sexFemale: 'Femme',
    sexUnknown: 'Inconnu',
    bornLegend: 'Naissance',
    dateHint: 'ex. 1950 ou vers 1950',
    approximate: 'Date approximative',
    place: 'Lieu',
    diedLegend: 'Décès',
    deceased: 'Décédé(e)',
    deathHint: 'ex. 2001 ou vers 2001',
    notes: 'Histoires & souvenirs',
    notesHint: 'Tout ce qui mérite d’être gardé — histoires, lieux, relations…',
    parents: 'Parents',
    spouses: 'Conjoints',
    children: 'Enfants',
    delete: 'Mettre à la corbeille',
    somethingWrong: 'Une erreur est survenue.',
  },

  // format
  unknown: 'Inconnu',
  unnamed: 'Personne sans nom',

  // History panel
  history: {
    title: 'Historique',
    hint: 'Chaque enregistrement est conservé ici. Restaurez n’importe quelle version précédente.',
    version: (n: number) => `Version ${n}`,
    people: (n: number) => `${n} personne${n === 1 ? '' : 's'}`,
    restore: 'Restaurer',
    current: 'Actuelle',
    confirm:
      'Restaurer votre arbre à cette version précédente ? Votre version actuelle reste dans l’historique.',
    empty: 'Aucun historique pour l’instant.',
    missing: 'Cette version n’existe plus.',
  },

  // Bin panel
  bin: {
    title: 'Corbeille',
    hint: (days: number) =>
      `Les personnes supprimées sont conservées ${days} jours, puis retirées automatiquement.`,
    restore: 'Restaurer',
    deleteForever: 'Supprimer définitivement',
    confirm: (name: string) =>
      `Supprimer définitivement ${name} ? Cette action est irréversible.`,
    empty: 'Rien ici.',
  },

  // Busy overlay
  working: 'Un instant…',

  // Conflict dialog
  conflict: {
    aria: 'Conflit de versions',
    title: 'Cet arbre a été modifié sur un autre appareil',
    body: (ago: string) =>
      `L’autre version a été enregistrée ${ago}. Laquelle voulez-vous garder ?`,
    keepLocal: 'Garder la version de cet appareil',
    keepRemote: 'Garder l’autre version',
    keepBoth: 'Garder les deux copies',
    hint: '« Garder les deux » conserve la version de cet appareil et télécharge l’autre version dans un fichier, pour ne rien perdre.',
  },

  // Backup status (spec §8)
  status: {
    localOnly: 'Enregistré sur cet appareil',
    idle: (ago: string) => `✓ Sauvegardé ${ago}`,
    pending: 'Modifications enregistrées ici — sauvegarde en ligne bientôt…',
    backingUp: 'Sauvegarde en cours…',
    offline:
      'Hors ligne — vos modifications sont enregistrées ici et seront sauvegardées à la reconnexion',
    error:
      'La sauvegarde en ligne ne fonctionne plus — vos modifications sont toujours sur cet appareil. Prévenez Salman.',
    retry: 'Réessayer',
  },

  // Relative time
  time: {
    never: 'jamais',
    justNow: 'à l’instant',
    min: (n: number) => `il y a ${n} min`,
    hr: (n: number) => `il y a ${n} h`,
    day: (n: number) => `il y a ${n} jour${n === 1 ? '' : 's'}`,
  },
} as const;
