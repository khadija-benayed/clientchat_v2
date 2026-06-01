/**
 * src/lib/backend.js — Couche d'accès au backend FastAPI
 *
 * Centralise tous les appels HTTP vers le backend Cloud Run.
 * Équivalent Java : une classe Service ou un Repository.
 *
 * Règle : on ne fait JAMAIS de fetch(BACKEND_URL) directement dans les composants.
 * Tout passe par callBackend() ou openBackendSSE() définis ici.
 */
import { BACKEND_URL } from './constants';

/**
 * Construit les headers HTTP avec le JWT Supabase.
 * @param {string|null} jwtToken - Token JWT de la session Supabase courante
 */
export function getBackendHeaders(jwtToken) {
  const h = { 'Content-Type': 'application/json' };
  if (jwtToken) h['Authorization'] = 'Bearer ' + jwtToken;
  return h;
}

/**
 * Appelle le backend en POST JSON et retourne la réponse parsée.
 * Lance une Error si le serveur répond avec un status HTTP non-2xx.
 *
 * @param {object} payload - Corps JSON de la requête (doit contenir "action")
 * @param {string|null} jwtToken - JWT Supabase courant
 * @returns {Promise<object>} - La réponse JSON du backend
 */
export async function callBackend(payload, jwtToken) {
  const r = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: getBackendHeaders(jwtToken),
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    let msg = 'Backend HTTP ' + r.status;
    try { const d = await r.json(); if (d?.error) msg += ': ' + d.error; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

/**
 * Ouvre un stream SSE (Server-Sent Events) vers le backend.
 * Utilisé pour sync_drive et sync_emails qui streament leur progression.
 *
 * Concept SSE : le serveur envoie des lignes "data: {...}\n\n" en continu.
 * C'est différent de WebSocket — communication unidirectionnelle serveur→client.
 *
 * @param {object} payload - Corps JSON de la requête
 * @param {string|null} jwtToken - JWT Supabase courant
 * @returns {Promise<Response>} - La réponse brute (à lire avec .body.getReader())
 */
export async function openBackendSSE(payload, jwtToken) {
  const resp = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: getBackendHeaders(jwtToken),
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const d = await resp.json().catch(() => ({}));
    throw new Error(d.error || 'Backend HTTP ' + resp.status);
  }
  return resp;
}

/**
 * Indexation par batches — appelle index_source en boucle jusqu'à has_more=false.
 * Le backend local embed en une passe, donc en pratique un seul appel suffit.
 */
export async function indexSourceBatched(payload, jwtToken) {
  let startChunk = 0;
  let totalCreated = 0;
  while (true) {
    const data = await callBackend({ ...payload, start_chunk: startChunk }, jwtToken);
    if (data.error) throw new Error(data.error);
    totalCreated += data.chunks_created;
    if (!data.has_more) break;
    if (data.next_chunk == null) break;
    startChunk = data.next_chunk;
  }
  return { chunks_created: totalCreated };
}
