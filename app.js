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
      requestAnimationFrame(initLoginScene);
    }
  });

  // ── Check existing session ───────────────────────────────────────────────
  const { data: { session: authSession } } = await sb.auth.getSession();
  if (!authSession) {
    show('login');
    requestAnimationFrame(initLoginScene);
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

// ── Login scene ───────────────────────────────────────────────────────────────
function initLoginScene() {
  const loginEl = document.getElementById('login');
  if (!loginEl || loginEl.classList.contains('hide')) return;

  const canvas = document.getElementById('ln-canvas');
  const bee    = document.getElementById('ln-bee');
  const beeSvg = document.getElementById('ln-bee-svg');
  const wings  = bee ? bee.querySelectorAll('[data-wing]') : [];
  if (!canvas || !bee) return;

  // Size
  let W = window.innerWidth, H = window.innerHeight;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Hex grid — precompute centers
  const R = 34, hh = Math.sqrt(3) * R, hw = R * 2;
  const hexes = [];
  for (let row = -1; row < H / hh + 2; row++) {
    for (let col = -1; col < W / (hw * .75) + 2; col++) {
      const ox = col % 2 === 0 ? 0 : hh / 2;
      hexes.push({ cx: col * hw * .75 + R, cy: row * hh + ox + hh / 2 });
    }
  }

  function hexPath(cx, cy) {
    ctx.beginPath();
    for (let a = 0; a < 6; a++) {
      const ang = Math.PI / 3 * a - Math.PI / 6;
      ctx.lineTo(cx + R * Math.cos(ang), cy + R * Math.sin(ang));
    }
    ctx.closePath();
  }

  // Flower mark — chaque pétale dans un <g translate(cx,cy)> pour que
  // scale(0) parte du centre du pétale et non de l'origine SVG (0,0)
  const flSvg = document.getElementById('ln-flower-svg');
  if (flSvg) {
    const fr = 9, fd = fr * 1.73;
    // Points d'un hexagone centré en (0,0)
    const localPts = Array.from({length:6}, (_, k) => {
      const ka = Math.PI/3*k + Math.PI/6;
      return `${(fr*Math.cos(ka)).toFixed(1)},${(fr*Math.sin(ka)).toFixed(1)}`;
    }).join(' ');
    let fh = '';
    for (let i = 0; i < 6; i++) {
      const a = Math.PI/3*i + Math.PI/6;
      const fcx = (Math.cos(a)*fd).toFixed(1), fcy = (Math.sin(a)*fd).toFixed(1);
      const delay = (i * .065).toFixed(3);
      // Le <g> translate le système de coordonnées au centre du pétale :
      // scale(0) sur le <g> scale depuis ce centre, pas depuis (0,0) du SVG
      fh += `<g transform="translate(${fcx},${fcy})" style="animation:lnHexIn .4s ${delay}s cubic-bezier(.34,1.56,.64,1) both">
        <polygon points="${localPts}" fill="rgba(194,226,245,.18)" stroke="rgba(194,226,245,.4)" stroke-width=".8"/>
      </g>`;
    }
    fh += `<g style="animation:lnHexIn .4s .39s cubic-bezier(.34,1.56,.64,1) both">
      <polygon points="${localPts}" fill="#F89B1C" opacity=".95"/>
    </g>`;
    flSvg.innerHTML = fh;
    if (!document.getElementById('ln-kf')) {
      const s = document.createElement('style'); s.id = 'ln-kf';
      s.textContent = `@keyframes lnHexIn{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}`;
      document.head.appendChild(s);
    }
  }

  // Mouse parallax
  let mouseX = W / 2, mouseY = H / 2;
  const onMouseMove = e => { mouseX = e.clientX; mouseY = e.clientY; };
  window.addEventListener('mousemove', onMouseMove);

  // Pollen particles (drawn on canvas)
  const pollen = [];
  function spawnPollen(x, y, speed) {
    if (Math.random() > 0.18 * speed) return;
    pollen.push({
      x, y,
      vx: (Math.random() - .5) * 1.4,
      vy: -.4 - Math.random() * .7,
      life: 1, r: 1.2 + Math.random() * 1.4
    });
    if (pollen.length > 50) pollen.splice(0, pollen.length - 50);
  }

  // Bee state — organic wandering
  let bx = W * .5, by = H * .28;
  let vx = 0, vy = 0;
  let targetX = bx, targetY = by;
  let targetAge = 0;
  let excited = false;
  let wingPhase = 0;

  const BM = 70; // border margin px
  function pickTarget() {
    targetX = BM + Math.random() * (W - BM * 2);
    targetY = H * .06 + Math.random() * H * .30; // haut 6%–36% de l'écran
    targetAge = 1400 + Math.random() * 2200;
  }
  pickTarget();

  window._lnBeeExcite = v => { excited = v; };

  let lastT = performance.now();

  function draw(now) {
    if (loginEl.classList.contains('hide')) {
      window.removeEventListener('mousemove', onMouseMove);
      return; // stop loop when hidden
    }
    requestAnimationFrame(draw);

    const dt = Math.min(now - lastT, 50);
    lastT = now;
    targetAge -= dt;
    if (targetAge <= 0) pickTarget();

    // Spring toward target
    const tdx = targetX - bx, tdy = targetY - by;
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
    const baseForce = excited ? 0.009 : 0.004;
    const force = Math.min(tdist * baseForce, excited ? 1.4 : 0.9);
    vx += (tdx / tdist) * force;
    vy += (tdy / tdist) * force;
    // Natural wobble
    const t = now * .001;
    vx += Math.sin(t * 1.3) * .06;
    vy += Math.cos(t * 1.7) * .06;
    // Damping
    const damp = excited ? .91 : .93;
    vx *= damp; vy *= damp;
    // Speed cap
    const spd = Math.sqrt(vx * vx + vy * vy);
    const maxSpd = excited ? 8 : 5;
    if (spd > maxSpd) { vx = vx / spd * maxSpd; vy = vy / spd * maxSpd; }
    // Bounds — réfléchir la vélocité pour éviter de coller aux murs
    const maxY = H * .42;
    const nx = bx + vx, ny = by + vy;
    if (nx < BM)       { vx =  Math.abs(vx) * .45; pickTarget(); }
    else if (nx > W - BM) { vx = -Math.abs(vx) * .45; pickTarget(); }
    if (ny < 40)       { vy =  Math.abs(vy) * .45; pickTarget(); }
    else if (ny > maxY)   { vy = -Math.abs(vy) * .45; pickTarget(); }
    bx = Math.max(BM, Math.min(W - BM, nx));
    by = Math.max(40, Math.min(maxY, ny));

    // Position bee element
    bee.style.transform = `translate(${(bx - 22).toFixed(1)}px,${(by - 22).toFixed(1)}px)`;

    // Flip & tilt based on velocity
    const tiltDeg = Math.max(-18, Math.min(18, vy * 2.5));
    beeSvg.style.transform = `scaleX(${vx < -.15 ? -1 : 1}) rotate(${tiltDeg.toFixed(1)}deg)`;

    // Wing flap — opacity-based, speed-driven
    wingPhase += (spd * .18 + .35) * (excited ? 1.8 : 1);
    const wOp = .45 + Math.abs(Math.sin(wingPhase)) * .5;
    wings.forEach(w => { w.style.opacity = wOp.toFixed(2); });

    // Pollen
    spawnPollen(bx, by, spd);

    // Draw canvas
    ctx.clearRect(0, 0, W, H);
    const px = (mouseX - W / 2) * .018, py = (mouseY - H / 2) * .012;
    ctx.save();
    ctx.translate(px, py);

    // Base hex grid
    ctx.strokeStyle = 'rgba(194,226,245,.09)';
    ctx.lineWidth = .8;
    hexes.forEach(({ cx, cy }) => { hexPath(cx, cy); ctx.stroke(); });

    // Proximity glow around bee
    hexes.forEach(({ cx, cy }) => {
      const dx = cx - bx + px, dy = cy - by + py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 130) {
        const a = (1 - dist / 130);
        ctx.save();
        ctx.globalAlpha = a * a * .5;
        hexPath(cx, cy);
        ctx.fillStyle = `rgba(248,155,28,1)`;
        ctx.fill();
        ctx.globalAlpha = a * .5;
        ctx.strokeStyle = `rgba(248,155,28,1)`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    });

    ctx.restore();

    // Pollen particles
    for (let i = pollen.length - 1; i >= 0; i--) {
      const p = pollen[i];
      p.x += p.vx; p.y += p.vy; p.vy += .025; p.life -= .028;
      if (p.life <= 0) { pollen.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(248,155,28,${(p.life * .75).toFixed(2)})`;
      ctx.fill();
    }
  }

  // Show bee with fade-in
  requestAnimationFrame(() => { bee.classList.add('visible'); });
  requestAnimationFrame(draw);

  // Resize
  const onResize = () => {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W; canvas.height = H;
  };
  window.addEventListener('resize', onResize);
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

