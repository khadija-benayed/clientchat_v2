/**
 * src/hooks/useChat.js — Gestion du chat et de l'IA
 *
 * C'est le hook le plus complexe de l'application.
 * Il encapsule toute la logique de send() depuis ui.js, incluant :
 *
 * 1. Détection d'intention (action tâche vs question client vs bilan)
 * 2. Construction du prompt système en 3 niveaux (L1/L2/L3)
 * 3. Correspondance déterministe tâches↔message (Levenshtein)
 * 4. Appel au backend Claude
 * 5. Parsing de la réponse (texte + JSON de tâches)
 * 6. Application des modifications de tâches
 * 7. Sauvegarde automatique de session
 *
 * @param {object} params
 * @param {object|null} params.client        - Client courant (avec context, members…)
 * @param {Array}       params.tasks         - Liste des tâches courantes
 * @param {Array}       params.summaries     - Résumés de sessions précédentes
 * @param {Array}       params.docCache      - Cache des documents Drive
 * @param {string|null} params.jwtToken      - JWT Supabase
 * @param {Function}    params.onTasksUpdate - Callback(newTasks) quand les tâches changent
 * @param {Function}    params.onSessionSave - Callback(summaryText) après sauvegarde de session
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import { callBackend, streamChatSSE } from '../lib/backend';

export function useChat({ client, tasks, summaries, docCache, jwtToken, currentUserId, onTasksUpdate, onSessionSave }) {
  // Tableau des messages affichés dans le chat
  const [messages, setMessages] = useState([]);
  // Ref synchronisée à chaque render : permet de lire messages dans sendMessage
  // sans le mettre dans les deps du useCallback (évite les re-créations sur chaque token streamé)
  const messagesRef = useRef([]);
  messagesRef.current = messages;
  // true pendant l'appel backend (affiche le "thinking...")
  const [isLoading, setIsLoading] = useState(false);
  // true du premier envoi jusqu'à la fin du stream — désactive le bouton Send
  const [isSending, setIsSending] = useState(false);
  // Compteur d'échanges pour déclencher la sauvegarde de session
  const exchangeCountRef = useRef(0);
  // Compte auquel on a sauvegardé pour la dernière fois (0 = jamais)
  const lastSavedCountRef = useRef(0);
  // Guard anti-doublon : true si un appel summarize_session est en cours
  const saveInFlightRef = useRef(false);
  // Contrôleur d'annulation du stream (utilisé lors d'un changement de client)
  const abortCtrlRef = useRef(null);
  const inactivityTimerRef = useRef(null);
  // RAF — batche les mises à jour de texte streaming (1 re-render / frame au lieu de 1 / token)
  const rafIdRef = useRef(null);
  const pendingDisplayRef = useRef('');
  // Ref pour le guard anti-double-envoi (évite la lecture d'une closure périmée sur isSending)
  const isSendingRef = useRef(false);

  function cancelPendingRaf() {
    if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
  }

  // Membres et index recalculés uniquement quand client.members change (pas à chaque envoi)
  const members = useMemo(
    () => { try { return JSON.parse(client?.members || '[]'); } catch { return []; } },
    [client?.members] // eslint-disable-line
  );

  const memberIndex = useMemo(() => {
    const idx = {};
    for (const m of members) {
      const ini = m.initials.toUpperCase();
      idx[norm(m.initials)] = ini;
      norm(m.name || m.initials).split(/\s+/).filter(w => w.length > 1)
        .forEach(w => { idx[w] = ini; });
    }
    return idx;
  }, [members]);

  /** Remet le timer d'inactivité à zéro (sauvegarde après 10 min sans message) */
  function resetInactivityTimer() {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      triggerSessionSave();
    }, 10 * 60 * 1000);
  }

  /** Ajoute un message dans le chat */
  const addMessage = useCallback((role, text, extras = {}) => {
    const msg = { id: Date.now() + Math.random(), role, text, time: new Date(), ...extras };
    setMessages(prev => prev.filter(m => m.id !== 'thinking').concat(msg));
    return msg;
  }, []);

  /** Vide le chat (changement de client) */
  const clearMessages = useCallback(() => {
    abortCtrlRef.current?.abort();
    abortCtrlRef.current = null;
    isSendingRef.current = false;
    setIsSending(false);
    setIsLoading(false);
    cancelPendingRaf();
    setMessages([]);
    exchangeCountRef.current = 0;
    lastSavedCountRef.current = 0;
    saveInFlightRef.current = false;
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
  }, []);

  // ── Envoi d'un message ────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text, fileAttachment = null) => {
    if (!text?.trim() || !client || isSendingRef.current) return;
    isSendingRef.current = true;
    setIsSending(true);

    exchangeCountRef.current++;
    resetInactivityTimer();

    // Afficher le message utilisateur
    addMessage('u', text, fileAttachment ? { file: fileAttachment } : {});
    setIsLoading(true);

    const mStr = members.map(m => m.initials + '=' + (m.name || m.initials)).join(', ');
    const mFull = members.map(m => 'initiales:' + m.initials + ' nom:"' + (m.name || m.initials) + '"').join(', ');
    const mInitials = members.map(m => m.initials).join(', ') || 'KB, PH';
    const maxId = tasks.length ? Math.max(...tasks.map(t => t.id)) : 0;
    const currentMember = members.find(m => m.member_id === currentUserId) || null;

    // ── Correspondance déterministe tâche↔message ─────────────────────────
    const matchContext = computeMatchContext(text, tasks, memberIndex, members);

    // ── Contexte client pour le prompt ────────────────────────────────────
    const ctxForPrompt = buildClientContext(client);

    // ── Sélection du niveau de prompt (L1/L2/L3) ─────────────────────────
    const _isAction    = isTaskAction(text);
    const _isTaskQuery = !_isAction && isTaskQuery(text);
    const _isQuestion  = isClientQuestion(text);
    const _isComplex   = isComplexQuery(text);
    const _needL2 = !_isAction;

    const _isBrowse = [
      'derniers documents', 'derniers docs', 'documents récents',
      'résume les derniers', 'résume les documents', 'quoi de neuf',
    ].some(p => text.toLowerCase().includes(p));

    const _needL3 = _isComplex && !_isTaskQuery && !_isBrowse;

    const _needDocs = (_isQuestion || _isComplex) && !_isTaskQuery && !_isBrowse;
    const systemPrompt =
      buildL1({ mStr, mFull, mInitials, maxId, matchContext, tasks, isAction: _isAction, isTaskQuery: _isTaskQuery, currentMember }) +
      (_needL2 ? buildL2(ctxForPrompt, summaries, docCache, _needDocs) : '') +
      (_needL3 ? buildL3(summaries) : '');

    // ── Chat history pour Claude (multi-turn) ─────────────────────────────
    const chatHistory = messagesRef.current
      .filter(m => m.role !== 'thinking')
      .slice(-9)
      .map(m => ({ role: m.role === 'u' ? 'u' : 'a', text: m.text || '' }));

    const streamId = Date.now() + Math.random();
    let accum = '';
    let firstToken = true;

    const messageType = _isAction ? 'task_action' : (_isTaskQuery ? 'task_query' : 'chat');
    const payload = {
      system: systemPrompt,
      message: text,
      message_type: messageType,
      client_id: client.id,
      chat_history: chatHistory,
    };
    if (fileAttachment?.data && fileAttachment?.mediaType) {
      payload.file = { data: fileAttachment.data, mediaType: fileAttachment.mediaType };
    }

    const abortCtrl = new AbortController();
    abortCtrlRef.current = abortCtrl;

    try {
      await new Promise((resolve, reject) => {
        streamChatSSE(payload, jwtToken, {
          onToken(chunk) {
            accum += chunk;
            // Cacher la partie JSON si le modèle a commencé à l'écrire
            const sepIdx = accum.indexOf('---JSON---');
            const display = sepIdx >= 0 ? accum.slice(0, sepIdx) : accum;

            if (firstToken) {
              firstToken = false;
              setIsLoading(false);
              setMessages(prev => [...prev, {
                id: streamId, role: 'a', text: display,
                time: new Date(), streaming: true,
              }]);
              return;
            }

            // Batche les updates : 1 re-render par frame (≈16ms) au lieu de 1 par token
            pendingDisplayRef.current = display;
            if (!rafIdRef.current) {
              rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                setMessages(prev => prev.map(m =>
                  m.id === streamId ? { ...m, text: pendingDisplayRef.current } : m
                ));
              });
            }
          },

          onDone({ sources, tasks_json, reply_text }) {
            cancelPendingRaf();
            const hasWebSearchPrompt = !!(reply_text && /veux[- ]tu que je cherche sur internet\s*\?/i.test(reply_text));
            setMessages(prev => prev.map(m =>
              m.id === streamId
                ? {
                    ...m,
                    text: reply_text || '',
                    sources: sources || [],
                    streaming: false,
                    ...(hasWebSearchPrompt ? { webSearchPrompt: true, webSearchQuery: text } : {}),
                  }
                : m
            ));

            // ── Appliquer les modifications de tâches depuis le JSON ────────
            const jsonStr = (tasks_json || '').trim();
            if (jsonStr) {
              try {
                const match = jsonStr.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
                if (match) {
                  const p = JSON.parse(match[0]);
                  if (!p.clarification && onTasksUpdate) {
                    const updatedTasks = applyTaskUpdates(tasks, p, client?.id);
                    if (updatedTasks) onTasksUpdate(updatedTasks, p);
                  }
                }
              } catch (e) {
                console.error('JSON parse tasks:', e);
              }
            }

            // Sauvegarde automatique : au 5e échange, puis toutes les 10
            const count = exchangeCountRef.current;
            const neverSaved = lastSavedCountRef.current === 0;
            if (!saveInFlightRef.current && count >= 5 && (neverSaved || count - lastSavedCountRef.current >= 10)) {
              triggerSessionSave();
            }

            resolve();
          },

          onError(msg) {
            cancelPendingRaf();
            if (firstToken) {
              addMessage('a', 'Erreur : ' + msg);
            } else {
              setMessages(prev => prev.map(m =>
                m.id === streamId ? { ...m, text: 'Erreur : ' + msg, streaming: false } : m
              ));
            }
            reject(new Error(msg));
          },
        }, abortCtrl.signal);
      });
    } catch (_) {
      // Erreur déjà gérée dans onError (AbortError ignoré silencieusement)
    } finally {
      cancelPendingRaf();
      if (abortCtrlRef.current === abortCtrl) abortCtrlRef.current = null;
      isSendingRef.current = false;
      setIsLoading(false);
      setIsSending(false);
    }
  }, [client, tasks, summaries, docCache, jwtToken, currentUserId, addMessage, onTasksUpdate, members, memberIndex]); // eslint-disable-line

  async function triggerSessionSave() {
    if (!client || saveInFlightRef.current || exchangeCountRef.current < 3) return;
    const history = messagesRef.current
      .filter(m => m.role !== 'thinking' && m.text)
      .map(m => ({ role: m.role === 'u' ? 'u' : 'a', text: m.text }));
    if (history.length < 3) return;
    saveInFlightRef.current = true;
    try {
      const data = await callBackend(
        { action: 'summarize_session', client_id: client.id, history }, jwtToken
      );
      if (data.saved) {
        lastSavedCountRef.current = exchangeCountRef.current;
        onSessionSave?.(data.summary);
      }
    } catch { } finally {
      saveInFlightRef.current = false;
    }
  }

  const sendWebSearch = useCallback(async (query) => {
    if (!query?.trim() || !client || isSendingRef.current) return;
    isSendingRef.current = true;
    setIsSending(true);

    addMessage('u', query);
    setIsLoading(true);

    const ctxForPrompt = buildClientContext(client);
    const systemPrompt = buildWebSearchSystem(ctxForPrompt);

    const streamId = Date.now() + Math.random();
    let accum = '';
    let firstToken = true;

    const payload = {
      system: systemPrompt,
      message: query,
      message_type: 'web_search',
      client_id: client.id,
      chat_history: [],
    };

    const abortCtrl = new AbortController();
    abortCtrlRef.current = abortCtrl;

    try {
      await new Promise((resolve, reject) => {
        streamChatSSE(payload, jwtToken, {
          onToken(chunk) {
            accum += chunk;
            if (firstToken) {
              firstToken = false;
              setIsLoading(false);
              setMessages(prev => [...prev, {
                id: streamId, role: 'a', text: accum,
                time: new Date(), streaming: true,
              }]);
              return;
            }
            pendingDisplayRef.current = accum;
            if (!rafIdRef.current) {
              rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                setMessages(prev => prev.map(m =>
                  m.id === streamId ? { ...m, text: pendingDisplayRef.current } : m
                ));
              });
            }
          },
          onDone({ reply_text, web_sources }) {
            cancelPendingRaf();
            setMessages(prev => prev.map(m =>
              m.id === streamId
                ? { ...m, text: reply_text || '', webSources: web_sources || [], streaming: false }
                : m
            ));
            resolve();
          },
          onError(msg) {
            cancelPendingRaf();
            if (firstToken) {
              addMessage('a', 'Erreur : ' + msg);
            } else {
              setMessages(prev => prev.map(m =>
                m.id === streamId ? { ...m, text: 'Erreur : ' + msg, streaming: false } : m
              ));
            }
            reject(new Error(msg));
          },
        }, abortCtrl.signal);
      });
    } catch (_) {}
    finally {
      cancelPendingRaf();
      if (abortCtrlRef.current === abortCtrl) abortCtrlRef.current = null;
      isSendingRef.current = false;
      setIsLoading(false);
      setIsSending(false);
    }
  }, [client, jwtToken, addMessage]); // eslint-disable-line

  return { messages, isLoading, isSending, sendMessage, sendWebSearch, addMessage, clearMessages, triggerSessionSave };
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES (extraites de ui.js)
// ═══════════════════════════════════════════════════════════════════════════

/** Détecte si le message est une action sur une tâche */
function isTaskAction(msg) {
  const verbs = ['marque','assigne','change','mets','met ','passe','déplace','supprime',
    'ajoute une tâche','crée','renomme','bloque','débloque','priorité','statut',
    'p1','p2','p3','done','todo','inprogress','waiting','blocked'];
  return msg.length < 200 && verbs.some(w => msg.toLowerCase().includes(w));
}

function isClientQuestion(msg) {
  const words = ['client','projet','enjeu','kpi','contexte','brief',
    'stratégie','budget','contact','historique','document','fichier'];
  return words.some(w => msg.toLowerCase().includes(w));
}

function isTaskQuery(msg) {
  const low = msg.toLowerCase();
  const taskPatterns = [
    'tâche', 'taches', 'to-do', 'todo', 'to do',
    'avancement', 'statut des', 'où en est',
    'qu\'est-ce qui est en cours', 'qu\'est-ce qui bloque',
    'quoi de prévu', 'qu\'est-ce qui reste',
    'qui travaille sur quoi', 'mes tâches',
    'récap des tâches', 'point sur les tâches',
    'tâches prioritaires', 'tâches bloquées',
    'tâches en cours', 'tâches en attente',
    'deadline', 'échéance cette semaine',
  ];
  const statusPatterns = [
    'fais un point', 'fais le point', 'fait un point',
    'où on en est', 'on en est où', 'où en est-on', 'où en est',
    'c\'est où', 'ça en est où', 'on en est',
    // 'quoi de neuf' et 'quoi de nouveau' gérés par le backend (_TEMPORAL_BROWSE_PATTERNS)
  ];
  if (!taskPatterns.some(p => low.includes(p)) && !statusPatterns.some(p => low.includes(p))) return false;
  const topicKeywords = [
    'tracking', 'tracké', 'ga4', 'segment', 'klaviyo', 'cnil', 'pixel',
    'gtm', 'firebase', 'adjust', 'sdk',
    'document', 'fichier', 'drive', 'cahier des charges',
    'benchmark', 'attribution', 'consent', 'rgpd',
    // 'audit', 'api', 'tag', 'spec' retirés (trop génériques) — remplacés par des patterns précis :
    'audit tracking', 'audit ga4', 'audit gtm',
    'api segment', 'api klaviyo',
  ];
  if (topicKeywords.some(t => low.includes(t))) return false;
  return true;
}

function isComplexQuery(msg) {
  return ['résume','bilan','synthèse','rapport','récapitule','overview']
    .some(w => msg.toLowerCase().includes(w));
}

/** Normalise une chaîne pour la comparaison (accents, casse, ponctuation) */
function norm(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Distance de Levenshtein (pour la correspondance floue) */
function editDist(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = [];
  for (let i = 0; i <= a.length; i++) {
    dp[i] = [];
    for (let j = 0; j <= b.length; j++) dp[i][j] = i === 0 ? j : j === 0 ? i : 0;
  }
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

function wordMatches(hay, need) {
  if (hay === need) return true;
  if (need.length > 4 && editDist(hay, need) <= 1) return true;
  return false;
}

// Mots vides pour le matching de tâches — module-level pour éviter la recréation
const TASK_STOP = new Set(['pour','dans','avec','mais','donc','faut','cette','tache','veux',
  'faudrait','changer','change','mettre','passer','assigner','assigne','modifier',
  'supprime','supprimer','renomme','ajoute','creer','liste','titre','prio','statut',
  'status','faire','fait','bloque','attente','cours','relecture','coté','cote','stp',
  'svp','merci','bien','juste','aussi','puis','voila','déjà','deja']);

/**
 * Calcule le contexte de correspondance pour le prompt Claude.
 * Détermine si le message utilisateur correspond à une tâche unique (UNIQUE),
 * plusieurs (AMBIGUÏTÉ), aucune, ou une déjà dans le bon état (DÉJÀ FAIT).
 */
function computeMatchContext(txt, tasks, memberIndex, members) {
  const msgNorm = norm(txt);
  const msgWords = msgNorm.split(/\s+/).filter(w => w.length > 3 && !TASK_STOP.has(w));

  function scoreTask(task) {
    const titleWords = norm(task.title).split(/\s+/);
    return msgWords.filter(mw => titleWords.some(tw => wordMatches(tw, mw))).length;
  }

  function findAssignTarget() {
    const parts = msgNorm.split(/\s+(?:a|pour|cote|côté)\s+/);
    if (parts.length <= 1) return null;
    const afterPrep = parts[parts.length - 1].split(/\s+/).slice(0, 3).join(' ');
    const words = afterPrep.split(/\s+/);
    const found = new Set();
    for (const w of words) {
      if (memberIndex[w]) found.add(memberIndex[w]);
      for (const [term, ini] of Object.entries(memberIndex))
        if (term.length > 4 && wordMatches(w, term)) found.add(ini);
    }
    return found.size === 1 ? [...found][0] : null;
  }

  function hasMemberAmbiguity() {
    const parts = msgNorm.split(/\s+(?:a|pour|cote|côté)\s+/);
    if (parts.length <= 1) return false;
    const afterPrep = parts[parts.length - 1].split(/\s+/).slice(0, 3).join(' ');
    for (const w of afterPrep.split(/\s+/)) {
      const matches = new Set();
      if (memberIndex[w]) matches.add(memberIndex[w]);
      for (const [term, ini] of Object.entries(memberIndex))
        if (term.length > 4 && wordMatches(w, term)) matches.add(ini);
      if (matches.size > 1) return [...matches];
    }
    return false;
  }

  function alreadyDone(task) {
    const target = findAssignTarget();
    if (target) {
      const assignees = (task.assignee || '').toUpperCase().split(/[+,\s]+/).map(a => a.trim());
      if (assignees.includes(target)) return true;
    }
    const prioMatch = msgNorm.match(/\b(p[123])\b/);
    if (prioMatch && task.prio?.toUpperCase() === prioMatch[1].toUpperCase()) return true;
    const statusKw = {
      done: ['fini','termin','c est fait','livr','valid'],
      blocked: ['bloqu'], inprogress: ['en cours','travaille','commence','dessus'],
      waiting: ['attente','attend'],
    };
    for (const [status, kws] of Object.entries(statusKw))
      if (task.status === status && kws.some(k => msgNorm.includes(k))) return true;
    return false;
  }

  const scored = tasks.map(t => ({ ...t, _score: scoreTask(t) })).filter(t => t._score > 0);
  const candidates = scored.filter(t => !alreadyDone(t));
  const maxScore = candidates.reduce((mx, t) => Math.max(mx, t._score), 0);
  const topMatches = maxScore > 0 ? candidates.filter(t => t._score === maxScore) : [];
  const memberAmbig = hasMemberAmbiguity();

  if (memberAmbig) {
    const names = memberAmbig.map(ini => {
      const m = members.find(x => x.initials === ini);
      return ini + (m ? ' (' + m.name + ')' : '');
    }).join(', ');
    return 'AMBIGUÏTÉ MEMBRE — plusieurs membres correspondent : ' + names
      + '. Tu DOIS mettre clarification=true et demander lequel.';
  }
  if (topMatches.length === 1)
    return 'CORRESPONDANCE UNIQUE — agis directement : id:' + topMatches[0].id
      + ' "' + topMatches[0].title + '". clarification=false.';
  if (topMatches.length > 1)
    return 'AMBIGUÏTÉ TÂCHES — ' + topMatches.length + ' candidates, clarification=true : '
      + topMatches.map(t => 'id:' + t.id + ' "' + t.title + '"').join(' | ');
  if (scored.length > 0 && candidates.length === 0)
    return 'DÉJÀ FAIT — (' + scored.map(t => '"' + t.title + '"').join(', ')
      + ') déjà dans l\'état demandé. Informe sans modifier. clarification=true.';
  return 'AUCUNE CORRESPONDANCE — clarification=true, demande de préciser.';
}

/** Sérialise les tâches en JSON compact pour le prompt */
function snap(tasks) {
  return JSON.stringify(tasks.map(t => ({
    id: t.id, title: t.title, prio: t.prio, status: t.status,
    assignee: t.assignee, blocker: t.blocker || null,
    note: t.note || null, due_date: t.due_date || null,
  })));
}

function buildClientContext(client) {
  if (!client?.context) return 'Non renseigné.';
  try {
    const b = JSON.parse(client.context);
    const expected = ['secteur','enjeux_principaux','kpis','equipe','historique','notes'];
    if (expected.every(k => k in b)) {
      return [
        b.secteur ? 'Secteur : ' + b.secteur : null,
        b.enjeux_principaux?.length ? 'Enjeux : ' + b.enjeux_principaux.join(' | ') : null,
        b.kpis?.length ? 'KPIs : ' + b.kpis.join(' | ') : null,
        b.equipe?.length ? 'Équipe client : ' + b.equipe.map(m => {
          const name = [m.prenom, m.nom].filter(Boolean).join(' ') || m.nom || m.name || '?';
          return m.role ? `${name} (${m.role})` : name;
        }).join(', ') : null,
        b.historique ? 'Historique : ' + b.historique : null,
        b.notes ? 'Notes : ' + b.notes : null,
      ].filter(Boolean).join('\n');
    }
  } catch (_) {}
  return client.context || 'Non renseigné.';
}

function buildL1({ mStr, mFull, mInitials, maxId, matchContext, tasks, isAction, isTaskQuery, currentMember }) {
  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const responseInstruction = isAction
    ? 'Réponds en français, concis et direct.'
    : 'Réponds en français de façon précise et structurée. Pour les questions et analyses, développe ta réponse : sois complet, utilise des listes ou sections si utile, ne sois pas trop bref. Réponds directement à ce qui est demandé sans paraphraser la question.\nFORMATAGE MARKDOWN — règles strictes : (1) N\'utilise JAMAIS les backticks (`) pour des noms de fichiers, noms de campagnes, paramètres UTM, noms d\'événements ou tout identifiant non-technique — écris-les en texte ordinaire. Les backticks sont réservés uniquement au code source (SQL, JSON, Python…). (2) N\'utilise le **gras** que pour les titres de sections ou les termes véritablement clés — pas pour surligner les noms de fichiers ou les identifiants. (3) Sois homogène : si tu italicises ou mets en gras un élément, applique la même règle à tous les éléments du même type dans toute ta réponse.';
  const part1Desc = isAction
    ? 'une confirmation courte, naturelle, comme si tu répondais à un collègue (ex. "C\'est fait — assigné à KB, P2." ou "Ajouté. Tu veux préciser l\'échéance ?"). Pas de reformulation, pas de politesse excessive.'
    : 'ta réponse complète et précise. Cite tes sources entre crochets quand tu utilises un document : [NomFichier].';
  return 'Tu es un assistant de projet intégré dans l\'équipe. Tu travailles avec nous sur ce client — pas pour nous, avec nous. Tu es direct, concis, et tu n\'as pas besoin de reformuler ce qu\'on vient de dire.\n'
    + 'Principe de fiabilité : tu réponds à partir des informations fournies (fiche client, documents, '
    + 'historique). Tu n\'inventes pas et tu assumes de dire « je ne trouve pas cette information dans les '
    + 'éléments disponibles » quand c\'est le cas. Mieux vaut une réponse honnêtement incomplète qu\'une '
    + 'réponse inventée.\n'
    + 'COMPORTEMENT PAR TYPE DE QUESTION :\n'
    + '1. Questions techniques ou factuelles (« comment est tracké X ? », « quel est le CMP ? ») '
    + '→ Réponds à partir des documents injectés. Cite tes sources.\n'
    + '2. Point d\'avancement / statut (« fais un point », « où en est-on ? ») '
    + '→ Appuie-toi sur le TO-DO ci-dessous et les sessions récentes. '
    + 'Ne cherche pas dans les documents techniques, le contexte projet suffit.\n'
    + '3. Résumé de documents (« résume les derniers docs », « quoi de neuf dans le Drive ? ») '
    + '→ Concentre-toi sur les documents de travail : audits, specs, comptes-rendus, benchmarks. '
    + 'Ignore les pièces administratives (factures, devis, bons de commande, NDA). '
    + 'Si tu vois des montants financiers (EUR, TTC, HT), ne les mentionne pas.\n'
    + '4. Questions hors périmètre ou information introuvable (questions sans rapport avec le projet — météo, recettes, vie personnelle — ou données externes : concurrents, tendances marché) '
    + '→ Dis que tu ne trouves pas cette information dans les éléments disponibles. Ne réponds pas avec des connaissances générales.'
    + (!isAction && !isTaskQuery ? ' Termine ta réponse par la phrase exacte : "Veux-tu que je cherche sur internet ?" (obligatoire, sans variation).' : '')
    + '\n'
    + '5. Questions temporelles (« les derniers », « les plus récents ») '
    + '→ Priorise les contenus avec les dates les plus récentes. Les résumés de session sont les plus récents, '
    + 'puis les documents Drive triés par date de modification indiquée dans leur en-tête.\n'
    + 'CONFIDENTIALITÉ : Ne mentionne jamais de montants financiers (budgets, factures, TJM, coûts) '
    + 'dans tes réponses, même si tu les trouves dans les documents. Si la question porte spécifiquement '
    + 'sur un budget ou un coût, dis que cette information est confidentielle et suggère de consulter '
    + 'le document source directement.\n'
    + 'Date du jour : ' + today + '.\n'
    + 'TO-DO ACTUELLE : ' + snap(tasks) + '\n'
    + 'Équipe : ' + (mStr || 'Non renseignée') + '.\n'
    + 'Membres valides : ' + mFull + '. Utilise les initiales dans le JSON.\n'
    + 'Initiales pour JSON : ' + mInitials + '. Statuts : todo, inprogress, blocked, waiting, done. Priorités : P1, P2, P3.\n'
    + (currentMember ? 'L\'utilisateur connecté est ' + currentMember.name + ' (initiales : ' + currentMember.initials + '). Quand il parle de lui-même ("moi", "m\'assigner", "assigné à moi"), utilise ses initiales sans demander.\n' : '')
    + '\nANALYSE AUTOMATIQUE DE CORRESPONDANCE :\n' + matchContext + '\n'
    + '\nRègles JSON : SUIS L\'ANALYSE DE CORRESPONDANCE.\n'
    + '- Ajouter note : {"id":X,"note":"texte"}\n'
    + '- Renommer : {"id":X,"new_title":"..."}\n'
    + '- Prio : {"id":X,"prio":"P1|P2|P3"}\n'
    + '- Échéance : {"id":X,"due_date":"YYYY-MM-DD"}\n'
    + '- Assignation : assignee=initiales. "à X et Y" → assignee="X+Y".\n'
    + '- fini/terminé → done | bloqué → blocked | en cours → inprogress\n'
    + '- New : {"id":' + (maxId + 1) + ',"title":"..." (5-6 mots max, actionnable),"prio":"P2","status":"todo","assignee":"","blocker":null,"note":null}\n'
    + '\nINSTRUCTIONS :\n' + responseInstruction + '\n'
    + '- Si tu as besoin de préciser quelque chose avant d\'agir, pose UNE seule question courte et directe, pas plusieurs sous-points.\n'
    + (isTaskQuery
      ? '\nCETTE QUESTION PORTE SUR LES TÂCHES / L\'AVANCEMENT — pas sur les documents techniques.\n'
        + 'Appuie-toi sur le TO-DO ci-dessus et les sessions récentes pour répondre.\n'
        + 'Ne dis pas que tu n\'as pas de documents — tu as le contexte projet et le to-do, c\'est suffisant.\n'
      : '')
    + 'Ta réponse DOIT contenir exactement deux parties séparées par "---JSON---" :\n'
    + '\nPARTIE 1 : ' + part1Desc + '\n'
    + '\nPARTIE 2 : UN objet JSON valide :\n'
    + '{"updates":[],"new_tasks":[],"delete_ids":[],"clarification":false}';
}

function buildL2(ctxForPrompt, summaries, docCache, injectDocs = false) {
  const recent3 = summaries.slice(-3);
  let block = '\n\n[Contexte client]\n' + ctxForPrompt;
  if (recent3.length) {
    const lines = recent3.map(s => {
      const d = new Date(s.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
      return '— Session du ' + d + ' :\n' + s.summary_text;
    });
    block += '\n\n[Sessions récentes — 3 dernières]\n' + lines.join('\n\n');
  }
  if (injectDocs && docCache?.length) {
    const MAX_CHARS = 80000;
    let cacheBlock = '\n\n[Documents Drive récents]\nQuand tu utilises une info, cite le fichier entre crochets : [NomDuFichier].\n';
    let total = 0;
    for (const doc of docCache) {
      const chunk = doc.content.slice(0, 8000);
      if (total + chunk.length > MAX_CHARS) break;
      const d = doc.modifiedTime ? new Date(doc.modifiedTime).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : null;
      cacheBlock += '\n--- ' + doc.filename + (d ? ' (modifié le ' + d + ')' : '') + ' ---\n' + chunk + '\n';
      total += chunk.length;
    }
    if (total > 0) block += cacheBlock;
  }
  return block;
}

function buildWebSearchSystem(ctxForPrompt) {
  return 'Tu es un assistant de projet. Tu dois rechercher des informations sur internet pour répondre à la question posée.\n'
    + 'Contexte du client :\n' + ctxForPrompt + '\n\n'
    + 'Appuie-toi sur les résultats de recherche web pour donner une réponse factuelle et contextualisée. '
    + 'Cite tes sources web à la fin de ta réponse.\n'
    + 'Réponds en français de façon précise et structurée.';
}

function buildL3(summaries) {
  if (summaries.length <= 3) return '';
  const older = summaries.slice(0, -3);
  const lines = older.map(s => {
    const d = new Date(s.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    return '— Session du ' + d + ' :\n' + s.summary_text;
  });
  return '\n\n[Sessions plus anciennes]\n' + lines.join('\n\n');
}

/**
 * Applique les modifications de tâches depuis le JSON retourné par Claude.
 * Retourne le nouveau tableau de tâches (copie immutable).
 */
function applyTaskUpdates(tasks, p, clientId) {
  if (p.clarification) return null;
  let changed = false;
  let newTasks = tasks.map(t => ({ ...t }));

  for (const u of (p.updates || [])) {
    const t = newTasks.find(x => x.id === u.id);
    if (!t) continue;
    if (u.new_title) t.title = u.new_title;
    if (u.prio) t.prio = u.prio;
    if (u.status) t.status = u.status;
    if (u.blocker !== undefined) t.blocker = u.blocker;
    if (u.note) {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      t.note = t.note ? `${t.note}\n[${today}] ${u.note}` : `[${today}] ${u.note}`;
    }
    if (u.assignee) t.assignee = u.assignee;
    if (u.due_date !== undefined) t.due_date = u.due_date;
    changed = true;
  }

  for (const nt of (p.new_tasks || [])) {
    if (!nt.title) continue;
    newTasks.push({
      id: -Date.now(), // temp id
      title: nt.title, prio: nt.prio || 'P2', status: nt.status || 'todo',
      assignee: nt.assignee || '', blocker: nt.blocker || null,
      note: nt.note || null, due_date: nt.due_date || null,
      client_id: clientId,
    });
    changed = true;
  }

  for (const did of (p.delete_ids || [])) {
    newTasks = newTasks.filter(t => t.id !== did);
    changed = true;
  }

  return changed ? { tasks: newTasks, ops: p } : null;
}
