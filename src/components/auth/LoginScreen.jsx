/**
 * src/components/auth/LoginScreen.jsx — Page de connexion
 *
 * Porte fidèlement l'animation de login depuis app.js (initLoginScene).
 *
 * Concepts React utilisés :
 * - useRef : référence un élément DOM sans déclencher de re-rendu.
 *   Équivalent d'un pointeur vers un objet en Java.
 * - useEffect : exécute du code après le rendu. Ici, lance l'animation
 *   canvas une seule fois au montage du composant.
 *
 * L'animation inclut :
 * - Grille hexagonale sur canvas avec halo de proximité autour de l'abeille
 * - Abeille SVG qui rebondit organiquement sur les murs
 * - Particules de pollen
 * - Fleur hexagonale animée en CSS
 *
 * Props :
 * @param {Function} onSignIn - appelée quand l'utilisateur clique "Continuer avec Google"
 */
import { useEffect, useRef, useState } from 'react';

export default function LoginScreen({ onSignIn }) {
  const canvasRef = useRef(null);
  const beeRef = useRef(null);
  const beeSvgRef = useRef(null);
  const wingsRef = useRef([]);
  const flowerSvgRef = useRef(null);
  const containerRef = useRef(null);
  const [signingIn, setSigningIn] = useState(false);

  // Lance l'animation canvas après le premier rendu
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const bee = beeRef.current;
    const beeSvg = beeSvgRef.current;
    if (!canvas || !bee || !container) return;

    const wings = bee.querySelectorAll('[data-wing]');
    wingsRef.current = Array.from(wings);

    // ── Fleur hexagonale animée ─────────────────────────────────────────
    const flSvg = flowerSvgRef.current;
    if (flSvg) {
      const fr = 9, fd = fr * 1.73;
      let fh = '';
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i + Math.PI / 6;
        const pts = Array.from({ length: 6 }, (_, k) => {
          const ka = Math.PI / 3 * k + Math.PI / 6;
          return `${(Math.cos(a) * fd + fr * Math.cos(ka)).toFixed(1)},${(Math.sin(a) * fd + fr * Math.sin(ka)).toFixed(1)}`;
        }).join(' ');
        fh += `<polygon points="${pts}" fill="rgba(194,226,245,.18)" stroke="rgba(194,226,245,.4)" stroke-width=".8"
          style="animation:lnHexIn .45s ${(i * .065).toFixed(3)}s cubic-bezier(.34,1.56,.64,1) both"/>`;
      }
      const cp = Array.from({ length: 6 }, (_, k) => {
        const ka = Math.PI / 3 * k + Math.PI / 6;
        return `${(fr * Math.cos(ka)).toFixed(1)},${(fr * Math.sin(ka)).toFixed(1)}`;
      }).join(' ');
      fh += `<polygon points="${cp}" fill="#F89B1C" opacity=".95"
        style="animation:lnHexIn .45s .39s cubic-bezier(.34,1.56,.64,1) both"/>`;
      flSvg.innerHTML = fh;
    }

    // ── Canvas setup ────────────────────────────────────────────────────
    let W = window.innerWidth, H = window.innerHeight;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Grille hexagonale
    const R = 34, hh = Math.sqrt(3) * R, hw = R * 2;
    let hexes = [];
    function buildHexes() {
      hexes = [];
      for (let row = -1; row < H / hh + 2; row++) {
        for (let col = -1; col < W / (hw * .75) + 2; col++) {
          const ox = col % 2 === 0 ? 0 : hh / 2;
          hexes.push({ cx: col * hw * .75 + R, cy: row * hh + ox + hh / 2 });
        }
      }
    }
    buildHexes();

    function hexPath(cx, cy) {
      ctx.beginPath();
      for (let a = 0; a < 6; a++) {
        const ang = Math.PI / 3 * a - Math.PI / 6;
        ctx.lineTo(cx + R * Math.cos(ang), cy + R * Math.sin(ang));
      }
      ctx.closePath();
    }

    // ── Mouse parallax ───────────────────────────────────────────────────
    let mouseX = W / 2, mouseY = H / 2;
    const onMouseMove = e => { mouseX = e.clientX; mouseY = e.clientY; };
    window.addEventListener('mousemove', onMouseMove);

    // ── Pollen ───────────────────────────────────────────────────────────
    const pollen = [];
    function spawnPollen(x, y, speed) {
      if (Math.random() > 0.18 * speed) return;
      pollen.push({ x, y, vx: (Math.random() - .5) * 1.4, vy: -.4 - Math.random() * .7, life: 1, r: 1.2 + Math.random() * 1.4 });
      if (pollen.length > 50) pollen.splice(0, pollen.length - 50);
    }

    // ── Abeille state ────────────────────────────────────────────────────
    let bx = W * .5, by = H * .28, vx = 0, vy = 0;
    let targetX = bx, targetY = by, targetAge = 0;
    let wingPhase = 0;
    const BM = 50;

    function pickTarget() {
      targetX = BM + Math.random() * (W - BM * 2);
      targetY = BM + Math.random() * (H - BM * 2);
      targetAge = 1400 + Math.random() * 2200;
    }
    pickTarget();
    window._lnBeeExcite = v => { window._lnExcited = v; };

    let lastT = performance.now();
    let animId;

    function draw(now) {
      if (!container || container.dataset.hidden === 'true') return;
      animId = requestAnimationFrame(draw);

      const dt = Math.min(now - lastT, 50);
      lastT = now;
      targetAge -= dt;
      if (targetAge <= 0) pickTarget();

      const excited = !!window._lnExcited;
      const tdx = targetX - bx, tdy = targetY - by;
      const tdist = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      const force = Math.min(tdist * (excited ? .009 : .004), excited ? 1.4 : 0.9);
      vx += (tdx / tdist) * force;
      vy += (tdy / tdist) * force;
      const t = now * .001;
      vx += Math.sin(t * 1.3) * .06; vy += Math.cos(t * 1.7) * .06;
      const damp = excited ? .91 : .93;
      vx *= damp; vy *= damp;
      const spd = Math.sqrt(vx * vx + vy * vy);
      const maxSpd = excited ? 8 : 5;
      if (spd > maxSpd) { vx = vx / spd * maxSpd; vy = vy / spd * maxSpd; }

      const nx = bx + vx, ny = by + vy;
      if (nx < BM)      { vx =  Math.abs(vx) * .45; pickTarget(); }
      else if (nx > W - BM) { vx = -Math.abs(vx) * .45; pickTarget(); }
      if (ny < BM)      { vy =  Math.abs(vy) * .45; pickTarget(); }
      else if (ny > H - BM) { vy = -Math.abs(vy) * .45; pickTarget(); }
      bx = Math.max(BM, Math.min(W - BM, nx));
      by = Math.max(BM, Math.min(H - BM, ny));

      if (bee) {
        bee.style.transform = `translate(${(bx - 22).toFixed(1)}px,${(by - 22).toFixed(1)}px)`;
        const tiltDeg = Math.max(-18, Math.min(18, vy * 2.5));
        if (beeSvg) beeSvg.style.transform = `scaleX(${vx < -.15 ? -1 : 1}) rotate(${tiltDeg.toFixed(1)}deg)`;
      }

      wingPhase += (spd * .18 + .35) * (excited ? 1.8 : 1);
      const wOp = .45 + Math.abs(Math.sin(wingPhase)) * .5;
      wingsRef.current.forEach(w => { w.style.opacity = wOp.toFixed(2); });

      spawnPollen(bx, by, spd);

      ctx.clearRect(0, 0, W, H);
      const px = (mouseX - W / 2) * .018, py = (mouseY - H / 2) * .012;
      ctx.save(); ctx.translate(px, py);
      ctx.strokeStyle = 'rgba(194,226,245,.09)'; ctx.lineWidth = .8;
      hexes.forEach(({ cx, cy }) => { hexPath(cx, cy); ctx.stroke(); });
      hexes.forEach(({ cx, cy }) => {
        const dx = cx - bx + px, dy = cy - by + py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          const a = (1 - dist / 130);
          ctx.save();
          ctx.globalAlpha = a * a * .5; hexPath(cx, cy);
          ctx.fillStyle = 'rgba(248,155,28,1)'; ctx.fill();
          ctx.globalAlpha = a * .5;
          ctx.strokeStyle = 'rgba(248,155,28,1)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.restore();
        }
      });
      ctx.restore();

      for (let i = pollen.length - 1; i >= 0; i--) {
        const p = pollen[i];
        p.x += p.vx; p.y += p.vy; p.vy += .025; p.life -= .028;
        if (p.life <= 0) { pollen.splice(i, 1); continue; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(248,155,28,${(p.life * .75).toFixed(2)})`; ctx.fill();
      }
    }

    requestAnimationFrame(() => { bee.classList.add('visible'); });
    requestAnimationFrame(draw);

    const onResize = () => {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W; canvas.height = H;
      buildHexes();
    };
    window.addEventListener('resize', onResize);

    // Cleanup : arrêter l'animation et retirer les listeners quand le composant est détruit
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      delete window._lnBeeExcite;
      delete window._lnExcited;
    };
  }, []); // [] = exécuté une seule fois au montage

  async function handleSignIn() {
    setSigningIn(true);
    try { await onSignIn(); }
    catch { setSigningIn(false); }
  }

  return (
    <div id="login-root" ref={containerRef}>
      <canvas ref={canvasRef} id="ln-canvas" />

      {/* Abeille volante — redesign pour des ailes bien visibles et une tête mignonne */}
      <div className="ln-bee" ref={beeRef}>
        {/*
          ViewBox élargi (-6 -3 52 52) pour que les ailes qui s'étalent
          de chaque côté ne soient pas rognées par le bord du SVG.
          Ordre SVG : corps → tête → yeux → antennes → AILES EN DERNIER
          (les ailes par-dessus = toujours visibles, jamais cachées par la tête).
        */}
        <svg ref={beeSvgRef} width="52" height="52" viewBox="-6 -3 52 52" fill="none"
          xmlns="http://www.w3.org/2000/svg">

          {/* ── Abdomen ─────────────────────────────────────── */}
          <ellipse cx="20" cy="31" rx="8.5" ry="11" fill="#193644"/>
          {/* Bande jaune haute */}
          <path d="M12 27 Q20 30.5 28 27 L27.5 32 Q20 35.5 12.5 32Z" fill="#F89B1C"/>
          {/* Bande jaune basse */}
          <path d="M12.8 34.5 Q20 38 27.2 34.5 L26.8 39 Q20 42 13.2 39Z" fill="#F89B1C"/>
          {/* Dard */}
          <polygon points="18,42 22,42 20,46" fill="#FF6772" opacity=".8"/>

          {/* ── Thorax ──────────────────────────────────────── */}
          <ellipse cx="20" cy="20" rx="7" ry="6.5" fill="#193644"/>
          {/* Duvet léger sur le thorax */}
          <ellipse cx="20" cy="18.5" rx="5.5" ry="4" fill="#2a5068" opacity=".3"/>

          {/* ── Tête ────────────────────────────────────────── */}
          <circle cx="20" cy="11" r="9" fill="#193644"/>
          {/* Duvet léger sur le front */}
          <ellipse cx="20" cy="8.5" rx="6" ry="4" fill="#2a5068" opacity=".25"/>

          {/* ── Grands yeux expressifs ────────────────────── */}
          {/* Blanc des yeux */}
          <circle cx="15.5" cy="10.5" r="4" fill="white" opacity=".96"/>
          <circle cx="24.5" cy="10.5" r="4" fill="white" opacity=".96"/>
          {/* Pupilles */}
          <circle cx="16.5" cy="11.5" r="2.2" fill="#0d1f2c"/>
          <circle cx="25.5" cy="11.5" r="2.2" fill="#0d1f2c"/>
          {/* Reflet principal (étincelle) */}
          <circle cx="17.8" cy="10" r="1.1" fill="white" opacity=".95"/>
          <circle cx="26.8" cy="10" r="1.1" fill="white" opacity=".95"/>
          {/* Petit reflet secondaire */}
          <circle cx="15.8" cy="13" r=".55" fill="white" opacity=".55"/>
          <circle cx="24.8" cy="13" r=".55" fill="white" opacity=".55"/>

          {/* ── Antennes ────────────────────────────────────── */}
          <path d="M17 4 Q14 0 11.5 -1" stroke="#C2E2F5" strokeWidth="1.3"
            strokeLinecap="round" fill="none" opacity=".75"/>
          <circle cx="11" cy="-1.2" r="2.2" fill="#F89B1C"/>
          <path d="M23 4 Q26 0 28.5 -1" stroke="#C2E2F5" strokeWidth="1.3"
            strokeLinecap="round" fill="none" opacity=".75"/>
          <circle cx="29" cy="-1.2" r="2.2" fill="#F89B1C"/>

          {/* ── AILES — dessinées EN DERNIER pour être toujours visibles ── */}
          {/* Aile supérieure gauche : s'étale en haut-gauche depuis l'épaule */}
          <ellipse data-wing cx="3" cy="14" rx="13" ry="6"
            fill="#C2E2F5" opacity=".88"
            transform="rotate(-22 3 14)"/>
          {/* Aile supérieure droite */}
          <ellipse data-wing cx="37" cy="14" rx="13" ry="6"
            fill="#C2E2F5" opacity=".88"
            transform="rotate(22 37 14)"/>
          {/* Aile inférieure gauche : plus petite, légèrement plus bas */}
          <ellipse data-wing cx="5" cy="23" rx="9.5" ry="4.5"
            fill="#C2E2F5" opacity=".52"
            transform="rotate(-15 5 23)"/>
          {/* Aile inférieure droite */}
          <ellipse data-wing cx="35" cy="23" rx="9.5" ry="4.5"
            fill="#C2E2F5" opacity=".52"
            transform="rotate(15 35 23)"/>
        </svg>
      </div>

      {/* Carte centrale */}
      <div className="ln-card">
        <div className="ln-flower">
          <svg ref={flowerSvgRef} width="56" height="56" viewBox="-30 -30 60 60" fill="none" />
        </div>
        <div className="ln-title">Smart Bees Chat</div>
        <div className="ln-sub">La ruche de nos projets</div>
        <div className="ln-sep" />
        <button
          id="google-signin-btn"
          onClick={handleSignIn}
          disabled={signingIn}
          onMouseEnter={() => { if (window._lnBeeExcite) window._lnBeeExcite(true); }}
          onMouseLeave={() => { if (window._lnBeeExcite) window._lnBeeExcite(false); }}
        >
          <svg width="17" height="17" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
            <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          {signingIn ? 'Connexion…' : 'Continuer avec Google'}
        </button>
      </div>
    </div>
  );
}
