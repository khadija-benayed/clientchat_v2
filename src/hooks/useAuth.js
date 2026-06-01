/**
 * src/hooks/useAuth.js — Gestion de l'authentification
 *
 * Un "hook" React est une fonction qui commence par "use" et qui encapsule
 * de la logique réutilisable. Pensez-y comme une classe utilitaire en Java,
 * mais qui peut déclencher des re-rendus du composant quand ses données changent.
 *
 * Ce hook gère :
 * - L'écoute des changements d'état d'auth Supabase (SIGNED_IN, SIGNED_OUT, etc.)
 * - Le stockage du JWT et de l'ID utilisateur
 * - Les fonctions signIn (Google OAuth) et logout
 *
 * Il est utilisé dans App.jsx comme source de vérité pour l'authentification.
 */
import { useState, useEffect } from 'react';
import supabase from '../lib/supabase';

/**
 * @returns {{
 *   user: object|null,          // Objet user Supabase (email, id, etc.)
 *   jwtToken: string|null,      // JWT à passer au backend
 *   currentUserId: string|null, // UUID Supabase Auth
 *   authReady: boolean,         // true une fois la session initiale vérifiée
 *   signInWithGoogle: function,
 *   logout: function
 * }}
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [jwtToken, setJwtToken] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  // authReady passe à true une fois qu'on sait si l'utilisateur est connecté ou non.
  // Évite un flash de la page de login au démarrage si une session est déjà active.
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    /**
     * useEffect avec tableau de dépendances vide [] = s'exécute UNE SEULE FOIS
     * au montage du composant (équivalent d'un constructeur ou @PostConstruct Java).
     *
     * On s'abonne aux changements d'état auth Supabase.
     * La fonction retournée par useEffect est le "cleanup" (comme un finally
     * ou un Closeable.close() en Java) — appelée quand le composant est détruit.
     */

    // 1. Vérifier si une session existe déjà (page rechargée, onglet rouvert)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        setJwtToken(session.access_token);
        setCurrentUserId(session.user?.id || null);
      }
      setAuthReady(true);
    });

    // 2. S'abonner aux changements futurs (login, logout, refresh token)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
          setUser(session.user);
          setJwtToken(session.access_token);
          setCurrentUserId(session.user?.id || null);
          setAuthReady(true);
        } else if (event === 'TOKEN_REFRESHED' && session) {
          // Le JWT a été rafraîchi automatiquement — on met à jour sans changer le reste
          setJwtToken(session.access_token);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setJwtToken(null);
          setCurrentUserId(null);
        }
      }
    );

    // Cleanup : désabonnement quand le composant est détruit
    return () => subscription.unsubscribe();
  }, []);

  /** Lance le flux OAuth Google (redirige puis revient sur l'app) */
  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://khadija-benayed.github.io/clientchat_v2' },
    });
  }

  /** Déconnexion : vide l'état local et appelle Supabase signOut */
  async function logout() {
    setUser(null);
    setJwtToken(null);
    setCurrentUserId(null);
    try { await supabase.auth.signOut(); } catch (_) {}
  }

  return { user, jwtToken, currentUserId, authReady, signInWithGoogle, logout };
}
