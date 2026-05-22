// ════════════════════════════════════════════════════════
// ui.js — Rendu sidebar, chat, todo, modals, KB, sources,
//          tâches (renderTodo, drag & drop inclus)
// Dépend de : db.js
// ════════════════════════════════════════════════════════
async function loadPreviousSummaries(clientId, limit=5){
  try {
    const {data, error} = await sb
      .from('session_summaries')
      .select('summary_text, created_at')
      .eq('client_id', clientId)
      .order('created_at', {ascending: false})
      .limit(limit);
    if(error) { console.error('loadPreviousSummaries:', error.message); return []; }
    return (data||[]).reverse(); // ordre chronologique pour le system prompt
  } catch(e) { console.error('loadPreviousSummaries:', e); return []; }
}


// ── CC-211 — Détection d'intention pour prompt adaptatif ─────────────────
// Retourne true si le message est une action tâche (verbe d'action court).
// Court-circuit : longueur < 200 chars pour éviter les faux positifs sur
// des messages longs qui citent une tâche en passant.
function isTaskAction(msg) {
  if (isClientQuestion(msg)) return false; // question client prioritaire
  const verbs = [
    'marque','assigne','change','mets','met ','passe',
    'déplace','supprime','ajoute une tâche','crée','renomme',
    'bloque','débloque','priorité','statut','p1','p2','p3',
    'done','todo','inprogress','waiting','blocked'
  ];
  return msg.length < 200 && verbs.some(w => msg.toLowerCase().includes(w));
}

// Retourne true si le message pose une question sur le contexte client.
function isClientQuestion(msg) {
  const words = [
    '?','client','projet','enjeu','kpi','contexte','brief',
    'stratégie','budget','contact','historique','document','fichier'
  ];
  return words.some(w => msg.toLowerCase().includes(w));
}

// Retourne true si le message demande un bilan / résumé étendu.
function isComplexQuery(msg) {
  const words = ['résume','bilan','synthèse','rapport','récapitule','overview'];
  return words.some(w => msg.toLowerCase().includes(w));
}

// ── CC-211 — Constructeurs L1 / L2 / L3 ──────────────────────────────────
// buildL1 : instructions tâches, JSON schema, membres, matchContext, historique.
// Paramètres issus du scope de send() — appelé depuis l'intérieur de send().
function buildL1({ mStr, mFull, mInitials, maxId, matchContext, historyStr }) {
  const today = new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  return 'Tu es l\'assistant projet de l\'équipe sur le client '+cur.name+'.\n'
    +'Date du jour : '+today+'.\n'
    +'TO-DO ACTUELLE : '+snap()+'\n'
    +'Équipe : '+(mStr||'Non renseignée')+'.\n'
    +'Membres valides (initiales et noms complets) : '+mFull+'. Utilise les initiales dans le JSON.\n'
    +'Initiales seules pour JSON : '+mInitials+'. Statuts : todo, inprogress, blocked, waiting, done. Priorités : P1, P2, P3.\n'
    +'\nANALYSE AUTOMATIQUE DE CORRESPONDANCE (calculée avant appel) :\n'+matchContext+'\n'
    +(historyStr?'\nHISTORIQUE :\n'+historyStr+'\n':'')
    +'\nINSTRUCTIONS :\n'
    +'Réponds en français, concis et direct. Tu gères la to-do intégrée.\n'
    +'Ta réponse DOIT contenir exactement deux parties séparées par "---JSON---" :\n'
    +'\nPARTIE 1 : ta réponse conversationnelle.\n'
    +'- Si une action est ambiguë (plusieurs tâches correspondent), pose la question ici.\n'
    +'- Si tu effectues une action to-do, confirme-la brièvement.\n'
    +'\nPARTIE 2 : UN objet JSON valide (sans markdown) :\n'
    +'{"updates":[],"new_tasks":[],"delete_ids":[],"clarification":false}\n'
    +'\nRègles JSON :\n'
    +'SUIS L\'ANALYSE DE CORRESPONDANCE fournie dans le contexte (UNIQUE/AMBIGUÏTÉ/DÉJÀ FAIT/AUCUNE).\n'
    +'- Note vs nouvelle tâche : "pour la tâche X" / "concernant X" / "sur la tâche X" → AJOUTER UNE NOTE à la tâche existante (note dans updates), PAS créer une nouvelle tâche.\n'
    +'  Créer une NOUVELLE tâche UNIQUEMENT si : verbe explicite "crée/ajoute/nouvelle tâche" ET aucune tâche existante ne correspond.\n'
    +'- Ajouter note : {"id":X,"note":"texte de la note"}\n'
    +'- Renommer : {"id":X,"new_title":"nouveau titre"}\n'
    +'- Prio : {"id":X,"prio":"P1|P2|P3"}\n'
    +'- Échéance : {"id":X,"due_date":"YYYY-MM-DD"} — utilise ce format ISO. Pour supprimer : {"id":X,"due_date":null}\n'
    +'- Assignation : "à X" / "côté X" → assignee=initiales X. "à X et Y" → assignee="X+Y".\n'
    +'- Relecture : "passer en relecture côté X" → assignee=X + status=waiting.\n'
    +'- fini/terminé → done | bloqué → blocked | en cours → inprogress | retour/retravailler → todo.\n'
    +'- L\'assignee DOIT changer quand la tâche passe à quelqu\'un d\'autre.\n'
    +'\nExemples :\n'
    +'Update statut : {"updates":[{"id":2,"status":"waiting","assignee":"PH","note":"En attente relecture PH","blocker":null}],"new_tasks":[],"delete_ids":[],"clarification":false}\n'
    +'Changer priorité : {"updates":[{"id":2,"prio":"P1"}],"new_tasks":[],"delete_ids":[],"clarification":false}\n'
    +'Renommer : {"updates":[{"id":2,"new_title":"Nouveau titre"}],"new_tasks":[],"delete_ids":[],"clarification":false}\n'
    +'Ambiguïté 2 tâches similaires : {"updates":[],"new_tasks":[],"delete_ids":[],"clarification":true}\n'
    +'New : {"updates":[],"new_tasks":[{"id":'+(maxId+1)+',"title":"...","prio":"P2","status":"todo","assignee":"KB","blocker":null,"note":null}],"delete_ids":[],"clarification":false}\n'
    +'Ambiguïté : {"updates":[],"new_tasks":[],"delete_ids":[],"clarification":true}';
}

// buildL2 : fiche client + 3 résumés récents + doc cache CC-212.
// Appelé quand la question porte sur le contexte client ou qu'on ne sait pas.
function buildL2(ctxForPrompt) {
  const summaries = cur?._summaries || [];
  const recent3 = summaries.slice(-3); // les 3 plus récents
  let block = '\n\n[Contexte client]\n' + ctxForPrompt;
  if (recent3.length) {
    const lines = recent3.map(s => {
      const d = new Date(s.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'});
      return '— Session du '+d+' :\n'+s.summary_text;
    });
    block += '\n\n[Sessions récentes — 3 dernières]\n' + lines.join('\n\n');
  }
  // CC-212 — Injecter le doc cache (10 fichiers Drive récents, full text)
  // ~80k chars max (~20k tokens) pour ne pas saturer la fenêtre de contexte
  if(cur?._docCache?.length){
    const MAX_CHARS = 80000;
    let cacheBlock = '\n\n[Documents Drive récents]\n';
    let total = 0;
    for(const doc of cur._docCache){
      const chunk = doc.content.slice(0,8000); // max 8k chars par doc
      if(total + chunk.length > MAX_CHARS) break;
      const d = new Date(doc.modifiedTime).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'});
      cacheBlock += '\n--- '+doc.filename+' (modifié le '+d+') ---\n'+chunk+'\n';
      total += chunk.length;
    }
    if(total > 0){
      block += cacheBlock;
      console.debug('[CC-212] Doc cache injecté : '+total+' chars (~'+Math.round(total/4)+' tokens)');
    }
  }
  return block;
}

// buildL3 : résumés supplémentaires (indices 0 à N-4, du plus ancien au plus récent).
// Appelé seulement pour les demandes de bilan / synthèse complète.
function buildL3() {
  const summaries = cur?._summaries || [];
  if (summaries.length <= 3) return ''; // L2 a déjà tout couvert
  const older = summaries.slice(0, -3); // tout sauf les 3 déjà en L2
  const lines = older.map(s => {
    const d = new Date(s.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'});
    return '— Session du '+d+' :\n'+s.summary_text;
  });
  return '\n\n[Sessions plus anciennes]\n' + lines.join('\n\n');
}

// Extraire l'historique visible dans le chat (messages user + assistant)
function extractChatHistory(){
  return [...$('msgs').querySelectorAll('.msg')].map(m => ({
    role: m.classList.contains('u') ? 'u' : 'a',
    text: m.querySelector('.bubble')?.textContent?.trim() || ''
  })).filter(m => m.text);
}

// Sauvegarder la session courante si elle a assez d'échanges
async function saveSessionSummary(){
  if(!cur || sessionSaved || sessionExchangeCount < 3) return;
  const history = extractChatHistory();
  if(history.length < 3) return;
  sessionSaved = true; // flag optimiste pour éviter les doubles appels
  try {
    const r = await fetch(EDGE_URL, {
      method: 'POST',
      headers: EDGE_HEADERS,
      body: JSON.stringify({action: 'summarize_session', client_id: cur.id, history})
    });
    const data = await r.json();
    if(data.saved){
      showSessionSavedBadge();
      if(!cur._summaries) cur._summaries = [];
      cur._summaries.push({summary_text: data.summary, created_at: new Date().toISOString()});
      if(cur._summaries.length > 5) cur._summaries.shift();
      _histLoadedForClientId = null; // force history panel refresh on next open
    } else {
      sessionSaved = false; // permettre un retry si erreur
    }
  } catch(e){ sessionSaved = false; console.error('saveSessionSummary:', e); }
}

// Badge discret "Session sauvegardée ✓"
function showSessionSavedBadge(){
  const existing = document.querySelector('.session-saved-badge');
  if(existing) existing.remove();
  const badge = document.createElement('div');
  badge.className = 'session-saved-badge';
  badge.textContent = 'Session sauvegardée ✓';
  document.body.appendChild(badge);
  setTimeout(() => { badge.style.opacity='0'; setTimeout(()=>badge.remove(), 400); }, 3000);
}

// Timer d'inactivité : sauvegarde après 10 min sans message
function resetInactivityTimer(){
  if(inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => { saveSessionSummary(); }, 10 * 60 * 1000);
}

// Onglets du modal Paramètres
function switchSettingsTab(tab){
  ['params','hist'].forEach(t => {
    $('stab-'+t).classList.toggle('on', t===tab);
    $('settings-panel-'+t).classList.toggle('hide', t!==tab);
  });
  if(tab==='hist') loadHistoryPanel();
}

let _histLoadedForClientId = null;

async function loadHistoryPanel(){
  if(!cur) return;
  if(_histLoadedForClientId === cur.id) return;
  _histLoadedForClientId = cur.id;
  $('hist-loading').style.display='block';
  $('hist-list').innerHTML='';
  const summaries = await loadPreviousSummaries(cur.id, 20);
  $('hist-loading').style.display='none';
  if(!summaries.length){
    $('hist-list').innerHTML='<div style="font-size:12px;color:var(--tx3);font-style:italic;padding:8px 0">Aucun résumé de session enregistré.</div>';
    return;
  }
  $('hist-list').innerHTML = [...summaries].reverse().map(s => {
    const d = new Date(s.created_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    return `<div class="hist-entry"><div class="hist-date">${d}</div><div class="hist-text">${esc(s.summary_text)}</div></div>`;
  }).join('');
}

function fmtMsgTime(d){
  const now=new Date();
  const isToday=d.toDateString()===now.toDateString();
  const yesterday=new Date(now); yesterday.setDate(now.getDate()-1);
  const isYest=d.toDateString()===yesterday.toDateString();
  const hm=d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  if(isToday) return hm;
  if(isYest) return 'Hier '+hm;
  return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'})+' '+hm;
}
function addMsg(role,text,badge){
  const c=$('msgs');
  const d=document.createElement('div'); d.className='msg '+role;
  if(role==='a'){const w=document.createElement('div');w.className='msg-who';w.textContent='Claude · '+(cur?.name||'');d.appendChild(w);}
  const b=document.createElement('div'); b.className='bubble'; b.textContent=text; d.appendChild(b);
  if(badge){const bg=document.createElement('div');bg.className='msg-badge';bg.textContent=badge;d.appendChild(bg);}
  const t=document.createElement('div'); t.className='msg-time'; t.textContent=fmtMsgTime(new Date()); d.appendChild(t);
  c.appendChild(d); c.scrollTop=c.scrollHeight;
  return d;
}

function addThinking(){
  const c=$('msgs');
  const d=document.createElement('div'); d.className='msg a';
  const w=document.createElement('div');w.className='msg-who';w.textContent='Claude · '+(cur?.name||'');d.appendChild(w);
  const b=document.createElement('div');b.className='thinking';b.innerHTML='<div class="dp"></div><div class="dp"></div><div class="dp"></div>';d.appendChild(b);
  c.appendChild(d); c.scrollTop=c.scrollHeight;
  return d;
}

// ── CC-213 — Agency Knowledge Base ───────────────────────────────────────
let _kbPendingText = '';

function addKbButton(msgEl, text){
  const btn = document.createElement('button');
  btn.className = 'kb-btn';
  btn.innerHTML = '+ KB';
  btn.title = 'Sauvegarder cet insight dans la base de savoir';
  btn.onclick = () => openKbModal(text, btn);
  msgEl.appendChild(btn);
}

function openKbModal(text, btn){
  _kbPendingText = text;
  _kbPendingBtn = btn;
  // Pré-remplir le contenu — l'utilisateur peut éditer avant de sauvegarder
  $('kb-content').value = text;
  $('kb-title').value = '';
  $('kb-tags').value = '';
  $('kb-save-err').style.display = 'none';
  $('kb-modal-overlay').classList.add('open');
  setTimeout(() => $('kb-title').focus(), 50);
}

function closeKbModal(){
  $('kb-modal-overlay').classList.remove('open');
}

async function confirmSaveToKb(){
  const title = $('kb-title').value.trim();
  const content = $('kb-content').value.trim();
  const tagsRaw = $('kb-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t=>t.trim()).filter(Boolean) : [];
  const err = $('kb-save-err');
  if(!title){ err.textContent='Le titre est obligatoire.'; err.style.display='block'; return; }
  if(!content){ err.textContent='Le contenu est obligatoire.'; err.style.display='block'; return; }
  err.style.display='none';
  const savedBy = cur ? getMembers()[0]?.initials || '' : '';
  try {
    const res = await fetch(EDGE_URL,{method:'POST',headers:EDGE_HEADERS,body:JSON.stringify({
      action:'save_to_kb', title, content,
      source_client: cur?.name || null,
      tags, saved_by: savedBy,
    })});
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    closeKbModal();
    if(_kbPendingBtn){ _kbPendingBtn.innerHTML='✓ KB'; _kbPendingBtn.classList.add('saved'); _kbPendingBtn.disabled=true; }
  } catch(e){
    err.textContent = 'Erreur : '+e.message;
    err.style.display = 'block';
  }
}

// ── KB Browser ────────────────────────────────────────────────────────────
let _kbEntries = [];
let _kbPendingBtn = null;

async function openKbBrowser(){
  $('kb-browser-overlay').classList.add('open');
  $('kb-search').value = '';
  $('kb-browser-list').innerHTML = '<div style="color:var(--tx3);font-size:13px;padding:8px 0">Chargement…</div>';
  try {
    const { data, error } = await sb.from('agency_knowledge').select('*').order('created_at',{ascending:false});
    if(error) throw new Error(error.message);
    _kbEntries = data || [];
    renderKbBrowser();
  } catch(e){
    $('kb-browser-list').innerHTML = '<div style="color:var(--red);font-size:13px">Erreur : '+e.message+'</div>';
  }
}

function renderKbBrowser(){
  const q = ($('kb-search')?.value||'').toLowerCase();
  const filtered = _kbEntries.filter(e =>
    !q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) ||
    (e.tags||[]).some(t=>t.toLowerCase().includes(q))
  );
  if(!filtered.length){
    $('kb-browser-list').innerHTML='<div style="color:var(--tx3);font-size:13px;padding:8px 0">'+(q?'Aucun résultat.':'Aucun insight sauvegardé pour le moment.')+'</div>';
    return;
  }
  $('kb-browser-list').innerHTML = filtered.map(e => {
    const date = new Date(e.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'});
    const tags = (e.tags||[]).map(t=>'<span class="kb-tag" style="cursor:default">'+esc(t)+'</span>').join(' ');
    return '<div class="kb-entry">'+
      '<div class="kb-entry-title">'+esc(e.title)+'</div>'+
      '<div class="kb-entry-content">'+esc(e.content)+'</div>'+
      '<div class="kb-entry-meta">'+
        (e.saved_by?'<span>'+esc(e.saved_by)+'</span>':'')+
        '<span>'+date+'</span>'+
        (e.source_client?'<span>'+esc(e.source_client)+'</span>':'')+
        (tags?'<span>'+tags+'</span>':'')+
        '<button class="kb-del" title="Supprimer" onclick="deleteKbEntry(&quot;'+e.id+'&quot;)">✕</button>'+
      '</div>'+
    '</div>';
  }).join('');
}

async function deleteKbEntry(id){
  if(!confirm('Supprimer cet insight ?')) return;
  const { error } = await sb.from('agency_knowledge').delete().eq('id',id);
  if(error){ alert('Erreur : '+error.message); return; }
  _kbEntries = _kbEntries.filter(e=>e.id!==id);
  renderKbBrowser();
}

function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}

// ── Panel resizer ─────────────────────────────────────────────────────────
(function(){
  const resizer=document.getElementById('panel-resizer');
  const todo=document.getElementById('todo-panel');
  if(!resizer||!todo) return;
  let drag=false, sx=0, sw=0;
  resizer.addEventListener('mousedown',e=>{
    drag=true; sx=e.clientX; sw=todo.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cssText+='cursor:col-resize;user-select:none';
  });
  document.addEventListener('mousemove',e=>{
    if(!drag) return;
    const w=Math.min(600,Math.max(240,sw+(sx-e.clientX)));
    todo.style.width=w+'px';
  });
  document.addEventListener('mouseup',()=>{
    if(!drag) return; drag=false;
    resizer.classList.remove('dragging');
    document.body.style.cursor=''; document.body.style.userSelect='';
    try{ localStorage.setItem('cc-todo-w',todo.offsetWidth); }catch(_){}
  });
  try{
    const saved=parseInt(localStorage.getItem('cc-todo-w')||'0');
    if(saved>=240&&saved<=600) todo.style.width=saved+'px';
  }catch(_){}
})();
// Shared handler: close all open source tooltips on any outside click
document.addEventListener('click',()=>{
  document.querySelectorAll('.sources-tooltip').forEach(t=>t.style.display='none');
});
function resize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}

async function callClaude(system,message,file=null,clientId=null,messageType='chat'){
  const payload={system,message};
  if(file) payload.file=file;
  if(clientId) payload.client_id=clientId;
  payload.message_type=messageType;
  const r=await fetch(EDGE_URL,{method:'POST',headers:EDGE_HEADERS,body:JSON.stringify(payload)});
  const data=await r.json();
  if(data.error) throw new Error(data.error);
  return { text: data.text, sources: data.sources_used || [] };
}

// CC-203 — Icônes par source_type
function sourceIcon(type){
  const icons = {
    drive: '<i data-lucide="folder-open" style="width:14px;height:14px;vertical-align:-2px"></i>',
    doc:   '<i data-lucide="folder-open" style="width:14px;height:14px;vertical-align:-2px"></i>',
    sheet: '<i data-lucide="folder-open" style="width:14px;height:14px;vertical-align:-2px"></i>',
    session:'<i data-lucide="clock" style="width:14px;height:14px;vertical-align:-2px"></i>',
    notion: '<i data-lucide="layout-grid" style="width:14px;height:14px;vertical-align:-2px"></i>',
  };
  return icons[type] || '<i data-lucide="star" style="width:14px;height:14px;vertical-align:-2px"></i>';
}

// CC-203 — Ajouter le badge sources sous un message Claude
function addSourcesBadge(msgEl, sources){
  if(!sources||sources.length===0) return;
  const badge=document.createElement('div');
  badge.className='msg-badge msg-sources-badge';
  badge.style.cssText='cursor:pointer;user-select:none;position:relative;';
  badge.textContent='📚 '+sources.length+' source'+(sources.length>1?'s':'');

  // Tooltip
  const tip=document.createElement('div');
  tip.className='sources-tooltip';
  tip.style.cssText='display:none;position:absolute;bottom:calc(100% + 6px);left:0;background:var(--sur);border:1px solid var(--brd2);border-radius:var(--r);padding:10px 12px;min-width:260px;max-width:340px;z-index:999;color:var(--tx);box-shadow:0 2px 12px rgba(0,0,0,.1);';

  sources.forEach(s=>{
    const row=document.createElement('div');
    row.style.cssText='margin-bottom:8px;font-size:12px;line-height:1.4;';
    row.innerHTML='<span style="font-weight:600;">'+sourceIcon(s.source_type)+' '+s.source_name+'</span>'
      +'<div style="color:var(--tx3,#888);margin-top:2px;">'+s.preview+'…</div>';
    tip.appendChild(row);
  });

  badge.appendChild(tip);

  badge.addEventListener('click',e=>{
    e.stopPropagation();
    const isOpen = tip.style.display !== 'none';
    document.querySelectorAll('.sources-tooltip').forEach(t=>t.style.display='none');
    if(!isOpen) tip.style.display='block';
  });

  msgEl.appendChild(badge);
  lucide.createIcons();
}

function snap(){
  return JSON.stringify(tasks.map(t=>({id:t.id,title:t.title,prio:t.prio,status:t.status,assignee:t.assignee,blocker:t.blocker||null,note:t.note||null,due_date:t.due_date||null})));
}

async function send(){
  const inp=$('inp'), txt=inp.value.trim();
  if(!txt||!cur) return;
  const sendBtn = document.querySelector('.send');
  sendBtn.disabled = true;
  inp.disabled = true;
  inp.value=''; inp.style.height='auto';
  const fileToSend = selectedFile ? {...selectedFile} : null;
  if(fileToSend){ clearFile(); }
  // Affichage message utilisateur + badge fichier éventuel
  const userMsgEl = addMsg('u', txt);
  if(fileToSend){
    const badge = document.createElement('div');
    badge.className = 'msg-file-badge';
    badge.innerHTML = '<i data-lucide="paperclip" style="width:12px;height:12px;vertical-align:-1px"></i> ' + esc(fileToSend.name);
    userMsgEl.insertBefore(badge, userMsgEl.querySelector('.bubble'));
  }
  sessionExchangeCount++;
  resetInactivityTimer();
  const th=addThinking();

  const mems=getMembers();
  const mStr=mems.map(m=>m.initials+'='+( m.name||m.initials)).join(', ');
  const mFull=mems.map(m=>'initiales:'+m.initials+' nom:"'+(m.name||m.initials)+'"').join(', ');
  const mInitials=mems.map(m=>m.initials).join(', ')||'KB, PH';
  const maxId=tasks.length?Math.max(...tasks.map(t=>t.id)):0;

  // Historique des 8 derniers échanges
  const allMsgs=[...$('msgs').querySelectorAll('.msg')];
  const historyMsgs=allMsgs.slice(-9,-1);
  const historyStr=historyMsgs.map(m=>{
    const who=m.classList.contains('u')?'Utilisateur':'Assistant';
    const text=m.querySelector('.bubble')?.textContent?.trim()||'';
    return text?who+': '+text:'';
  }).filter(Boolean).join('\n');

  // ── CORRESPONDANCE DÉTERMINISTE v3 ──
  // Architecture :
  // 1. Construire un index terme→initiales depuis les membres (prénom, nom, initiales)
  // 2. Scorer chaque tâche par mots-clés du message dans son titre (Levenshtein ≤1)
  // 3. Identifier la cible d'assignation dans le message via l'index membres
  // 4. Filtrer les tâches dont l'état demandé est déjà vrai
  // 5. Résultat : 0→demander | 1→agir | 2+→demander laquelle

  function norm(str) {
    return (str||'').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')  // accents
      .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  }

  function editDist(a, b) {
    if(Math.abs(a.length-b.length) > 2) return 99;
    const dp = [];
    for(let i=0;i<=a.length;i++) { dp[i]=[]; for(let j=0;j<=b.length;j++) dp[i][j]=i===0?j:j===0?i:0; }
    for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++)
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[a.length][b.length];
  }

  // Vrai si mot needle correspond à mot haystack (exact ou Levenshtein ≤1 pour mots >4 lettres)
  function wordMatches(hay, need) {
    if(hay === need) return true;
    if(need.length > 4 && editDist(hay, need) <= 1) return true;
    return false;
  }

  // Construire index terme→initiales depuis les membres
  const members = getMembers();
  const memberIndex = {}; // terme normalisé → initiales
  for(const m of members) {
    const ini = m.initials.toUpperCase();
    // Initiales (ex: "ph", "kb")
    memberIndex[norm(m.initials)] = ini;
    // Chaque mot du nom (prénom, particule, nom de famille)
    norm(m.name || m.initials).split(/\s+/).filter(w=>w.length>1).forEach(w => {
      memberIndex[w] = ini;
    });
  }

  // Trouver quel membre est mentionné dans un fragment de texte
  function findMemberInText(txt) {
    const words = norm(txt).split(/\s+/);
    const found = new Set();
    for(const w of words) {
      // Match exact
      if(memberIndex[w]) found.add(memberIndex[w]);
      // Match fuzzy sur termes > 4 lettres
      for(const [term, ini] of Object.entries(memberIndex)) {
        if(term.length > 4 && wordMatches(w, term)) found.add(ini);
      }
    }
    // Si plusieurs membres correspondent → ambiguïté → retourner null
    // pour forcer une demande de clarification
    if(found.size === 1) return [...found][0];
    return null;
  }

  const STOP = new Set(['pour','dans','avec','mais','donc','faut','cette','tache','veux',
    'faudrait','changer','change','mettre','passer','assigner','assigne','modifier',
    'supprime','supprimer','renomme','ajoute','creer','liste','titre','prio','statut',
    'status','faire','fait','bloque','attente','cours','relecture','coté','cote','stp',
    'svp','merci','bien','juste','aussi','puis','voila','déjà','deja']);

  const msgNorm = norm(txt);
  const msgWords = msgNorm.split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));

  // Scorer chaque tâche par correspondance titre↔message
  function scoreTask(task) {
    const titleWords = norm(task.title).split(/\s+/);
    return msgWords.filter(mw => titleWords.some(tw => wordMatches(tw, mw))).length;
  }

  // Identifier la cible d'assignation (membre après "à/a/pour/côté", avant "de")
  function findAssignTarget() {
    const parts = msgNorm.split(/\s+(?:a|pour|cote|côté)\s+/);
    if(parts.length > 1) {
      const afterPrep = parts[parts.length-1].split(/\s+/).slice(0,3).join(' ');
      return findMemberInText(afterPrep);
    }
    return null;
  }

  // Détecter si le message mentionne un prénom partagé par plusieurs membres
  function hasMemberAmbiguity() {
    const parts = msgNorm.split(/\s+(?:a|pour|cote|côté)\s+/);
    if(parts.length <= 1) return false;
    const afterPrep = parts[parts.length-1].split(/\s+/).slice(0,3).join(' ');
    const words = afterPrep.split(/\s+/);
    for(const w of words) {
      const matches = new Set();
      if(memberIndex[w]) matches.add(memberIndex[w]);
      for(const [term, ini] of Object.entries(memberIndex)) {
        if(term.length > 4 && wordMatches(w, term)) matches.add(ini);
      }
      if(matches.size > 1) return [...matches]; // retourner les candidats
    }
    return false;
  }

  // Filtre contextuel : la modification demandée est-elle déjà vraie pour cette tâche ?
  function alreadyDone(task) {
    // Assignation : cible déjà assignée à la tâche ?
    const target = findAssignTarget();
    if(target) {
      const assignees = (task.assignee||'').toUpperCase().split(/[+,\s]+/).map(a=>a.trim());
      if(assignees.includes(target)) return true;
    }
    // Priorité déjà bonne ?
    const prioMatch = msgNorm.match(/\b(p[123])\b/);
    if(prioMatch && task.prio && task.prio.toUpperCase() === prioMatch[1].toUpperCase()) return true;
    // Statut déjà bon ?
    const statusKw = {
      done:     ['fini','termin','c est fait','livr','valid'],
      blocked:  ['bloqu'],
      inprogress:['en cours','travaille','commence','dessus'],
      waiting:  ['attente','attend']
    };
    for(const [status, kws] of Object.entries(statusKw)) {
      if(task.status === status && kws.some(k => msgNorm.includes(k))) return true;
    }
    return false;
  }

  // Calculer scores et filtrer
  const scored = tasks.map(t => ({...t, _score: scoreTask(t)})).filter(t => t._score > 0);
  const candidates = scored.filter(t => !alreadyDone(t));
  const maxScore = candidates.reduce((mx, t) => Math.max(mx, t._score), 0);
  const topMatches = maxScore > 0 ? candidates.filter(t => t._score === maxScore) : [];

  // Détecter ambiguïté sur le membre cible
  const memberAmbig = hasMemberAmbiguity();

  // Construire le contexte de correspondance pour Claude
  let matchContext;
  if(memberAmbig) {
    const candidateNames = memberAmbig.map(ini => {
      const m = members.find(x => x.initials === ini);
      return ini + (m ? ' ('+m.name+')' : '');
    }).join(', ');
    matchContext = 'AMBIGUÏTÉ MEMBRE — plusieurs membres correspondent : ' + candidateNames
      + '. Tu DOIS mettre clarification=true et demander lequel (donner les noms complets).';
  } else if(topMatches.length === 1) {
    matchContext = 'CORRESPONDANCE UNIQUE — agis directement : id:' + topMatches[0].id
      + ' "' + topMatches[0].title + '". clarification=false.';
  } else if(topMatches.length > 1) {
    matchContext = 'AMBIGUÏTÉ TÂCHES — ' + topMatches.length + ' tâches candidates, clarification=true : '
      + topMatches.map(t => 'id:'+t.id+' "'+t.title+'"').join(' | ');
  } else if(scored.length > 0 && candidates.length === 0) {
    const already = scored.map(t => '"'+t.title+'"').join(', ');
    matchContext = 'DÉJÀ FAIT — (' + already + ') déjà dans l\'état demandé. Informe sans modifier. clarification=true.';
  } else {
    matchContext = 'AUCUNE CORRESPONDANCE — clarification=true, demande de préciser.';
  }

    // CC-107 — Formater le contexte client depuis la fiche JSON (ou texte libre)
  const ctxForPrompt = (() => {
    const brief = getBrief();
    if (!brief) return cur.context || 'Non renseigné.';
    const lines = [
      brief.secteur ? `Secteur : ${brief.secteur}` : null,
      brief.enjeux_principaux?.length ? `Enjeux : ${brief.enjeux_principaux.join(' | ')}` : null,
      brief.kpis?.length ? `KPIs : ${brief.kpis.join(' | ')}` : null,
      brief.equipe?.length ? `Équipe client : ${brief.equipe.join(', ')}` : null,
      brief.historique ? `Historique : ${brief.historique}` : null,
      brief.notes ? `Notes : ${brief.notes}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  })();

  // ── CC-211 — Prompt adaptatif 3 niveaux ──────────────────────────────────
  // Détecter l'intention du message pour choisir les blocs de contexte à injecter.
  const _isAction   = isTaskAction(txt);
  const _isQuestion = isClientQuestion(txt);
  const _isComplex  = isComplexQuery(txt);

  // Règle de sécurité : si aucune intention détectée (message ambigu),
  // injecter L2 par défaut — pas de dégradation silencieuse.
  const _needL2 = _isQuestion || _isComplex || (!_isAction && !_isQuestion && !_isComplex);
  const _needL3 = _isComplex;

  // Assembler le system prompt par niveaux
  const sys = buildL1({ mStr, mFull, mInitials, maxId, matchContext, historyStr })
    + (_needL2 ? buildL2(ctxForPrompt) : '')
    + (_needL3 ? buildL3() : '');

  console.debug(`[CC-211] intent: action=${_isAction} question=${_isQuestion} complex=${_isComplex} → L2=${_needL2} L3=${_needL3} | sys~${Math.round(sys.length/4)}tok`);

  try {
    const messageType = _isAction ? 'task_action' : 'chat';
    const {text: raw, sources: ragSources}=await callClaude(sys,txt,fileToSend,cur?.id||null,messageType);
    th.remove();

    const parts=raw.split('---JSON---');
    const replyText=parts[0].trim();
    const jsonStr=(parts[1]||'').trim();

    const assistantMsgEl = addMsg('a',replyText);
    // CC-203 — Badge sources RAG
    addSourcesBadge(assistantMsgEl, ragSources);
    // CC-213 — Bouton "Sauvegarder dans la KB"
    addKbButton(assistantMsgEl, replyText);

    if(jsonStr){
      try{
        const jm=jsonStr.replace(/```json|```/g,'').trim().match(/\{[\s\S]*\}/);
        if(jm){
          const p=JSON.parse(jm[0]);
          const ops=[], changed=[];
          if(!p.clarification){
            for(const u of (p.updates||[])){
              const t=tasks.find(x=>x.id===u.id);
              if(t){if(u.new_title)t.title=u.new_title;if(u.prio)t.prio=u.prio;if(u.status)t.status=u.status;if(u.blocker!==undefined)t.blocker=u.blocker;if(u.note!==undefined){
              // Si la tâche a déjà une note, on ajoute en bas avec un séparateur
              if(t.note && u.note && u.note !== t.note) {
                const today = new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'});
                t.note = t.note + '\n['+today+'] ' + u.note;
              } else {
                t.note = u.note;
              }
            }if(u.assignee)t.assignee=u.assignee;if(u.due_date!==undefined)t.due_date=u.due_date;changed.push(u.id);ops.push(upsertTask(t));}
            }
            for(const nt of (p.new_tasks||[])){
              if(!nt.title) continue;
              const newT={id:-1,title:nt.title,prio:nt.prio||'P2',status:nt.status||'todo',assignee:nt.assignee||'',blocker:nt.blocker||null,note:nt.note||null,due_date:nt.due_date||null};
              tasks.push(newT);ops.push(upsertTask(newT));changed.push('new');
            }
            for(const did of (p.delete_ids||[])){
              tasks=tasks.filter(t=>t.id!==did);ops.push(delTask(did));changed.push('del');
            }
          }
          if(ops.length){
            setSyncDot('#EF9F27','sauvegarde…');
            await Promise.all(ops);
            setSyncDot('#52b788','synchronisé');
            renderTodo(changed.filter(x=>typeof x==='number'));
            const lastA=assistantMsgEl;
            if(lastA){
              const bg=document.createElement('div');bg.className='msg-badge';
              const nu=changed.filter(x=>typeof x==='number').length;
              const nn=changed.filter(x=>x==='new').length;
              const nd=changed.filter(x=>x==='del').length;
              const pts=[];
              if(nu)pts.push(nu+' mise'+(nu>1?'s':'')+' à jour');
              if(nn)pts.push(nn+' ajoutée'+(nn>1?'s':''));
              if(nd)pts.push(nd+' supprimée'+(nd>1?'s':''));
              bg.textContent=pts.join(' · ');
              lastA.appendChild(bg);
            }
          }
        }
      }catch(e){console.error('JSON parse:',e);}
    }
  }catch(e){
    if($('msgs').querySelector('.thinking')) th.remove();
    addMsg('a','Erreur : '+e.message);
  } finally {
    sendBtn.disabled = false;
    inp.disabled = false;
    inp.focus();
  }
  const shouldSave = !sessionSaved && (sessionExchangeCount === 5 || (sessionExchangeCount > 5 && sessionExchangeCount % 10 === 0));
  if(shouldSave) saveSessionSummary();
}

function getDueSoonCount(){
  const now = new Date();
  return tasks.filter(t => {
    if(!t.due_date || t.status === 'done') return false;
    const due = new Date(t.due_date); due.setHours(23,59,59);
    return (due - now) / (1000*60*60*24) <= 7;
  }).length;
}

function renderFilters(){
  const mems=getMembers();
  const stats=[{k:'all',l:'Tout'},{k:'blocked',l:'Bloqué'},{k:'inprogress',l:'En cours'},{k:'waiting',l:'En attente'},{k:'todo',l:'À faire'},{k:'done',l:'Fait'}];
  $('frow').innerHTML=stats.map(s=>'<button class="fil'+(activeF===s.k?' on':'')+'" onclick="setFil(\''+s.k+'\',this)">'+s.l+'</button>').join('')
    +mems.map(m=>'<button class="fil'+(activeF===m.initials?' on':'')+'" onclick="setFil(\''+m.initials+'\',this)">'+m.initials+'</button>').join('');
}

function setFil(f,btn){activeF=f;document.querySelectorAll('.fil').forEach(b=>b.classList.remove('on'));btn.classList.add('on');renderTodo();}

function injectDeadlineFilter(){
  const bar = document.querySelector('.filters');
  if(!bar || bar.querySelector('[data-f="deadline"]')) return;
  const count = getDueSoonCount();
  if(count === 0) { const old = bar.querySelector('[data-f="deadline"]'); if(old) old.remove(); return; }
  const btn = document.createElement('button');
  btn.className = 'fil' + (activeF==='deadline'?' on':'');
  btn.setAttribute('data-f','deadline');
  btn.textContent = '⏰ Cette semaine ('+count+')';
  btn.onclick = () => setFil('deadline', btn);
  bar.appendChild(btn);
}

function makeDueBadge(t) {
  if(!t.due_date) return '';
  const due = new Date(t.due_date); due.setHours(23,59,59);
  const now = new Date();
  const [y, mo, d] = t.due_date.split('-');
  const label = `${d}/${mo}/${y}`;
  if(t.status === 'done') {
    return due < now ? `<span class="due-badge done-late-badge">✓ ${label}</span>` : '';
  }
  const diff = (due - now) / (1000*60*60*24);
  if(diff < 0) return `<span class="due-badge overdue">⚠ ${label}</span>`;
  if(diff <= 7) return `<span class="due-badge soon">⏳ ${label}</span>`;
  return `<span class="due-badge ok">📅 ${label}</span>`;
}

function renderTodo(hi=[]){
  renderFilters();
  injectDeadlineFilter();
  const secs=[{k:'blocked',l:'Bloqué',c:'#E24B4A'},{k:'inprogress',l:'En cours',c:'#8B5CF6'},{k:'waiting',l:'En attente',c:'#EF9F27'},{k:'todo',l:'À faire',c:'#378ADD'},{k:'done',l:'Fait',c:'#52b788'}];
  const mems=getMembers(); const mI=mems.map(m=>m.initials);
  const searchQ = ($('todo-search')?.value||'').toLowerCase().trim();
  const filt=tasks.filter(t=>{
    if(activeF==='all')return true;
    if(activeF==='deadline'){
      if(!t.due_date || t.status==='done') return false;
      const due=new Date(t.due_date); due.setHours(23,59,59);
      return (due-new Date())/(1000*60*60*24)<=7;
    }
    if(mI.includes(activeF))return (t.assignee||'').split(/[,+\s]+/).map(a=>a.trim()).includes(activeF);
    return t.status===activeF;
  }).filter(t => !searchQ || t.title.toLowerCase().includes(searchQ) || (t.note||'').toLowerCase().includes(searchQ) || (t.assignee||'').toLowerCase().includes(searchQ));
  $('tcnt').textContent=filt.length+' tâche'+(filt.length!==1?'s':'');
  const el=$('tbody'); let html='';
  secs.forEach(s=>{
    const items=filt.filter(t=>t.status===s.k);
    if(!items.length)return;
    html+='<div class="grp"><div class="grp-lbl"><span class="gdot" style="background:'+s.c+'"></span>'+s.l+' <span style="opacity:.6;font-weight:400">('+items.length+')</span></div>';
    items.forEach(t=>{
      const sc={todo:'s-todo',inprogress:'s-inp',blocked:'s-blk',waiting:'s-wait',done:'s-done'}[t.status]||'s-todo';
      const sl={todo:'à faire',inprogress:'en cours',blocked:'bloqué',waiting:'en attente',done:'fait'}[t.status]||t.status;
      const assigneeList=(t.assignee||'').split(/[,+\s]+/).map(a=>a.trim()).filter(Boolean);
      const avatars=assigneeList.length>0?assigneeList.map(a=>{const ms=mStyle(a);return '<div class="av" style="background:'+ms.bg+';color:'+ms.c+'">'+a.substring(0,2)+'</div>';}).join(''):'<div class="av" style="background:var(--sur2);color:var(--tx3)">?</div>';
      const assigneeLabel=assigneeList.join(' + ')||'—';
      const dueBadge = makeDueBadge(t);
      const _now = new Date();
      const _due = t.due_date ? new Date(t.due_date + 'T23:59:59') : null;
      const _isOverdue = _due && t.status !== 'done' && _due < _now;
      const _isDoneLate = _due && t.status === 'done' && _due < _now;
      const _isP1 = (t.prio || 'P2') === 'P1';
      const extraCls = (_isOverdue ? ' overdue' : '') + (_isP1 && t.status !== 'done' ? ' p1-urgent' : '') + (_isDoneLate ? ' done-late' : '');
      html+='<div class="task'+(hi.includes(t.id)?' new':'')+extraCls+' task-clickable" draggable="true" data-id="'+t.id+'" data-status="'+s.k+'" style="cursor:pointer"><div class="t1"><span class="prio '+(t.prio||'P2').toLowerCase()+'">'+(t.prio||'P2')+'</span><span class="ttl">'+esc(t.title)+'</span>'+dueBadge+'</div>';
      if(t.blocker)html+='<div class="textra blk">Blocage : '+esc(t.blocker)+'</div>';
      if(t.note)html+='<div class="textra note" style="white-space:pre-wrap">'+esc(t.note)+'</div>';
      html+='<div class="t2"><div class="tperson">'+avatars+'<span>'+esc(assigneeLabel)+'</span></div><span class="spill '+sc+'">'+sl+'</span></div></div>';
    });
    html+='</div>';
  });
  // Conserver la valeur de recherche et l'état du focus avant le remplacement
  const prevSearch = el.querySelector('#todo-search');
  const savedSearch = prevSearch ? prevSearch.value : '';
  const hadFocus = prevSearch != null && document.activeElement === prevSearch;
  // Injecter : barre de recherche + tâches (ou message vide)
  el.innerHTML =
    '<input class="todo-search" id="todo-search" type="text" placeholder="Rechercher une tâche…" autocomplete="off" oninput="renderTodo()">'
    + (html || '<div style="padding:16px 20px 8px;color:var(--tx3);font-size:13px;text-align:center">Aucune tâche</div>');
  // Remettre la valeur et le focus sur le nouvel input
  const newSearch = el.querySelector('#todo-search');
  if(newSearch && savedSearch) newSearch.value = savedSearch;
  if(hadFocus) newSearch.focus();
}

async function openSettings(){
  if(!cur)return;
  $('stitle').textContent='Paramètres — '+cur.name;
  // CC-107 — Si context est une fiche JSON, ctx-ta reste vide (la fiche est gérée séparément)
  // Sinon, afficher uniquement le contexte manuel (sans le bloc Drive auto-généré)
  const manualCtxOnly = getBrief()
    ? ''  // fiche JSON → rien dans le textarea
    : (cur.context||'').replace(/\n*---\s*Contenu Drive[\s\S]*$/,'').trim();
  $('ctx-ta').value=manualCtxOnly;
  // CC-104 — Synchroniser le champ Drive caché avec la source Drive si elle existe
  const srcs = getSources();
  const driveSrc = srcs.find(s=>s.type==='drive');
  $('drive-in').value = driveSrc ? (driveSrc.folder_id||'') : (cur.drive_folder_id||'');
  // CC-102 — Toujours ouvrir sur l'onglet Paramètres
  switchSettingsTab('params');
  renderMList();
  // CC-104 — Migration automatique : si drive_folder_id et pas encore de source Drive
  await migrateDriveLegacy();
  renderSources();
  // CC-107 — Afficher la fiche client si elle existe
  renderBrief();
  openModal('modal-settings');
}

function renderMList(){
  const ms=getMembers();
  $('mwrap').innerHTML=ms.map((m,i)=>'<div class="mtag"><span>'+m.initials+(m.name&&m.name!==m.initials?' — '+m.name:'')+'</span><span class="mrem" onclick="remMember('+i+')">×</span></div>').join('');
}

function addMember(){
  const ini=$('m-init').value.trim().toUpperCase(), name=$('m-name').value.trim();
  if(!ini)return;
  const ms=getMembers();
  if(!ms.find(m=>m.initials===ini)){ms.push({initials:ini,name:name||ini});cur.members=JSON.stringify(ms);renderMList();$('m-init').value='';$('m-name').value='';}
}

function remMember(i){const ms=getMembers();ms.splice(i,1);cur.members=JSON.stringify(ms);renderMList();}

// ── CC-104 : Sources de contexte ──────────────────────────────────────────

function getSources(){
  try{ return JSON.parse(cur?.sources||'[]'); }catch{ return []; }
}

function setSources(arr){
  cur.sources = JSON.stringify(arr);
}

// Migration automatique : drive_folder_id legacy → sources
async function migrateDriveLegacy(){
  if(!cur.drive_folder_id) return;
  const srcs = getSources();
  if(srcs.find(s=>s.type==='drive')) return; // déjà migré
  srcs.push({
    type: 'drive',
    name: 'Google Drive — ' + cur.name,
    folder_id: cur.drive_folder_id,
    status: 'ok',
    last_synced_at: cur.context ? new Date().toISOString() : null,
    content_length: cur.context ? cur.context.length : 0  // CC-107 : fonctionne que context soit JSON ou texte
  });
  setSources(srcs);
  // Persister en Supabase pour ne plus repasser par la migration au prochain openSettings
  try { await sb.from('clients').update({sources:cur.sources}).eq('id',cur.id); } catch(e){ console.warn('migrateDriveLegacy persist:', e.message); }
}

function estimateTokens(){
  const srcs = getSources();
  const manualCtx = ($('ctx-ta')||{value:''}).value||'';
  // CC-107 — si une fiche JSON est active, compter sa taille réelle
  const briefLen = getBrief() ? (cur?.context||'').length : 0;
  let total = Math.round((manualCtx.length + briefLen) / 4);
  srcs.forEach(s => { total += Math.round((s.content_length||0) / 4); });
  if(total > 999) return '~' + (total/1000).toFixed(1) + 'k tokens';
  return '~' + total + ' tokens';
}

function renderSources(){
  const srcs = getSources();
  const el = $('sources-list');
  if(!srcs.length){
    el.innerHTML = '<div class="src-empty">Aucune source connectée.</div>';
    $('token-count').textContent = estimateTokens();
    return;
  }
  const icons = {
    drive: '<i data-lucide="folder-open" style="width:16px;height:16px;vertical-align:-3px;color:var(--sb-blue-md)"></i>',
    file:  '<i data-lucide="file-text" style="width:16px;height:16px;vertical-align:-3px;color:var(--sb-orange)"></i>',
    notion:'<i data-lucide="layout-grid" style="width:16px;height:16px;vertical-align:-3px;color:var(--tx3)"></i>',
  };
  el.innerHTML = srcs.map((s,i) => {
    const icon = icons[s.type]||'📎';
    const statusCls = s.status==='ok' ? 'ok' : s.status==='syncing' ? 'syncing' : 'err';
    const statusLbl = s.status==='ok' ? '✓ Connecté' : s.status==='syncing' ? '⟳ Sync…' : '✗ Erreur';
    const syncDate = s.last_synced_at
      ? new Date(s.last_synced_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})
      : 'jamais';
    return `<div class="src-item" id="src-item-${i}">
      <div class="src-icon">${icon}</div>
      <div class="src-info">
        <div class="src-name">${s.name||s.type}</div>
        <div class="src-meta">Dernière sync : ${syncDate}</div>
      </div>
      <span class="src-status ${statusCls}">${statusLbl}</span>
      <div class="src-actions">
        <button class="src-sync-btn" id="src-sync-${i}" onclick="syncSource(${i})" ${s.type==='notion'?'disabled':''}>Sync</button>
        <button class="src-del-btn" onclick="removeSource(${i})" title="Supprimer cette source">×</button>
      </div>
    </div>`;
  }).join('');
  $('token-count').textContent = estimateTokens();
  lucide.createIcons();
}

// ── CC-107 : Fiche client générée ─────────────────────────────────────────

// Lire la fiche depuis cur.context (JSON structuré) ou retourner null
function getBrief() {
  if (!cur?.context) return null;
  try {
    const parsed = JSON.parse(cur.context);
    const expectedKeys = ['secteur','enjeux_principaux','kpis','equipe','historique','notes'];
    if (expectedKeys.every(k => k in parsed)) return parsed;
  } catch (_) {}
  return null;
}

// Afficher la fiche dans le modal (lecture seule)
function renderBrief() {
  const el = $('brief-content');
  const regenBtn = $('brief-regen-btn');
  const brief = getBrief();

  // Bouton "Régénérer" : actif seulement si une source Drive est connectée
  const srcs = getSources();
  const hasDrive = srcs.some(s => s.type === 'drive' && s.folder_id);
  regenBtn.disabled = !hasDrive;
  regenBtn.title = hasDrive ? 'Régénérer la fiche depuis les sources Drive' : 'Connecte d\'abord une source Drive';

  if (!brief) {
    const noSrc = !hasDrive;
    el.innerHTML = `<div class="brief-empty">${noSrc
      ? 'Connecte d\'abord une source Drive pour générer la fiche.'
      : 'Aucune fiche générée — clique sur Sync ou Régénérer la fiche.'
    }</div>`;
    return;
  }

  const arrayField = (arr, cls='') => {
    if (!Array.isArray(arr) || !arr.length) return '<span style="color:var(--tx3);font-style:italic">—</span>';
    return `<div class="brief-field-value tags">${arr.map(v => `<span class="brief-tag ${cls}">${esc(String(v))}</span>`).join('')}</div>`;
  };
  const textField = (val) => `<div class="brief-field-value">${esc(String(val||'—'))}</div>`;

  el.innerHTML = `
    <div class="brief-fields">
      <div class="brief-field">
        <div class="brief-field-label">Secteur</div>
        ${textField(brief.secteur)}
      </div>
      <div class="brief-field">
        <div class="brief-field-label">Enjeux principaux</div>
        ${arrayField(brief.enjeux_principaux)}
      </div>
      <div class="brief-field">
        <div class="brief-field-label">KPIs</div>
        ${arrayField(brief.kpis, 'green')}
      </div>
      <div class="brief-field">
        <div class="brief-field-label">Équipe client</div>
        ${arrayField(brief.equipe)}
      </div>
      <div class="brief-field">
        <div class="brief-field-label">Historique</div>
        ${textField(brief.historique)}
      </div>
      <div class="brief-field">
        <div class="brief-field-label">Notes</div>
        ${textField(brief.notes)}
      </div>
    </div>`;
}

// Appeler generate_brief avec le contenu de toutes les sources Drive actives
async function generateBrief(docsContent) {
  if (!cur || !docsContent || !docsContent.length) return;

  const r = await fetch(EDGE_URL, {
    method: 'POST',
    headers: EDGE_HEADERS,
    body: JSON.stringify({ action: 'generate_brief', client_id: cur.id, docs_content: docsContent })
  });
  const data = await r.json();

  if (data.error) {
    // Afficher l'erreur dans le modal
    const el = $('brief-content');
    el.innerHTML += `<div class="brief-err">⚠ ${esc(data.error)}</div>`;
    throw new Error(data.error);
  }

  // Mettre à jour cur + localStorage avec la fiche
  cur.context = JSON.stringify(data.brief);
  addSession(cur);
  // Si Supabase n'a pas pu sauvegarder côté serveur, on le fait côté client
  if (!data.saved) {
    try { await sb.from('clients').update({ context: cur.context }).eq('id', cur.id); } catch(e){ console.warn('generateBrief client-side update:', e.message); }
  }

  return data.brief;
}

// Bouton "Régénérer la fiche" dans les Paramètres
async function regenerateBrief() {
  const srcs = getSources();
  const driveSrcs = srcs.filter(s => s.type === 'drive' && s.folder_id);
  if (!driveSrcs.length) {
    alert('Connecte d\'abord une source Drive.');
    return;
  }

  const btn = $('brief-regen-btn');
  btn.disabled = true;
  btn.textContent = '…génération';
  $('brief-content').innerHTML = '<div class="brief-empty">Génération en cours…</div>';

  try {
    // Récupérer les docs depuis le contexte existant (déjà synchro)
    // On extrait le bloc Drive du contexte si présent, sinon on force une re-sync
    const docsContent = extractDocsFromContext();
    if (!docsContent.length) {
      // Pas de contenu en cache → lancer la sync Drive puis générer
      await syncSource(srcs.indexOf(driveSrcs[0]));
      // syncSource appelle generateBrief en interne, donc c'est bon
    } else {
      await generateBrief(docsContent);
      renderBrief();
    }
  } catch (e) {
    console.error('regenerateBrief:', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Régénérer la fiche';
  }
}

// Extraire les docs depuis le contexte actuel (fallback pour Régénérer sans re-sync)
function extractDocsFromContext() {
  const ctx = cur?.context || '';
  // Si c'est une fiche JSON, il n'y a plus de blocs texte à extraire
  try { JSON.parse(ctx); return []; } catch(_) {}
  // Sinon, chercher les blocs Drive existants et les repackager
  const driveMatch = ctx.match(/---\s*Contenu Drive[\s\S]*$/);
  if (!driveMatch) return [];
  return [{ filename: 'Contexte Drive', content: driveMatch[0].substring(0, 32000) }];
}

async function syncSource(idx){
  const srcs = getSources();
  const s = srcs[idx];
  if(!s) return;

  // UI : passer en état syncing
  const syncBtn = $('src-sync-'+idx);
  if(syncBtn){ syncBtn.disabled = true; syncBtn.textContent = '…'; }
  s.status = 'syncing';
  srcs[idx] = s;
  setSources(srcs);
  renderSources();

  try {
    if(s.type === 'drive'){
      const folderId = s.folder_id || $('drive-in').value.trim();
      if(!folderId) throw new Error('Folder ID manquant');
      // ── Étape 1 : métadonnées de tous les fichiers (rapide, sans contenu) ──
      const metaR = await fetch(EDGE_URL,{method:'POST',headers:EDGE_HEADERS,body:JSON.stringify({action:'list_drive_metadata',folder_id:folderId})});
      const metaD = await metaR.json();
      if(metaD.error) throw new Error(metaD.error);
      if(!metaD.files||!metaD.files.length) throw new Error('Aucun fichier lisible');

      const exportableFiles = metaD.files.filter(f => EXPORTABLE_MIMETYPES.includes(f.mimeType));

      // ── Étape 2 : exporter + indexer tous les fichiers en parallèle (concurrence = 3) ──
      // CONCURRENCE 3 = on traite 3 fichiers simultanément.
      // - Plus rapide qu'un loop séquentiel (98 fichiers × 2 HTTP calls → ~3-4 min → ~1 min)
      // - Plus sage qu'un Promise.all massif (évite timeout + rate limit Voyage AI)
      // - Le backoff 429 dans l'edge function gère les pics sans artificiel delay côté front
      addMsg('a', '⏳ Indexation des documents en cours...');
      const docsForBrief = [];
      const BRIEF_LIMIT = 15;
      let indexedCount = 0;

      // Pool de concurrence : traite max CONCURRENCY fichiers simultanément
      const CONCURRENCY = 3;
      async function processFile(fileMeta) {
        try {
          const expR = await fetch(EDGE_URL,{method:'POST',headers:EDGE_HEADERS,body:JSON.stringify({action:'export_single_file',file_id:fileMeta.id,file_name:fileMeta.name,mime_type:fileMeta.mimeType})});
          const expD = await expR.json();
          if(expD.error || !expD.file?.content || expD.file.content.trim().length < 10) return;

          // Collecter pour le brief (thread-safe car JS est single-threaded)
          if(docsForBrief.length < BRIEF_LIMIT) {
            docsForBrief.push({ filename: expD.file.filename, content: expD.file.content.substring(0, 6000) });
          }

          const sourceType = fileMeta.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'sheet' : 'doc';
          const idxR = await fetch(EDGE_URL,{method:'POST',headers:EDGE_HEADERS,body:JSON.stringify({
            action:'index_source', client_id:cur.id,
            source_type:sourceType, source_id:fileMeta.id,
            source_name:fileMeta.name, content:expD.file.content,
          })});
          const idxD = await idxR.json();
          if(!idxD.error) indexedCount++;
        } catch(e) { console.warn('syncSource: processFile error for', fileMeta.name, e.message); }
      }

      // Exécuter en vagues de CONCURRENCY fichiers
      for(let i = 0; i < exportableFiles.length; i += CONCURRENCY) {
        await Promise.all(exportableFiles.slice(i, i + CONCURRENCY).map(f => processFile(f)));
      }

      addMsg('a', `✓ ${indexedCount} document(s) indexé(s) sur ${exportableFiles.length} pour la recherche profonde.`);

      s.status = 'ok';
      s.last_synced_at = new Date().toISOString();
      s.folder_id = folderId;
      s.content_length = indexedCount;

      // Sauvegarder l'état Drive immédiatement
      srcs[idx] = s;
      setSources(srcs);
      await sb.from('clients').update({drive_folder_id:folderId, sources:cur.sources, members:cur.members}).eq('id',cur.id);
      cur.drive_folder_id = folderId; addSession(cur);
      addMsg('a', '✓ Drive synchronisé — génération de la fiche dans 15s…');

      // ── Génération différée de la fiche client ──
      // 15s suffisent maintenant que l'indexation est parallèle et non-bloquante.
      setTimeout(async () => {
        if (!docsForBrief.length) return;
        try {
          addMsg('a', '⏳ Génération de la fiche client en cours…');
          const brief = await generateBrief(docsForBrief);
          if (brief) {
            addMsg('a', '✓ Fiche client générée avec succès.');
            if ($('modal-settings').classList.contains('open')) renderBrief();
          }
        } catch(briefErr) {
          console.error('generate_brief delayed failed:', briefErr.message);
          addMsg('a', '⚠ Génération de la fiche échouée : '+briefErr.message+'. Réessaie via "Régénérer la fiche".');
        }
      }, 15_000);

      // CC-107 — Rafraîchir la fiche dans le modal si ouvert
      if ($('modal-settings').classList.contains('open')) renderBrief();

    } else if(s.type === 'file'){
      // Fichier PDF déjà analysé à l'ajout, la re-sync n'a pas de sens sans nouveau fichier
      // On indique juste que le contenu est déjà chargé
      s.status = 'ok';
      s.last_synced_at = new Date().toISOString();
      srcs[idx] = s;
      setSources(srcs);
      await sb.from('clients').update({sources:cur.sources}).eq('id',cur.id);
      addSession(cur);
    } else {
      throw new Error('Type de source non supporté : '+s.type);
    }
  } catch(e){
    s.status = 'err';
    srcs[idx] = s;
    setSources(srcs);
    try { await sb.from('clients').update({sources:cur.sources}).eq('id',cur.id); } catch(_){}
    addSession(cur);
    console.error('syncSource error:', e.message);
  }

  renderSources();
}

async function removeSource(idx){
  const srcs = getSources();
  const s = srcs[idx];
  if(!s) return; // guard: idx stale (ex. double-clic)
  if(!window.confirm('Supprimer la source "'+s.name+'" ?')) return;
  srcs.splice(idx,1);
  setSources(srcs);

  // ── Purger les embeddings de cette source dans document_chunks ──────────
  // IMPORTANT : les chunks sont indexés par NOM DE FICHIER individuel (file.filename),
  // pas par le nom de la source Drive (s.name = "Google Drive — Décathlon").
  // Pour une source Drive : on supprime tous les chunks du client dont source_type = 'doc' ou 'sheet'.
  // Pour un fichier PDF : source_name = file.name → correspond exactement.
  try {
    if (s.type === 'drive') {
      // Supprimer TOUS les chunks doc/sheet de ce client (ils viennent tous du Drive)
      await fetch(EDGE_URL, {
        method: 'POST',
        headers: EDGE_HEADERS,
        body: JSON.stringify({
          action: 'delete_source_chunks',
          client_id: cur.id,
          source_type_filter: ['doc', 'sheet'], // supprime par type, pas par nom
        })
      });
    } else {
      // Pour un fichier PDF : source_name = file.name → match direct
      await fetch(EDGE_URL, {
        method: 'POST',
        headers: EDGE_HEADERS,
        body: JSON.stringify({
          action: 'delete_source_chunks',
          client_id: cur.id,
          source_name: s.name,
        })
      });
    }
  } catch(e) {
    console.warn('removeSource: purge document_chunks error (non bloquant):', e.message);
  }

  if(s.type==='drive'){
    // CC-107 — Supprimer la source Drive invalide la fiche (générée depuis Drive)
    // On remet context à vide (ou on conserve uniquement le contexte manuel du textarea)
    $('drive-in').value='';
    let manualCtx;
    if (getBrief()) {
      // La fiche venait du Drive → la vider, récupérer ce qu'il y avait dans ctx-ta
      manualCtx = $('ctx-ta').value.trim();
    } else {
      manualCtx = (cur.context||'').replace(/\n*---\s*Contenu Drive[\s\S]*$/,'').trim();
    }
    $('ctx-ta').value = manualCtx;
    await sb.from('clients').update({sources:cur.sources, drive_folder_id:'', context:manualCtx}).eq('id',cur.id);
    cur.drive_folder_id=''; cur.context=manualCtx;
    // Rafraîchir la fiche (sera vide maintenant)
    renderBrief();

  } else if(s.type==='file'){
    // Retirer le bloc fichier du contexte
    const escapedName = s.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const filePattern = new RegExp('\\n*---\\s*Fichier\\s*:\\s*' + escapedName + '[\\s\\S]*?(?=\\n---\\s*(?:Fichier|Contenu Drive)|$)');
    const newCtx = (cur.context||'').replace(filePattern,'').trim();
    // Dans le textarea n afficher que le contexte manuel (sans blocs auto)
    const manualOnly = newCtx.replace(/\n*---\s*Contenu Drive[\s\S]*$/,'').trim();
    $('ctx-ta').value = manualOnly;
    await sb.from('clients').update({sources:cur.sources, context:newCtx}).eq('id',cur.id);
    cur.context = newCtx;

  } else {
    await sb.from('clients').update({sources:cur.sources}).eq('id',cur.id);
  }

  addSession(cur);
  renderSources();
}

// ── Sous-modal Ajout source ──

function showAddSourceForm(type){
  // Masquer tous les formulaires
  ['drive','file','notion'].forEach(t => {
    const f = $('add-src-form-'+t);
    if(f) f.classList.remove('open');
  });
  const form = $('add-src-form-'+type);
  if(form) form.classList.add('open');
}

async function confirmAddSource(type){
  if(type === 'drive'){
    const folderId = $('add-src-drive-id').value.trim();
    const name = $('add-src-drive-name').value.trim() || ('Google Drive — '+cur.name);
    if(!folderId){ alert('Entre un Folder ID Drive.'); return; }
    const srcs = getSources();
    // Vérifier doublons
    if(srcs.find(s=>s.type==='drive'&&s.folder_id===folderId)){
      alert('Ce dossier Drive est déjà connecté.'); return;
    }
    const newSrc = {type:'drive', name, folder_id:folderId, status:'ok', last_synced_at:null, content_length:0};
    srcs.push(newSrc);
    // Capturer l'index AVANT tout await ou setSources pour éviter les décalages
    const newIdx = srcs.length - 1;
    setSources(srcs);
    // Mettre à jour le champ Drive caché pour saveSettings()
    $('drive-in').value = folderId;
    // Persist sources
    await sb.from('clients').update({sources:cur.sources, drive_folder_id:folderId}).eq('id',cur.id);
    addSession(cur);
    closeModal('modal-add-source');
    $('add-src-drive-id').value=''; $('add-src-drive-name').value='';
    showAddSourceForm('');
    renderSources();
    // Lancer la sync immédiatement avec l'index capturé
    syncSource(newIdx);

  } else if(type === 'file'){
    const fileInput = $('add-src-file-input');
    const file = fileInput.files[0];
    if(!file){ alert('Sélectionne un fichier PDF.'); return; }
    if(file.size > 20*1024*1024){ alert('Fichier trop volumineux (max 20 Mo).'); return; }

    const btn = document.querySelector('#add-src-form-file .btn:not(.btn-sec)');
    if(btn){ btn.disabled=true; btn.textContent='Analyse en cours…'; }

    const reader = new FileReader();
    reader.onload = async e => {
      const b64 = e.target.result.split(',')[1];
      try {
        const result = await callClaude(
          "Extrais les infos clés de ce document en français, de façon factuelle et concise (max 300 mots). Retourne uniquement le résumé, sans titre.",
          'Analyse ce PDF.',
          {data:b64, mediaType:'application/pdf', name:file.name}
        );
        const block = '--- Fichier : '+file.name+' ('+new Date().toLocaleDateString('fr')+') ---\n'+result.text;
        // Construire newCtx depuis cur.context (source de vérité), pas depuis ctx-ta
        // pour éviter les doublons si on ajoute plusieurs PDFs dans la même session
        const manualCtxOnly = ($('ctx-ta').value||'').trim(); // contexte manuel tapé par l'user
        const existingAutoBlocks = (cur.context||'').replace(/^[\s\S]*?(?=\n*---|$)/,''); // blocs auto existants
        const newCtx = [manualCtxOnly, existingAutoBlocks, block].filter(Boolean).join('\n\n');
        // NE PAS écrire dans ctx-ta : c'est un bloc auto, pas du contexte manuel

        const srcs = getSources();
        srcs.push({type:'file', name:file.name, status:'ok', last_synced_at:new Date().toISOString(), content_length:block.length});
        setSources(srcs);

        await sb.from('clients').update({context:newCtx, sources:cur.sources}).eq('id',cur.id);
        cur.context = newCtx; addSession(cur);

        // ── Indexer le PDF dans document_chunks pour le RAG ──────────────
        try {
          await fetch(EDGE_URL, {
            method: 'POST',
            headers: EDGE_HEADERS,
            body: JSON.stringify({
              action: 'index_source',
              client_id: cur.id,
              source_type: 'file',
              source_name: file.name,
              content: result.text, // résumé extracté — suffisant pour la recherche sémantique
            })
          });
        } catch(idxErr) {
          console.warn('confirmAddSource file: index_source error (non bloquant):', idxErr.message);
        }
        // ─────────────────────────────────────────────────────────────────

        closeModal('modal-add-source');
        fileInput.value='';
        if(btn){ btn.disabled=false; btn.textContent='Uploader et analyser'; }
        renderSources();
        addMsg('a','✓ Fichier "'+file.name+'" analysé et ajouté au contexte.');
      } catch(err){
        if(btn){ btn.disabled=false; btn.textContent='Uploader et analyser'; }
        alert('Erreur lors de l\'analyse : '+err.message);
      }
    };
    reader.readAsDataURL(file);
  }
}
let modalTaskId = null;

function parseNotes(noteStr) {
  if(!noteStr) return [];
  // Format : date — texte (une entrée par ligne)
  return noteStr.split('\n').filter(Boolean).map(line => {
    const match = line.match(/^(\d{2}\/\d{2}(?:\s+\d{2}:\d{2})?)\s+—\s+(.+)$/);
    if(match) return {date: match[1], text: match[2]};
    return {date: '', text: line};
  });
}

function formatNoteTimestamp() {
  const now = new Date();
  return now.toLocaleDateString('fr',{day:'2-digit',month:'2-digit'})
    + ' ' + now.toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'});
}

function openTaskModal(taskId) {
  const t = tasks.find(x => x.id === taskId);
  if(!t) return;
  modalTaskId = taskId;

  // Remplir les champs
  $('task-modal-title').value = t.title || '';
  $('task-modal-status').value = t.status || 'todo';
  $('task-modal-prio').value = t.prio || 'P2';
  $('task-modal-note-input').value = '';
  $('task-modal-due').value = t.due_date || '';

  // Blocker
  const blockerWrap = $('task-modal-blocker-wrap');
  if(t.status === 'blocked') {
    blockerWrap.classList.remove('hide');
    $('task-modal-blocker').value = t.blocker || '';
  } else {
    blockerWrap.classList.add('hide');
  }

  // Statut change → afficher/masquer blocker
  $('task-modal-status').onchange = function() {
    if(this.value === 'blocked') blockerWrap.classList.remove('hide');
    else blockerWrap.classList.add('hide');
  };

  // Assignee dropdown avec membres
  const members = getMembers();
  const sel = $('task-modal-assignee');
  sel.innerHTML = '<option value="">—</option>';
  members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.initials;
    opt.textContent = m.initials + ' — ' + (m.name || m.initials);
    if(t.assignee && t.assignee.split(/[+,\s]+/).includes(m.initials)) opt.selected = true;
    sel.appendChild(opt);
  });

  // Notes
  renderNotesInModal(t.note);

  openModal('modal-task');
  $('task-modal-title').focus();
}

function renderNotesInModal(noteStr) {
  const notes = parseNotes(noteStr);
  const el = $('task-modal-notes');
  if(!notes.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--tx3);font-style:italic">Aucune note pour l\'instant.</div>';
    return;
  }
  el.innerHTML = notes.map((n, i) =>
    '<div class="note-entry">'
    + '<button class="note-del" onclick="deleteNoteFromModal('+i+')" title="Supprimer cette note">×</button>'
    + (n.date ? '<div class="note-entry-date">'+esc(n.date)+'</div>' : '')
    + '<div class="note-entry-text">'+esc(n.text)+'</div>'
    + '</div>'
  ).join('');
  el.scrollTop = el.scrollHeight;
}

async function deleteNoteFromModal(index) {
  if(!modalTaskId) return;
  const t = tasks.find(x => x.id === modalTaskId);
  if(!t) return;
  const lines = (t.note||'').split('\n').filter(Boolean);
  lines.splice(index, 1);
  t.note = lines.join('\n') || null;
  renderNotesInModal(t.note);
  await upsertTask(t);
  renderTodo([t.id]);
}

async function addNoteFromModal() {
  const input = $('task-modal-note-input');
  const text = input.value.trim();
  if(!text || !modalTaskId) return;
  const t = tasks.find(x => x.id === modalTaskId);
  if(!t) return;
  const ts = formatNoteTimestamp();
  const newNote = ts + ' — ' + text;
  t.note = t.note ? t.note + '\n' + newNote : newNote;
  input.value = '';
  renderNotesInModal(t.note);
  await upsertTask(t);
  renderTodo([t.id]);
}

async function saveTaskFromModal() {
  if(!modalTaskId) return;
  const t = tasks.find(x => x.id === modalTaskId);
  if(!t) return;
  t.title = $('task-modal-title').value.trim() || t.title;
  t.status = $('task-modal-status').value;
  t.prio = $('task-modal-prio').value;
  t.assignee = $('task-modal-assignee').value;
  t.blocker = t.status === 'blocked' ? ($('task-modal-blocker').value.trim() || null) : null;
  t.due_date = $('task-modal-due').value || null;
  setSyncDot('#EF9F27','sauvegarde…');
  await upsertTask(t);
  setSyncDot('#52b788','synchronisé');
  renderTodo([t.id]);
  closeModal('modal-task');
}

async function deleteTaskFromModal() {
  if(!modalTaskId) return;
  const t = tasks.find(x => x.id === modalTaskId);
  if(!t) return;
  if(!window.confirm('Supprimer la tâche "'+t.title+'" ?')) return;
  tasks = tasks.filter(x => x.id !== modalTaskId);
  await delTask(modalTaskId);
  renderTodo();
  closeModal('modal-task');
}

async function deleteClient(){
  if(!cur) return;
  const confirmed = window.confirm(
    'Supprimer définitivement "' + cur.name + '" et toutes ses tâches ?\n\nCette action est irréversible.'
  );
  if(!confirmed) return;
  // Supprimer les tâches d'abord (cascade FK), puis le client
  await sb.from('tasks').delete().eq('client_id', cur.id);
  await sb.from('clients').delete().eq('id', cur.id);
  // Retirer de la session
  session = session.filter(c => c.id !== cur.id);
  localStorage.setItem('cc-sess', JSON.stringify(session));
  cur = null;
  closeModal('modal-settings');
  hide('workspace'); show('empty');
  if(rtChan) { sb.removeChannel(rtChan); rtChan = null; }
  renderSidebar();
  // Recharger la liste des clients dans le dropdown login
  await loadClientList();
}

async function saveSettings(){
  // CC-107 — Si une fiche JSON est active, saveSettings ne touche pas à context
  // (la fiche est gérée exclusivement par generate_brief / syncSource)
  const hasBrief = !!getBrief();

  // Contexte manuel = uniquement ce que l'utilisateur a tapé (sans blocs auto)
  let manualCtx = $('ctx-ta').value.trim();
  // Nettoyer l'éventuel ancien bloc Drive du textarea (ne doit jamais y être, sécurité)
  manualCtx = manualCtx.replace(/\n*---\s*Contenu Drive[\s\S]*$/,'').trim();
  // CC-104 — Synchroniser drive-in depuis la source Drive si elle existe
  const srcs = getSources();
  const driveSrc = srcs.find(s=>s.type==='drive');
  const du = driveSrc ? (driveSrc.folder_id||'') : $('drive-in').value.trim();
  if(du) $('drive-in').value = du;

  if (hasBrief) {
    // Fiche active : sauvegarder uniquement membres + sources + drive_folder_id
    // Ne pas toucher à context (contiendrait sinon le textarea vide ou du JSON brut)
    await sb.from('clients').update({drive_folder_id:du, members:cur.members, sources:cur.sources}).eq('id',cur.id);
    cur.drive_folder_id=du; addSession(cur);
    closeModal('modal-settings'); renderFilters();
    return;
  }

  // Pas de fiche : comportement original — reconstruire context depuis les blocs texte
  // Conserver le bloc Drive existant si pas de re-sync maintenant
  let driveBlock = '';
  const existingDriveBlock = (cur.context||'').match(/\n*---\s*Contenu Drive[\s\S]*$/);
  if(existingDriveBlock) driveBlock = existingDriveBlock[0].trim();

  // CC-106 fix — Conserver les blocs fichier existants (sinon saveSettings les écrase)
  const fileBlocks = [];
  const fileBlockPattern = /---\s*Fichier\s*:[\s\S]*?(?=\n---|$)/g;
  let fm;
  while((fm = fileBlockPattern.exec(cur.context||'')) !== null){
    fileBlocks.push(fm[0].trim());
  }

  // Reconstruire le contexte : manuel + blocs fichier + Drive
  const ctx = [manualCtx, ...fileBlocks, driveBlock].filter(Boolean).join('\n\n');
  await sb.from('clients').update({context:ctx, drive_folder_id:du, members:cur.members, sources:cur.sources}).eq('id',cur.id);
  cur.context=ctx; cur.drive_folder_id=du; addSession(cur);
  closeModal('modal-settings'); renderFilters();
}

async function openModal(id){
  $(id).classList.add('open');
  // Fermer en cliquant sur le backdrop
  $(id).onclick = (e) => { if(e.target === $(id)) closeModal(id); };
  // CC-104 — Réinitialiser le sous-modal add-source
  if(id === 'modal-add-source') {
    ['drive','file','notion'].forEach(t => {
      const f = $('add-src-form-'+t);
      if(f) f.classList.remove('open');
    });
    const di = $('add-src-drive-id'); if(di) di.value='';
    const dn = $('add-src-drive-name'); if(dn) dn.value='';
    const fi = $('add-src-file-input'); if(fi) fi.value='';
  }
  // Charger la liste des clients si c'est la modal join-existing
  if(id === 'modal-new') {
    // Réinitialiser la liste membres
    const list = $('n-members-list');
    if(list) { list.innerHTML = ''; addMemberRow('n-members-list'); }
  }
  if(id === 'modal-join-existing') {
    const sel = $('join-ex-select');
    sel.innerHTML = '<option value="">Chargement…</option>';
    const {data} = await sb.from('clients').select('id,name').order('name');
    sel.innerHTML = '<option value="">— Sélectionne un client —</option>';
    (data||[]).forEach(c => {
      // Ne pas afficher les clients déjà dans la session
      if(!session.find(s => s.id === c.id)) {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        sel.appendChild(opt);
      }
    });
  }
}

async function joinExisting(){
  const clientId = $('join-ex-select').value;
  const pass = $('join-ex-pass').value;
  hide('join-ex-err');
  if(!clientId){showErr('join-ex-err','Sélectionne un client.');return;}
  if(!pass){showErr('join-ex-err','Entre le mot de passe.');return;}
  const hash = await hashPass(pass);
  const {data} = await sb.from('clients').select('*').eq('id',clientId).eq('password_hash',hash).single();
  if(!data){showErr('join-ex-err','Mot de passe incorrect.');return;}
  closeModal('modal-join-existing');
  $('join-ex-pass').value = '';
  addSession(data);
  renderSidebar();
  selectClient(data);
}

async function createClientModal(){
  const name=$('n-name').value.trim(),pass=$('n-pass').value;
  hide('new-err');
  if(!name||!pass){showErr('new-err','Nom et mot de passe requis.');return;}
  const hash=await hashPass(pass);
  const membersData=getMembersFromList('n-members-list');
  const {data,error}=await sb.from('clients').insert({name,password_hash:hash,members:JSON.stringify(membersData)}).select().single();
  if(error){showErr('new-err',error.message);return;}
  closeModal('modal-new');addSession(data);renderSidebar();selectClient(data);
}

// ── Calendrier des échéances ──────────────────────────────────────────────
let _calYear, _calMonth;

function openCalendar() {
  const now = new Date();
  _calYear = now.getFullYear();
  _calMonth = now.getMonth();
  renderCalendar();
  openModal('modal-cal');
}

function calNav(dir) {
  _calMonth += dir;
  if(_calMonth < 0)  { _calMonth = 11; _calYear--; }
  if(_calMonth > 11) { _calMonth = 0;  _calYear++; }
  renderCalendar();
}

function renderCalendar() {
  const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const JOURS  = ['L','M','M','J','V','S','D'];

  // date ISO → tâches non terminées
  const taskMap = {};
  tasks.forEach(t => {
    if(t.due_date && t.status !== 'done')
      (taskMap[t.due_date] = taskMap[t.due_date] || []).push(t);
  });

  const today   = new Date().toISOString().slice(0,10);
  const lastDay = new Date(_calYear, _calMonth + 1, 0).getDate();
  let startDow  = new Date(_calYear, _calMonth, 1).getDay();
  startDow = startDow === 0 ? 6 : startDow - 1; // lundi en premier

  let html = `<div class="cal-nav">
    <button onclick="calNav(-1)" title="Mois précédent">‹</button>
    <span>${MONTHS[_calMonth]} ${_calYear}</span>
    <button onclick="calNav(1)" title="Mois suivant">›</button>
  </div><div class="cal-grid">`;

  JOURS.forEach(j => { html += `<div class="cal-dow">${j}</div>`; });
  for(let i = 0; i < startDow; i++) html += '<div class="cal-empty"></div>';

  for(let d = 1; d <= lastDay; d++) {
    const ds = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday   = ds === today;
    const isPast    = ds < today;
    const dayTasks  = taskMap[ds] || [];
    const hasTasks  = dayTasks.length > 0;

    const dots = dayTasks.map(t => {
      const c = t.prio==='P1' ? 'var(--red)' : t.prio==='P3' ? 'var(--sb-blue-md)' : 'var(--amb)';
      return `<span class="cal-dot" style="background:${c}"></span>`;
    }).join('');

    const cls = ['cal-cell',
      isToday  ? 'cal-today'    : '',
      isPast && hasTasks ? 'cal-overdue' : '',
      hasTasks ? 'cal-has-tasks': ''
    ].filter(Boolean).join(' ');

    html += `<div class="${cls}"${hasTasks ? ` onclick="calDayClick('${ds}')"` : ''}>${d}${dots ? `<div class="cal-dots">${dots}</div>` : ''}</div>`;
  }

  html += '</div><div id="cal-day-tasks"></div>';
  $('cal-body').innerHTML = html;
}

function calDayClick(dateStr) {
  const dayTasks = tasks.filter(t => t.due_date === dateStr && t.status !== 'done');
  if(!dayTasks.length) return;
  const label = new Date(dateStr+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  $('cal-day-tasks').innerHTML =
    `<div class="cal-day-label">${label}</div>` +
    dayTasks.map(t =>
      `<div class="cal-task-item" onclick="closeModal('modal-cal');openTaskModal(${t.id})">
        <span class="prio ${(t.prio||'P2').toLowerCase()}">${t.prio||'P2'}</span>
        <span>${esc(t.title)}</span>
      </div>`
    ).join('');
}