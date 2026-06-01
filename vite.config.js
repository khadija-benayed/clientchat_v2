import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Configuration Vite pour le build React.
 *
 * base: '/clientchat_v2/' — indispensable pour GitHub Pages.
 * Sans ce préfixe, les assets (JS, CSS) seraient cherchés à la racine du
 * domaine (khadija-benayed.github.io/) au lieu du sous-chemin du repo.
 */
export default defineConfig({
  plugins: [react()],
  base: '/clientchat_v2/',
})
