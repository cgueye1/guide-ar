/* ═══════════════════════════════════════════════════════════
   Traductions de l'interface.
   Le contenu des lieux (nom, description) vient de l'API.
   ═══════════════════════════════════════════════════════════ */

const I18N = {

  fr: {
    aim:       "Visez un monument, puis appuyez",
    guide:     "GUIDE",
    scanning:  "Analyse en cours",
    locating:  "Recherche de votre position",
    back:      "Retour",
    match:     "Correspondance",
    tryAgain:  "Réessayer",
    retry:     "Réessayer",
    holdStill: "Ne bougez pas",

    /* ── parcours de visite ── */
    stepsTitle: "Parcours de visite",
    stepWord:   "Étape",
    stepOf:     "sur",
    oneStep:    "1 étape",
    manySteps:  "{n} étapes",
    prev:       "Précédent",
    next:       "Suivant",
    watch:      "Vidéo",

    /* ── réalité augmentée ── */
    viewAr:      "Voir en réalité augmentée",
    arNotSupported: "La RA n'est pas prise en charge sur cet appareil",
    arLoading:   "Chargement du modèle 3D…",
    arLoadError: "Impossible de charger le modèle 3D",
    arAimFloor:  "Déplacez votre téléphone pour repérer le sol",
    arTapPlace:  "Appuyez à l'endroit où poser l'objet",
    arPlaced:    "Objet placé",

    /* ── reconnu mais trop loin ── */
    farTitle:  "Vous êtes trop loin",
    farUnit:   "km",
    farAway:   "de distance",
    farBody:   "Ce lieu se débloque dès que vous êtes à moins d'un kilomètre.",

    /* ── non reconnu ── */
    noneTitle: "Aucun lieu reconnu",
    noneBody:  "Rapprochez-vous du monument et cadrez-le entièrement, puis réessayez.",

    /* ── caméra ── */
    camTitle:  "Caméra inaccessible",
    camBody:   "Autorisez l'accès à la caméra dans les réglages de votre navigateur, puis rechargez.",

    /* ── position ── */
    geoTitle:  "Position indisponible",
    geoBody:   "Activez la localisation pour débloquer les lieux autour de vous.",
    geoAllow:  "Activer la localisation",
    geoSkip:   "Continuer sans",

    /* ── réseau ── */
    netTitle:  "Connexion perdue",
    netBody:   "Vérifiez votre connexion internet, puis réessayez.",
  },

  en: {
    aim:       "Point at a landmark, then tap",
    guide:     "GUIDE",
    scanning:  "Analysing",
    locating:  "Finding your location",
    back:      "Back",
    match:     "Match",
    tryAgain:  "Try again",
    retry:     "Try again",
    holdStill: "Hold still",

    stepsTitle: "Guided tour",
    stepWord:   "Step",
    stepOf:     "of",
    oneStep:    "1 step",
    manySteps:  "{n} steps",
    prev:       "Previous",
    next:       "Next",
    watch:      "Video",

    /* ── augmented reality ── */
    viewAr:      "View in augmented reality",
    arNotSupported: "AR isn't supported on this device",
    arLoading:   "Loading 3D model…",
    arLoadError: "Couldn't load the 3D model",
    arAimFloor:  "Move your phone to find the floor",
    arTapPlace:  "Tap where you'd like to place it",
    arPlaced:    "Object placed",

    farTitle:  "You're too far away",
    farUnit:   "km",
    farAway:   "away",
    farBody:   "This place unlocks once you're within one kilometre.",

    noneTitle: "No landmark recognised",
    noneBody:  "Move closer and fit the whole landmark in frame, then try again.",

    camTitle:  "Camera unavailable",
    camBody:   "Allow camera access in your browser settings, then reload.",

    geoTitle:  "Location unavailable",
    geoBody:   "Turn on location to unlock the places around you.",
    geoAllow:  "Turn on location",
    geoSkip:   "Continue without",

    netTitle:  "Connection lost",
    netBody:   "Check your internet connection, then try again.",
  }
};

/* Catégories renvoyées par l'API */
const CATEGORY = {
  fr: {
    MONUMENT: "Monument",
    MUSEUM:   "Lieu de mémoire",
    STADIUM:  "Site olympique",
    NATURAL:  "Site naturel",
    RELIGIOUS:"Lieu de culte",
    MARKET:   "Marché",
    BEACH:    "Plage",
    DISTRICT: "Quartier",
    OTHER:    "Lieu"
  },
  en: {
    MONUMENT: "Monument",
    MUSEUM:   "Memorial site",
    STADIUM:  "Olympic venue",
    NATURAL:  "Natural site",
    RELIGIOUS:"Place of worship",
    MARKET:   "Market",
    BEACH:    "Beach",
    DISTRICT: "District",
    OTHER:    "Place"
  }
};