/** @type {import('tailwindcss').Config} */
export default {
  // Tailwind scanne ces fichiers pour supprimer les classes inutilisées en prod
  content: ['./index.html', './src/**/*.{js,jsx}'],

  // Mode sombre : piloté par l'attribut data-theme="dark" sur <html>
  // Compatible avec le système de variables CSS existant (styles.css)
  darkMode: ['selector', '[data-theme="dark"]'],

  theme: {
    extend: {
      // Palette SmartBees — utilisable comme classes Tailwind : bg-sb-orange, text-sb-navy…
      colors: {
        'sb-navy':    '#193644',
        'sb-orange':  '#F89B1C',
        'sb-coral':   '#FF6772',
        'sb-blue-lt': '#C2E2F5',
        'sb-blue-md': '#00779B',
      },
      fontFamily: {
        sans: ['DM Sans', 'ui-sans-serif', 'system-ui'],
        mono: ['DM Mono', 'ui-monospace', 'SFMono-Regular'],
      },
    },
  },
  plugins: [],
}
