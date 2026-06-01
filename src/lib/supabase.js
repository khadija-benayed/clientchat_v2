/**
 * src/lib/supabase.js — Client Supabase singleton
 *
 * Concept React/JS important : un singleton est une instance unique partagée
 * dans toute l'app. En Java, ce serait un pattern Singleton avec getInstance().
 * Ici on exporte directement l'instance créée une seule fois au chargement du module.
 *
 * Le client Supabase gère :
 * - L'authentification Google OAuth
 * - Les requêtes Postgres (tables, RPC)
 * - Le Realtime (écoute des changements en temps réel)
 */
import { createClient } from '@supabase/supabase-js';
import { SB_URL, SB_KEY } from './constants';

// Instance unique partagée dans toute l'application
const supabase = createClient(SB_URL, SB_KEY);

export default supabase;
