// ════════════════════════════════════════════════════════
// app.js — Initialisation, dark mode, sidebar collapse,
//           raccourcis clavier, drag & drop, boot
// Dépend de : db.js, ui.js
// ════════════════════════════════════════════════════════
// ── Collapse sidebar ──────────────────────────────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('collapse-btn');
  const collapsed = sb.classList.toggle('collapsed');
  localStorage.setItem('cc-sb-collapsed', collapsed ? '1' : '0');
  btn.innerHTML = collapsed
    ? '<i data-lucide="panel-left-open" style="width:16px;height:16px"></i>'
    : '<i data-lucide="panel-left-close" style="width:16px;height:16px"></i>';
  lucide.createIcons();
}

// ── Dark mode ─────────────────────────────────────────────────────────────
function toggleDark() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  setDark(!isDark);
}

function setDark(on) {
  document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
  localStorage.setItem('cc-dark', on ? '1' : '0');
  const btn = document.getElementById('btn-dark');
  if (btn) {
    btn.innerHTML = on
      ? '<i data-lucide="sun" style="width:15px;height:15px"></i>'
      : '<i data-lucide="moon" style="width:15px;height:15px"></i>';
    lucide.createIcons();
  }
}

// ── Raccourcis clavier globaux ────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  const meta = e.metaKey || e.ctrlKey;
  // Ignorer si on tape dans un input/textarea (sauf les raccourcis méta)
  const inField = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);

  if (meta && e.key === 'b') { e.preventDefault(); toggleSidebar(); return; }
  if (meta && e.key === 'd') { e.preventDefault(); toggleDark(); return; }
  if (meta && e.key === 'k') { e.preventDefault(); const inp = document.getElementById('inp'); if(inp) inp.focus(); return; }
  if (meta && e.key === 'j') { e.preventDefault(); const fi = document.getElementById('file-input'); if(fi) fi.click(); return; }
  if (meta && e.key === ',') { e.preventDefault(); openSettings(); return; }
  if (meta && e.key === ']') { e.preventDefault(); navigateClient(1); return; }
  if (meta && e.key === '[') { e.preventDefault(); navigateClient(-1); return; }
  if ((meta || e.ctrlKey) && e.key === 'f') {
    const panel = document.getElementById('todo-search');
    if (panel) { e.preventDefault(); panel.focus(); panel.select(); }
    return;
  }
  if (!inField && e.key === '?') { openModal('modal-shortcuts'); return; }
});

function navigateClient(dir) {
  if (!session.length) return;
  const idx = cur ? session.findIndex(c => c.id === cur.id) : -1;
  const next = session[(idx + dir + session.length) % session.length];
  if (next) selectClient(next);
}

window.addEventListener('load', async () => {
  const savedDark = localStorage.getItem('cc-dark');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setDark(savedDark !== null ? savedDark === '1' : prefersDark);

  if (localStorage.getItem('cc-sb-collapsed') === '1') {
    const sb_el = document.getElementById('sidebar');
    const btn = document.getElementById('collapse-btn');
    if (sb_el) sb_el.classList.add('collapsed');
    if (btn) btn.innerHTML = '<i data-lucide="panel-left-open" style="width:16px;height:16px"></i>';
  }

  sb = supabase.createClient(SB_URL, SB_KEY);

  // ── Auth state listener ──────────────────────────────────────────────────
  sb.auth.onAuthStateChange(async (event, authSession) => {
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && authSession) {
      _jwtToken = authSession.access_token;
      _currentUserId = authSession.user?.id || null;
      hide('login');
      await loadMyClients();
      enterApp(session[0] || null);
    } else if (event === 'TOKEN_REFRESHED' && authSession) {
      _jwtToken = authSession.access_token;
    } else if (event === 'SIGNED_OUT') {
      _jwtToken = null;
      _currentUserId = null;
      session = [];
      localStorage.removeItem('cc-sess');
      hide('app'); show('login');
    }
  });

  // ── Check existing session ───────────────────────────────────────────────
  const { data: { session: authSession } } = await sb.auth.getSession();
  if (!authSession) {
    // No active session — show login screen
    show('login');
  }
  // If there's a session, onAuthStateChange fires INITIAL_SESSION and handles boot.

  lucide.createIcons();
});

// ── Drag & drop réordonnancement tâches ──────────────────────────────────
let _dragId = null;

function initTaskDnd() {
  const body = $('tbody');
  if (!body) return;
  // Supprimer les anciens listeners pour éviter les doublons au changement de client
  const fresh = body.cloneNode(true);
  body.parentNode.replaceChild(fresh, body);
  // Réattacher le onclick sur les cartes (perdu par cloneNode)
  fresh.addEventListener('click', e => {
    const card = e.target.closest('.task-clickable');
    if (card && card.dataset.id) openTaskModal(parseInt(card.dataset.id));
  });

  fresh.addEventListener('dragstart', e => {
    const card = e.target.closest('.task[draggable]');
    if (!card) return;
    _dragId = parseInt(card.dataset.id);
    setTimeout(() => card.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
  });

  fresh.addEventListener('dragend', e => {
    fresh.querySelectorAll('.dragging,.drag-over').forEach(el => el.classList.remove('dragging','drag-over'));
  });

  fresh.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.task[draggable]');
    fresh.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (card && parseInt(card.dataset.id) !== _dragId) card.classList.add('drag-over');
  });

  fresh.addEventListener('dragleave', e => {
    const card = e.target.closest('.task[draggable]');
    if (card) card.classList.remove('drag-over');
  });

  fresh.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.task[draggable]');
    if (!target || !_dragId) return;
    const targetId = parseInt(target.dataset.id);
    if (targetId === _dragId) return;
    const fromIdx = tasks.findIndex(t => t.id === _dragId);
    const toIdx   = tasks.findIndex(t => t.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = tasks.splice(fromIdx, 1);
    tasks.splice(toIdx, 0, moved);
    try {
      localStorage.setItem('cc-task-order-' + cur.id, JSON.stringify(tasks.map(t => t.id)));
    } catch(_) {}
    renderTodo();
    _dragId = null;
  });
}

function applyTaskOrder() {
  if (!cur) return;
  try {
    const saved = JSON.parse(localStorage.getItem('cc-task-order-' + cur.id) || 'null');
    if (!saved || !saved.length) return;
    const map = Object.fromEntries(tasks.map(t => [t.id, t]));
    const ordered = saved.map(id => map[id]).filter(Boolean);
    const orderedIds = new Set(ordered.map(x => x.id));
    tasks.forEach(t => { if (!orderedIds.has(t.id)) ordered.push(t); });
    tasks = ordered;
  } catch(_) {}
}

