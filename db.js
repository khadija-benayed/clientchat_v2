// ════════════════════════════════════════════════════════
// db.js — Configuration, état global, Supabase, Drive,
//          sessions, prompts IA
// ════════════════════════════════════════════════════════
const SB_URL = 'https://erpjerfvswesipmdqxab.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVycGplcmZ2c3dlc2lwbWRxeGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NTQwNDEsImV4cCI6MjA5MjQzMDA0MX0.ftgCx_YzClgkNCPF5PprnPJd-y6mdl_vETtvl6pzG2U';
const EDGE_URL = SB_URL + '/functions/v1/chat';
const EDGE_HEADERS = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SB_KEY};
const EXPORTABLE_MIMETYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/pdf',
];
let sb = null;
let cur = null, tasks = [], activeF = 'all', rtChan = null;

let session = JSON.parse(localStorage.getItem('cc-sess') || '[]');

async function callEdge(payload){
  const r = await fetch(EDGE_URL,{method:'POST',headers:EDGE_HEADERS,body:JSON.stringify(payload)});
  if(!r.ok) throw new Error('Edge HTTP '+r.status);
  return r.json();
}
let selectedFile = null; // {data: base64, mediaType, name}

function onFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  const allowed = ['application/pdf','image/jpeg','image/png'];
  if (!allowed.includes(file.type)) { alert('Format non supporté. PDF, JPG ou PNG uniquement.'); input.value=''; return; }
  if (file.size > 20 * 1024 * 1024) { alert('Fichier trop volumineux (max 20 Mo).'); input.value=''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    const b64 = e.target.result.split(',')[1];
    selectedFile = { data: b64, mediaType: file.type, name: file.name };
    renderFileBadge();
    $('attach-btn').disabled = true;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function renderFileBadge() {
  const wrap = $('file-badge-wrap');
  if (!selectedFile) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="file-badge"><i data-lucide="paperclip" style="width:12px;height:12px;vertical-align:-1px"></i><span class="file-badge-name">${esc(selectedFile.name)}</span><button class="file-badge-rem" onclick="clearFile()" title="Retirer le fichier">×</button></div>`;
  lucide.createIcons();
}

function clearFile() {
  selectedFile = null;
  $('attach-btn').disabled = false;
  renderFileBadge();
}
let inactivityTimer = null;
let sessionExchangeCount = 0;   // nb d'échanges user↔assistant dans la session courante
let sessionSaved = false;        // éviter de sauvegarder deux fois la même session
const MC = [{bg:'#EAF4EE',c:'#2D6A4F'},{bg:'#EAF0FA',c:'#1A4F8A'},{bg:'#FDF0DC',c:'#7A4B0F'},{bg:'#EDE9FE',c:'#5B21B6'},{bg:'#FAEAEA',c:'#8B2020'}];

function $(id){ return document.getElementById(id); }
function show(id){ $(id).classList.remove('hide'); }
function hide(id){ $(id).classList.add('hide'); }
function closeModal(id){ $(id).classList.remove('open'); }
function setSyncDot(color, txt){ $('sdot').style.background=color; $('slbl').textContent=txt; }
function setSyncProgress(done, total){
  const el=$('sync-progress'); if(!el) return;
  if(done===null){ el.classList.remove('on'); el.textContent=''; return; }
  el.classList.add('on'); el.textContent=done+'/'+total+' indexés';
}
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function mStyle(ini){ const i=((ini||'?').charCodeAt(0)+((ini||'?').charCodeAt(1)||0))%MC.length; return MC[i]; }
function getMembers(){ try{ return JSON.parse(cur?.members||'[]'); }catch{ return []; } }

async function hashPass(p){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p+'cc2026'));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

// ── Gestion liste membres dynamique ──
function addMemberRow(containerId, ini='', name='') {
  const container = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'member-row';
  // CC-XSS — createElement + .value pour éviter l'injection via attribut value=""
  const inpIni = document.createElement('input');
  inpIni.type='text'; inpIni.placeholder='KB'; inpIni.maxLength=5;
  inpIni.style.textTransform='uppercase'; inpIni.value=ini;
  inpIni.addEventListener('input', function(){ this.value=this.value.toUpperCase(); });
  const inpName = document.createElement('input');
  inpName.type='text'; inpName.placeholder='Prénom Nom (ex: Khadija Ben Ayed)'; inpName.value=name;
  const btn = document.createElement('button');
  btn.className='btn-rem-member'; btn.type='button'; btn.title='Supprimer'; btn.textContent='×';
  btn.addEventListener('click', function(){ this.parentElement.remove(); });
  row.appendChild(inpIni); row.appendChild(inpName); row.appendChild(btn);
  container.appendChild(row);
  // Focus sur le premier champ vide
  const firstInput = row.querySelector('input');
  if(!ini) firstInput.focus();
}

function getMembersFromList(containerId) {
  const rows = document.querySelectorAll('#'+containerId+' .member-row');
  const members = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const ini = inputs[0].value.trim().toUpperCase();
    const name = inputs[1].value.trim();
    if(ini) members.push({initials: ini, name: name || ini});
  });
  return members;
}

function setTab(t, btn){
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  if(t === 'join') { show('pane-join'); hide('pane-create'); }
  else { hide('pane-join'); show('pane-create'); }
}

async function loadClientList(){
  const {data} = await sb.from('clients').select('id,name').order('name');
  const sel = $('join-select');
  sel.innerHTML = '<option value="">— Sélectionne un client —</option>';
  (data||[]).forEach(c=>{
    const opt = document.createElement('option');
    opt.value=c.id; opt.textContent=c.name; sel.appendChild(opt);
  });
}

async function joinClient(){
  const clientId=$('join-select').value, pass=$('join-pass').value;
  hide('join-err');
  if(!clientId){showErr('join-err','Sélectionne un client.');return;}
  if(!pass){showErr('join-err','Entre le mot de passe.');return;}
  setBtn('join-btn','Vérification…',true);
  const hash = await hashPass(pass);
  const {data} = await sb.from('clients').select('*').eq('id',clientId).eq('password_hash',hash).single();
  setBtn('join-btn',"Accéder à l'espace",false);
  if(!data){showErr('join-err','Mot de passe incorrect.');return;}
  addSession(data); enterApp(data);
}

async function createClient(){
  const name=$('c-name').value.trim(), pass=$('c-pass').value;
  hide('create-err');
  if(!name||!pass){showErr('create-err','Nom et mot de passe requis.');return;}
  setBtn('create-btn','Création…',true);
  const hash = await hashPass(pass);
  const membersData = getMembersFromList('c-members-list');
  const {data,error} = await sb.from('clients').insert({name,password_hash:hash,members:JSON.stringify(membersData)}).select().single();
  setBtn('create-btn',"Créer l'espace",false);
  if(error){showErr('create-err',error.message);return;}
  addSession(data); enterApp(data);
}

function showErr(id,msg){$(id).textContent=msg;show(id);}
function setBtn(id,txt,dis){const b=$(id);b.textContent=txt;b.disabled=dis;}

function addSession(c){
  session=session.filter(x=>x.id!==c.id);
  session.unshift(c);
  localStorage.setItem('cc-sess',JSON.stringify(session));
}

function leaveClient(e, clientId) {
  e.stopPropagation(); // Ne pas sélectionner le client
  session = session.filter(c => c.id !== clientId);
  localStorage.setItem('cc-sess', JSON.stringify(session));
  // Si c'était le client actif, afficher l'écran vide ou le premier client restant
  if(cur?.id === clientId) {
    cur = null;
    hide('workspace'); show('empty');
    if(rtChan) { sb.removeChannel(rtChan); rtChan = null; }
    if(session.length > 0) selectClient(session[0]);
  }
  renderSidebar();
}

function logout(){
  if(cur && !sessionSaved && sessionExchangeCount >= 3) saveSessionSummary();
  session = [];
  localStorage.removeItem('cc-sess');
  location.reload();
}

function enterApp(client){
  hide('login'); show('app');
  renderSidebar();
  if(client) selectClient(client);
}

function renderSidebar(){
  const el=$('cli-list'); el.innerHTML='';
  if(!session.length){el.innerHTML='<div style="padding:8px 16px;font-size:12px;color:var(--tx3)">Aucun client</div>';return;}
  session.forEach(c=>{
    const d=document.createElement('div');
    d.className='cli-item'+(cur?.id===c.id?' on':'');
    const av=document.createElement('div'); av.className='cli-av'; av.textContent=c.name.substring(0,2).toUpperCase();
    const nm=document.createElement('span'); nm.className='cli-name'; nm.textContent=c.name;
    const lv=document.createElement('span'); lv.className='cli-leave'; lv.textContent='×'; lv.title='Quitter ce client';
    lv.addEventListener('click', e=>{ leaveClient(e, c.id); });
    d.appendChild(av); d.appendChild(nm); d.appendChild(lv);
    d.onclick=()=>selectClient(c);
    el.appendChild(d);
  });
}

// CC-209 — Notification discrète de mise à jour (disparaît après 4s)
function showUpdateNotif(count) {
  let notif = document.getElementById('update-notif');
  if (!notif) {
    notif = document.createElement('div');
    notif.id = 'update-notif';
    notif.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--sur);border:1px solid var(--brd2);border-radius:var(--rs);padding:10px 16px;font-size:13px;color:var(--tx);z-index:9999;box-shadow:0 2px 12px rgba(0,0,0,.1);transition:opacity .4s;';
    document.body.appendChild(notif);
  }
  notif.textContent = '🔄 ' + count + ' document' + (count > 1 ? 's' : '') + ' mis à jour';
  notif.style.opacity = '1';
  clearTimeout(notif._timer);
  notif._timer = setTimeout(() => { notif.style.opacity = '0'; }, 4000);
}

// CC-209 — Vérifier et re-indexer les docs Drive modifiés depuis la dernière indexation
// CC-210 — checkDriveUpdates : vérification légère en 2 étapes
// Étape 1 : list_drive_metadata (metadata only, ~100ms, 0 export Drive)
// Étape 2 : comparer modifiedTime vs files_indexed stocké dans sources
// Étape 3 : re-télécharger + index_source UNIQUEMENT les fichiers modifiés (max 5)
async function checkDriveUpdates(clientObj) {
  if (!clientObj?.drive_folder_id) return;
  try {
    // ── Étape 1 : métadonnées uniquement (id, name, mimeType, modifiedTime) ──
    const metaRes = await fetch(EDGE_URL, {
      method: 'POST',
      headers: EDGE_HEADERS,
      body: JSON.stringify({ action: 'list_drive_metadata', folder_id: clientObj.drive_folder_id })
    });
    const metaData = await metaRes.json();
    if (!metaData.files || metaData.files.length === 0) return;

    // ── Étape 2 : récupérer les source_id déjà indexés en base pour ce client ──
    // On fait UNE seule requête pour avoir tous les (source_id, last_indexed_at) connus.
    // Clé stable = source_id (Google Drive file ID), résistant aux renommages.
    const { data: indexedRows } = await sb
      .from('document_chunks')
      .select('source_id, source_name, last_indexed_at')
      .eq('client_id', clientObj.id)
      .not('source_id', 'is', null)
      .order('last_indexed_at', { ascending: false });

    // Map { source_id → { last_indexed_at, source_name } } — on garde la ligne la plus récente
    const indexedMap = {};
    for (const row of (indexedRows || [])) {
      if (!indexedMap[row.source_id]) {
        indexedMap[row.source_id] = { last_indexed_at: row.last_indexed_at, source_name: row.source_name };
      }
    }

    // ── Étape 3 : classifier chaque fichier Drive ──
    // • jamais indexé → à indexer
    // • modifié depuis last_indexed_at → à ré-indexer
    // • à jour → skip
    const toIndex = [];
    const driveIds = new Set();

    for (const f of metaData.files) {
      if (!EXPORTABLE_MIMETYPES.includes(f.mimeType)) continue;
      driveIds.add(f.id);
      const known = indexedMap[f.id];
      if (!known) {
        toIndex.push({ ...f, reason: 'new' });
      } else if (new Date(f.modifiedTime) > new Date(known.last_indexed_at)) {
        toIndex.push({ ...f, reason: 'modified' });
      }
      // Si renommé mais pas modifié : source_name en base sera mis à jour au prochain index
    }

    // ── Étape 4 : purger les zombies (source_id en base mais plus dans Drive) ──
    const zombieIds = Object.keys(indexedMap).filter(id => !driveIds.has(id));
    if (zombieIds.length > 0) {
      await sb.from('document_chunks')
        .delete()
        .eq('client_id', clientObj.id)
        .in('source_id', zombieIds)
        .then(() => {}).catch(e => console.warn('checkDriveUpdates: purge zombies error:', e.message));
      console.log(`checkDriveUpdates: ${zombieIds.length} zombie(s) purgé(s).`);
    }

    if (toIndex.length === 0) {
      console.log(`checkDriveUpdates: ${metaData.files.length} fichiers vérifiés — tout est à jour.`);
      return;
    }

    console.log(`checkDriveUpdates: ${toIndex.length} fichier(s) à indexer (${toIndex.filter(f=>f.reason==='new').length} nouveaux, ${toIndex.filter(f=>f.reason==='modified').length} modifiés).`);
    setSyncProgress(0, toIndex.length);

    // ── Étape 5 : exporter + indexer fichier par fichier (anti-timeout) ──
    // On n'utilise plus read_drive_folder (exporte tout en parallèle → timeout sur 98 fichiers).
    // À la place : export_single_file par ID → 1 appel Edge Function par fichier, séquentiel.
    // Limite à 8 par run pour rester bien sous les 150s de timeout Supabase.
    // Convergence garantie : le reste est traité au prochain selectClient().
    // gte-small natif — pas de rate limit, 10 fichiers max par run pour rester sous le timeout Edge Function
    const MAX_PER_RUN = 10;
    const batch = toIndex.slice(0, MAX_PER_RUN);
    const updatedNames = [];

    for (let fi = 0; fi < batch.length; fi++) {
      const fileMeta = batch[fi];
      try {
        // 1. Exporter le contenu du fichier via son ID Drive
        const exportRes = await fetch(EDGE_URL, {
          method: 'POST',
          headers: EDGE_HEADERS,
          body: JSON.stringify({
            action: 'export_single_file',
            file_id: fileMeta.id,
            file_name: fileMeta.name,
            mime_type: fileMeta.mimeType,
          })
        });
        if (!exportRes.ok) {
          console.warn(`checkDriveUpdates: export HTTP ${exportRes.status} pour "${fileMeta.name}"`);
          continue;
        }
        const exportData = await exportRes.json();

        if (exportData.error) {
          console.warn(`checkDriveUpdates: export échoué pour "${fileMeta.name}":`, exportData.error);
          continue;
        }

        const fileContent = exportData.file;
        if (!fileContent?.content || fileContent.content.trim().length < 10) {
          console.warn(`checkDriveUpdates: "${fileMeta.name}" contenu vide — ignoré.`);
          continue;
        }

        // 2. Indexer
        const sourceType = fileMeta.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'sheet' : 'doc';
        const indexRes = await fetch(EDGE_URL, {
          method: 'POST',
          headers: EDGE_HEADERS,
          body: JSON.stringify({
            action: 'index_source',
            client_id: clientObj.id,
            source_type: sourceType,
            source_id: fileMeta.id,
            source_name: fileMeta.name,
            content: fileContent.content,
          })
        });
        if (!indexRes.ok) {
          console.warn(`checkDriveUpdates: index HTTP ${indexRes.status} pour "${fileMeta.name}"`);
          continue;
        }
        const indexData = await indexRes.json();
        if (indexData.error) {
          console.warn(`checkDriveUpdates: index_source error pour "${fileMeta.name}":`, indexData.error);
          continue;
        }

        updatedNames.push(fileMeta.name);
        setSyncProgress(updatedNames.length, toIndex.length);
        console.log(`checkDriveUpdates: "${fileMeta.name}" indexé [${fileMeta.reason}] — ${indexData.chunks_created} chunks.`);
      } catch (fileErr) {
        console.warn(`checkDriveUpdates: erreur pour "${fileMeta.name}" (non bloquant):`, fileErr.message);
      }
    }

    if (updatedNames.length > 0) {
      showUpdateNotif(updatedNames.length);
      if (toIndex.length > MAX_PER_RUN) {
        const remaining = toIndex.length - MAX_PER_RUN;
        setSyncProgress(updatedNames.length, toIndex.length); // badge reste visible : "2/98 indexés"
        console.log(`checkDriveUpdates: ${remaining} fichier(s) restant(s) — traités au prochain chargement.`);
      } else {
        setSyncProgress(null, null);
      }
    } else {
      setSyncProgress(null, null);
    }
  } catch (e) {
    console.warn('checkDriveUpdates error (non bloquant):', e.message);
  }
}

// CC-212 — Doc cache : lit les chunks déjà indexés dans document_chunks (Supabase)
// Zéro appel Drive supplémentaire — pas de conflit avec checkDriveUpdates.
// Regroupe les chunks par source_name, reconstitue le texte, garde les 10 sources les plus récentes.
async function loadDocCache(clientObj){
  // CC-212b — L2 cache indépendant du RAG.
  // localStorage d'abord (instantané), Drive en arrière-plan si stale.
  // Fonctionne même avec Voyage free tier à 0 fichier indexé.
  try {
    const raw = clientObj.sources;
    const srcs = Array.isArray(raw) ? raw : JSON.parse(raw||'[]');
    const folderId = srcs.find(s=>s.type==='drive'&&s.folder_id)?.folder_id || clientObj.drive_folder_id;
    if(!folderId){ clientObj._docCache = []; return; }

    const CACHE_KEY = 'cc-doccache-'+clientObj.id;
    const CACHE_TTL = 30 * 60 * 1000; // 30 min
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)||'null'); } catch(_){}
    const age = cached ? Date.now()-(cached.ts||0) : Infinity;

    if(cached && age < CACHE_TTL && cached.docs?.length){
      clientObj._docCache = cached.docs;
      console.log('[CC-212b] Cache localStorage : '+cached.docs.length+' fichiers ('+Math.round(age/60000)+'min)');
      if(age > 15*60*1000) refreshDocCache(clientObj, folderId, CACHE_KEY); // refresh silencieux
      return;
    }
    await refreshDocCache(clientObj, folderId, CACHE_KEY);
  } catch(e){
    console.warn('[CC-212b] loadDocCache error:', e.message);
    clientObj._docCache = [];
  }
}

async function refreshDocCache(clientObj, folderId, cacheKey){
  // Lit depuis document_chunks déjà indexés — zéro appel Drive.
  // checkDriveUpdates() tourne juste avant et garantit que les chunks sont frais.
  try {
    const {data} = await sb
      .from('document_chunks')
      .select('source_name, source_id, chunk_text')
      .eq('client_id', clientObj.id)
      .in('source_type', ['doc','sheet','pdf'])
      .order('last_indexed_at', {ascending:false})
      .order('source_name');

    if(!data?.length){ clientObj._docCache=[]; return; }

    // Grouper par source_name — insertion order = source la plus récente en premier
    const bySource = {};
    for(const row of data){
      if(!bySource[row.source_name]) bySource[row.source_name]={source_id:row.source_id,text:''};
      if(bySource[row.source_name].text.length < 8000)
        bySource[row.source_name].text += (bySource[row.source_name].text?'\n':'')+row.chunk_text;
    }
    const docs = Object.entries(bySource).slice(0,10).map(([name,v])=>({
      driveId: v.source_id, filename: name, content: v.text.slice(0,8000)
    }));
    clientObj._docCache = docs;
    try{ localStorage.setItem(cacheKey,JSON.stringify({ts:Date.now(),docs})); }catch(_){}
    console.log('[CC-212b] Cache refreshed from document_chunks: '+docs.length+' sources');
  }catch(e){
    console.warn('[CC-212b] refreshDocCache error:',e.message);
    clientObj._docCache=clientObj._docCache||[];
  }
}

async function selectClient(c){
  if(cur && cur.id !== c.id && !sessionSaved && sessionExchangeCount >= 3) {
    await saveSessionSummary();
  }
  const {data} = await sb.from('clients').select('*').eq('id',c.id).single();
  cur=data||c;
  addSession(cur); renderSidebar();
  hide('empty'); show('workspace');
  $('tb-av').textContent=cur.name.substring(0,2).toUpperCase();
  $('tb-name').textContent=cur.name;
  $('msgs').innerHTML='';
  tasks=[]; activeF='all'; renderFilters();
  sessionExchangeCount=0; sessionSaved=false;
  resetInactivityTimer();
  setSyncDot('#EF9F27','chargement…');
  const [prevSummaries] = await Promise.all([
    loadPreviousSummaries(cur.id),
    loadTasks()
  ]);
  subscribeRT();
  initTaskDnd();
  const mems=getMembers();
  const mStr=mems.map(m=>m.name||m.initials).join(' & ');
  cur._summaries = prevSummaries;
  addMsg('a','Bonjour ! Je suis au courant du projet '+cur.name+(mStr?' — équipe : '+mStr:'')+'. Pose tes questions ou dis-moi ce que tu avances.');
  // checkDriveUpdates must complete before loadDocCache to ensure fresh chunks
  (async () => {
    await checkDriveUpdates(cur);
    await loadDocCache(cur);
  })().catch(e => console.warn('[CC-212] update+cache pipeline error:', e.message));
}

async function loadTasks(){
  const {data}=await sb.from('tasks').select('*').eq('client_id',cur.id).order('id');
  tasks=data||[];
  applyTaskOrder();
  renderTodo();
  setSyncDot('#52b788','synchronisé');
}

async function upsertTask(t){
  if(t.id&&t.id>0){
    await sb.from('tasks').update({title:t.title,prio:t.prio,status:t.status,assignee:t.assignee,blocker:t.blocker,note:t.note,due_date:t.due_date||null,updated_at:new Date().toISOString()}).eq('id',t.id);
  } else {
    const {data}=await sb.from('tasks').insert({client_id:cur.id,title:t.title,prio:t.prio||'P2',status:t.status||'todo',assignee:t.assignee||'',blocker:t.blocker||null,note:t.note||null,due_date:t.due_date||null}).select().single();
    if(data) t.id=data.id;
  }
}

async function delTask(id){ await sb.from('tasks').delete().eq('id',id); }

function subscribeRT(){
  if(rtChan) sb.removeChannel(rtChan);
  rtChan=sb.channel('t-'+cur.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks',filter:'client_id=eq.'+cur.id},()=>loadTasks())
    .subscribe();
}