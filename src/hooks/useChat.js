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
import { useState, useRef, useCallback } from 'react';
import { callBackend } from '../lib/backend';

export function useChat({ client, tasks, summaries, docCache, jwtToken, onTasksUpdate, onSessionSave }) {
  // Tableau des messages affichés dans le chat
  const [messages, setMessages] = useState([]);
  // true pendant l'appel backend (affiche le "thinking...")
  const [isLoading, setIsLoading] = useState(false);
  // Compteur d'échanges pour déclencher la sauvegarde de session
  const exchangeCountRef = useRef(0);
  const sessionSavedRef = useRef(false);
  const inactivityTimerRef = useRef(null);

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
    setMessages([]);
    exchangeCountRef.current = 0;
    sessionSavedRef.current = false;
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
  }, []);

  // ── Envoi d'un message ────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text, fileAttachment = null) => {
    if (!text?.trim() || !client) return;

    exchangeCountRef.current++;
    resetInactivityTimer();

    // Afficher le message utilisateur
    addMessage('u', text, fileAttachment ? { file: fileAttachment } : {});
    setIsLoading(true);

    const members = getMembers(client);
    const mStr = members.map(m => m.initials + '=' + (m.name || m.initials)).join(', ');
    const mFull = members.map(m => 'initiales:' + m.initials + ' nom:"' + (m.name || m.initials) + '"').join(', ');
    const mInitials = members.map(m => m.initials).join(', ') || 'KB, PH';
    const maxId = tasks.length ? Math.max(...tasks.map(t => t.id)) : 0;

    // Extraire l'historique des 8 derniers échanges pour Claude
    const historyStr = messages.slice(-9).map(m => {
      const who = m.role === 'u' ? 'Utilisateur' : 'Assistant';
      return m.text ? who + ': ' + m.text : '';
    }).filter(Boolean).join('\n');

    // ── Correspondance déterministe tâche↔message ─────────────────────────
    const matchContext = computeMatchContext(text, tasks, members);

    // ── Contexte client pour le prompt ────────────────────────────────────
    const ctxForPrompt = buildClientContext(client);

    // ── Sélection du niveau de prompt (L1/L2/L3) ─────────────────────────
    const _isAction   = isTaskAction(text);
    const _isQuestion = isClientQuestion(text);
    const _isComplex  = isComplexQuery(text);
    const _needL2 = _isQuestion || _isComplex || (!_isAction && !_isQuestion && !_isComplex);
    const _needL3 = _isComplex;

    const systemPrompt =
      buildL1({ mStr, mFull, mInitials, maxId, matchContext, historyStr, tasks, isAction: _isAction }) +
      (_needL2 ? buildL2(ctxForPrompt, summaries, docCache) : '') +
      (_needL3 ? buildL3(summaries) : '');

    // ── Chat history pour Claude (multi-turn) ─────────────────────────────
    const chatHistory = messages
      .filter(m => m.role !== 'thinking')
      .slice(-6)
      .map(m => ({ role: m.role === 'u' ? 'u' : 'a', text: m.text || '' }));

    try {
      const messageType = _isAction ? 'task_action' : 'chat';
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

      const data = await callBackend(payload, jwtToken);
      if (data.error) throw new Error(data.error);

      const raw = data.text || '';
      const sources = data.sources_used || [];

      // ── Découper texte et JSON de tâches ─────────────────────────────────
      const parts = raw.split('---JSON---');
      const replyText = parts[0].trim();
      const jsonStr = (parts[1] || '').trim();

      const msgId = Date.now();
      addMessage('a', replyText, { id: msgId, sources });

      // ── Appliquer les modifications de tâches depuis le JSON ──────────────
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

      // Sauvegarde automatique de session après 5 échanges ou toutes les 10
      const count = exchangeCountRef.current;
      if (!sessionSavedRef.current && (count === 5 || (count > 5 && count % 10 === 0))) {
        triggerSessionSave();
      }

    } catch (e) {
      addMessage('a', 'Erreur : ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }, [client, tasks, summaries, docCache, jwtToken, messages, addMessage, onTasksUpdate]); // eslint-disable-line

  async function triggerSessionSave() {
    if (!client || sessionSavedRef.current || exchangeCountRef.current < 3) return;
    const history = messages
      .filter(m => m.role !== 'thinking' && m.text)
      .map(m => ({ role: m.role === 'u' ? 'u' : 'a', text: m.text }));
    if (history.length < 3) return;
    sessionSavedRef.current = true;
    try {
      const data = await callBackend(
        { action: 'summarize_session', client_id: client.id, history }, jwtToken
      );
      if (data.saved) onSessionSave?.(data.summary);
      else sessionSavedRef.current = false;
    } catch { sessionSavedRef.current = false; }
  }

  return { messages, isLoading, sendMessage, addMessage, clearMessages, triggerSessionSave };
}

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES (extraites de ui.js)
// ═══════════════════════════════════════════════════════════════════════════

function getMembers(client) {
  try { return JSON.parse(client?.members || '[]'); } catch { return []; }
}

/** Détecte si le message est une action sur une tâche */
function isTaskAction(msg) {
  if (isClientQuestion(msg)) return false;
  const verbs = ['marque','assigne','change','mets','met ','passe','déplace','supprime',
    'ajoute une tâche','crée','renomme','bloque','débloque','priorité','statut',
    'p1','p2','p3','done','todo','inprogress','waiting','blocked'];
  return msg.length < 200 && verbs.some(w => msg.toLowerCase().includes(w));
}

function isClientQuestion(msg) {
  const words = ['?','client','projet','enjeu','kpi','contexte','brief',
    'stratégie','budget','contact','historique','document','fichier'];
  return words.some(w => msg.toLowerCase().includes(w));
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

/**
 * Calcule le contexte de correspondance pour le prompt Claude.
 * Détermine si le message utilisateur correspond à une tâche unique (UNIQUE),
 * plusieurs (AMBIGUÏTÉ), aucune, ou une déjà dans le bon état (DÉJÀ FAIT).
 */
function computeMatchContext(txt, tasks, members) {
  const STOP = new Set(['pour','dans','avec','mais','donc','faut','cette','tache','veux',
    'faudrait','changer','change','mettre','passer','assigner','assigne','modifier',
    'supprime','supprimer','renomme','ajoute','creer','liste','titre','prio','statut',
    'status','faire','fait','bloque','attente','cours','relecture','coté','cote','stp',
    'svp','merci','bien','juste','aussi','puis','voila','déjà','deja']);

  const memberIndex = {};
  for (const m of members) {
    const ini = m.initials.toUpperCase();
    memberIndex[norm(m.initials)] = ini;
    norm(m.name || m.initials).split(/\s+/).filter(w => w.length > 1)
      .forEach(w => { memberIndex[w] = ini; });
  }

  const msgNorm = norm(txt);
  const msgWords = msgNorm.split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));

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
        b.equipe?.length ? 'Équipe client : ' + b.equipe.join(', ') : null,
        b.historique ? 'Historique : ' + b.historique : null,
        b.notes ? 'Notes : ' + b.notes : null,
      ].filter(Boolean).join('\n');
    }
  } catch (_) {}
  return client.context || 'Non renseigné.';
}

function buildL1({ mStr, mFull, mInitials, maxId, matchContext, historyStr, tasks, isAction }) {
  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const responseInstruction = isAction
    ? 'Réponds en français, concis et direct.'
    : 'Réponds en français de façon précise et structurée. Pour les questions et analyses, développe ta réponse : sois complet, utilise des listes ou sections si utile, ne sois pas trop bref. Réponds directement à ce qui est demandé sans paraphraser la question.';
  const part1Desc = isAction
    ? 'ta réponse courte confirmant l\'action effectuée (1-2 phrases max).'
    : 'ta réponse complète et précise. Cite tes sources entre crochets quand tu utilises un document : [NomFichier].';
  return 'Tu es l\'assistant projet de l\'équipe sur ce client.\n'
    + 'Date du jour : ' + today + '.\n'
    + 'TO-DO ACTUELLE : ' + snap(tasks) + '\n'
    + 'Équipe : ' + (mStr || 'Non renseignée') + '.\n'
    + 'Membres valides : ' + mFull + '. Utilise les initiales dans le JSON.\n'
    + 'Initiales pour JSON : ' + mInitials + '. Statuts : todo, inprogress, blocked, waiting, done. Priorités : P1, P2, P3.\n'
    + '\nANALYSE AUTOMATIQUE DE CORRESPONDANCE :\n' + matchContext + '\n'
    + (historyStr ? '\nHISTORIQUE :\n' + historyStr + '\n' : '')
    + '\nINSTRUCTIONS :\n' + responseInstruction + ' Ta réponse DOIT contenir exactement deux parties séparées par "---JSON---" :\n'
    + '\nPARTIE 1 : ' + part1Desc + '\n'
    + '\nPARTIE 2 : UN objet JSON valide :\n'
    + '{"updates":[],"new_tasks":[],"delete_ids":[],"clarification":false}\n'
    + '\nRègles JSON : SUIS L\'ANALYSE DE CORRESPONDANCE.\n'
    + '- Ajouter note : {"id":X,"note":"texte"}\n'
    + '- Renommer : {"id":X,"new_title":"..."}\n'
    + '- Prio : {"id":X,"prio":"P1|P2|P3"}\n'
    + '- Échéance : {"id":X,"due_date":"YYYY-MM-DD"}\n'
    + '- Assignation : assignee=initiales. "à X et Y" → assignee="X+Y".\n'
    + '- fini/terminé → done | bloqué → blocked | en cours → inprogress\n'
    + '- New : {"id":' + (maxId + 1) + ',"title":"...","prio":"P2","status":"todo","assignee":"","blocker":null,"note":null}';
}

function buildL2(ctxForPrompt, summaries, docCache) {
  const recent3 = summaries.slice(-3);
  let block = '\n\n[Contexte client]\n' + ctxForPrompt;
  if (recent3.length) {
    const lines = recent3.map(s => {
      const d = new Date(s.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
      return '— Session du ' + d + ' :\n' + s.summary_text;
    });
    block += '\n\n[Sessions récentes — 3 dernières]\n' + lines.join('\n\n');
  }
  if (docCache?.length) {
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
    if (u.note !== undefined) {
      if (t.note && u.note && u.note !== t.note) {
        const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        t.note = t.note + '\n[' + today + '] ' + u.note;
      } else t.note = u.note;
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
