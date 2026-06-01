// PostCSS transforme le CSS : Tailwind génère les classes, autoprefixer
// ajoute les préfixes navigateurs (-webkit-, -moz-, etc.) automatiquement.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
