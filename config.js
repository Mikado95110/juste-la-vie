/* ============================================================================
   JUSTE LA VIE — RÉGLAGES D'HÉBERGEMENT (le seul fichier à modifier)
   ----------------------------------------------------------------------------
   clips : dossier en ligne qui contient les 24 clips 4K60, nommés comme dans
           « F:\Juste la vie - Clips en ligne » (ex. Parano.mp4).
           · 'media/clips/'  → les clips sont à côté du site (hébergement perso)
           · 'https://github.com/<pseudo>/juste-la-vie/releases/download/clips/'
           · 'https://archive.org/download/<identifiant>/'
           · false           → pas de clips : le site joue l'audio sur les images
           Si un clip ne se charge pas, le morceau passe tout seul en audio.
   apk   : lien direct de Juste-la-vie.apk (laisser '' pour cacher le cadeau).
   ============================================================================ */
window.JLV_CONFIG = {
  clips: 'https://github.com/Mikado95110/juste-la-vie/releases/download/clips/',
  apk: 'https://archive.org/download/juste-la-vie-mikado95/Juste-la-vie.apk'
};
