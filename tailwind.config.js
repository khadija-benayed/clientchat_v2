/** @type {import('tailwindcss').Config} */
export default {
  // Tailwind scanne ces fichiers pour supprimer les classes inutilisées en prod
  content: ['./index.html', './src/**/*.{js,jsx}'],

  // Mode sombre : piloté par l'attribut data-theme="dark" sur <html>
  // Compatible avec le système de variables CSS existant (styles.css)
  darkMode: ['selector', '[data-theme="dark"]'],

  theme: {
    extend: {
      /* ═══════════════════════════════════════════════════════════════
         DESIGN SYSTEM SMART BEES
         Toutes les valeurs sont MESURÉES sur smart-bees.fr (5 pages).
         Référence complète et preuves : docs/brand-dna-smart-bees.md
         ═══════════════════════════════════════════════════════════════ */

      // Palette — utilisable comme classes : bg-sb-orange, text-sb-navy…
      colors: {
        'sb-navy':     '#264653', // texte rang 1 + footer + hexagone logo, 5/5 pages
        'sb-orange':   '#FF9E00', // CTA primaire .sbs-btn-1, 5/5 pages
        'sb-coral':    '#FE6D73', // .sbo-xn4 / .sbs-hx-4, 2/5 pages
        'sb-blue-lt':  '#BDE0FE', // .sbx-bar-a / .sbx-hl-b
        'sb-blue-sky': '#85C4FF', // token de marque déclaré --royal-blue
        'sb-green':    '#5EC045', // token de marque déclaré --lime-green
        'sb-orchid':   '#B75DDA', // token de marque déclaré --medium-orchid
        'sb-ice':      '#F4F9FD', // fond de section, rang 2 par surface, 5/5 pages
        'sb-cream':    '#FFF3DF', // .sbx-bar-c, surligneur chaud
        'sb-sand':     '#F1EFEA', // .sbs-btn-2, bouton tertiaire
      },

      // Bi-typographie de marque (§4)
      fontFamily: {
        display: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans:    ['Raleway', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      // Le tracking est LA signature typographique : très serré en titre,
      // très ouvert en eyebrow. Valeurs converties en em depuis les px mesurés.
      letterSpacing: {
        'sb-tight':   '-0.035em', // h1 56px / -1,96px
        'sb-heading': '-0.03em',  // h2 44px / -1,32px
        'sb-ctrl':    '-0.01em',  // bouton 16px / -0,16px
        'sb-label':   '0.08em',   // eyebrow large 13px / +1,04px
        'sb-eyebrow': '0.16em',   // eyebrow 11px / +1,76px
      },

      // Contrôles nets, surfaces douces — l'inverse de la convention SaaS (§6)
      borderRadius: {
        'sb-btn':   '4px',  // .sbs-btn-1/2/3, 25 occ.
        'sb-input': '6px',  // input.sbs-input, 15 occ.
        'sb-card':  '8px',  // .sbs-card / .sbs-acard, 21 occ.
        'sb-panel': '20px', // .sbo-xrow / .sbx-case, 16 occ.
        'sb-modal': '24px', // .sbs-panel / .sbp-card, 4/5 pages
        'sb-menu':  '14px', // .sbs-ddlist
        'sb-pill':  '99px', // .sbx-pill, 38 occ.
      },

      // La marque sépare par l'anneau inset, pas par l'ombre portée (§6)
      boxShadow: {
        'sb-ring':   'inset 0 0 0 1px rgba(38,70,83,0.16)',
        'sb-e1':     '0 4px 20px 0 rgba(38,70,83,0.08), 0 1px 4px 0 rgba(38,70,83,0.04)',
        'sb-e2':     '0 12px 32px 0 rgba(38,70,83,0.14), 0 2px 6px 0 rgba(38,70,83,0.06)',
        'sb-hard':   '4px 4px 0 0 rgba(38,70,83,0.13)', // « cliquable », 23 occ.
        'sb-hard-s': '2px 2px 0 0 rgba(38,70,83,0.11)',
        'sb-under':  'inset 0 -4px 0 0 #FF9E00',        // soulignement, 12 occ.
      },

      // Les deux seules durées que la marque utilise vraiment (§9)
      transitionTimingFunction: { 'sb': 'ease' },
      transitionDuration: { 'sb-ctrl': '160ms', 'sb-card': '180ms', 'sb-nav': '200ms' },

      // La texture « blueprint » : papier millimétré d'ingénieur, 5/5 pages
      backgroundImage: {
        'sb-blueprint':
          'radial-gradient(circle, #CFDEE8 1.4px, rgba(0,0,0,0) 1.6px),' +
          'linear-gradient(#E3EDF4 1px, rgba(0,0,0,0) 1px),' +
          'linear-gradient(90deg, #E3EDF4 1px, rgba(0,0,0,0) 1px)',
      },
      backgroundSize: { 'sb-blueprint': '44px 44px' },
    },
  },
  plugins: [],
}
