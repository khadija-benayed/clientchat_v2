/**
 * src/lib/constants.js — Constantes globales de l'application
 *
 * Équivalent Java : interface de constantes (ou enum).
 * Centralise toutes les valeurs fixes pour éviter les "magic strings" partout.
 */

// URL du backend FastAPI sur Cloud Run
export const BACKEND_URL = 'https://clientchat-v2-167005458056.europe-west9.run.app';

// Credentials Supabase (lecture publique — la clé "anon" n'a que les droits RLS)
export const SB_URL = 'https://erpjerfvswesipmdqxab.supabase.co';
export const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVycGplcmZ2c3dlc2lwbWRxeGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NTQwNDEsImV4cCI6MjA5MjQzMDA0MX0.ftgCx_YzClgkNCPF5PprnPJd-y6mdl_vETtvl6pzG2U';

// Types MIME des fichiers Drive exportables par le backend
export const EXPORTABLE_MIMETYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/pdf',
];

/**
 * Palette d'avatars (couleur fond + texte) utilisée pour les initiales.
 * L'index est calculé depuis les initiales pour que la couleur soit stable.
 */
export const MC = [
  { bg: '#EAF4EE', c: '#2D6A4F' },
  { bg: '#EAF0FA', c: '#1A4F8A' },
  { bg: '#FDF0DC', c: '#7A4B0F' },
  { bg: '#EDE9FE', c: '#5B21B6' },
  { bg: '#FAEAEA', c: '#8B2020' },
];

/** Retourne la couleur d'avatar pour des initiales données */
export function memberStyle(initials) {
  const ini = initials || '?';
  const i = ((ini.charCodeAt(0) || 0) + (ini.charCodeAt(1) || 0)) % MC.length;
  return MC[i];
}

/** Échappe les caractères HTML dangereux (anti-XSS) */
export function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
