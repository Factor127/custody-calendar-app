/* Spontany guided tour — first-run walkthrough of the key features.
   Vanilla JS, no deps. Loaded on calendar.html.
   Auto-starts once per device (localStorage spontany_tour_v1).
   Replay: append ?tour=1 to any calendar URL, or call SpontanyTour.start(). */
(function(){
  'use strict';

  const STORAGE_KEY = 'spontany_tour_v1';
  const Z = 99990;

  // Capture the tour-force flag at script-eval time. The calendar page's init
  // does a history.replaceState that strips query params shortly after load,
  // so by the time `window.load` fires we can no longer read ?tour=1.
  const FORCE_AT_LOAD = (function(){
    try { return new URLSearchParams(location.search).get('tour') === '1'; }
    catch(e){ return false; }
  })();

  // ── Illustrations ───────────────────────────────────────────────────────
  // Each returns an HTML string for a small mockup pinned above the tooltip
  // copy. CSS animations are scoped via a unique class so they auto-play
  // every time the step opens.
  const ILL = {
    dayView: `
      <div class="sptr-ill sptr-ill-day">
        <div class="sptr-ill-strip">
          <div class="sptr-day sptr-day-prev">
            <div class="sptr-day-name">Thu</div>
            <div class="sptr-day-num">11</div>
          </div>
          <div class="sptr-day sptr-day-curr">
            <div class="sptr-day-name">Fri</div>
            <div class="sptr-day-num">12</div>
            <div class="sptr-day-chip">✨ Park w/ Mike</div>
          </div>
          <div class="sptr-day sptr-day-next">
            <div class="sptr-day-name">Sat</div>
            <div class="sptr-day-num">13</div>
            <div class="sptr-day-chip">🍕 Pizza night</div>
          </div>
        </div>
      </div>`,
    crafter: `
      <div class="sptr-ill sptr-ill-crafter">
        <div class="sptr-cr-input">
          <span class="sptr-cr-link">https://eventim.co.il/<span class="sptr-cr-caret">|</span></span>
        </div>
        <div class="sptr-cr-arrow">↓</div>
        <div class="sptr-cr-card">
          <div class="sptr-cr-thumb"></div>
          <div class="sptr-cr-meta">
            <div class="sptr-cr-title">Coldplay · Tel Aviv</div>
            <div class="sptr-cr-sub">Sat · 8:30 PM · invite Mike</div>
          </div>
        </div>
      </div>`,
    pulse: `
      <div class="sptr-ill sptr-ill-pulse">
        <div class="sptr-pulse-row">
          <div class="sptr-pulse-thumb sptr-pulse-thumb-a"></div>
          <div class="sptr-pulse-meta">
            <div class="sptr-pulse-title">Sushi place on Dizengoff</div>
            <div class="sptr-pulse-sub">Saved · open Fri kid-free</div>
          </div>
        </div>
        <div class="sptr-pulse-row">
          <div class="sptr-pulse-thumb sptr-pulse-thumb-b"></div>
          <div class="sptr-pulse-meta">
            <div class="sptr-pulse-title">Jazz at the Barby</div>
            <div class="sptr-pulse-sub">Thu Jun 19 · 9 PM</div>
          </div>
        </div>
        <div class="sptr-pulse-row">
          <div class="sptr-pulse-thumb sptr-pulse-thumb-c"></div>
          <div class="sptr-pulse-meta">
            <div class="sptr-pulse-title">Hike — Ein Hemed</div>
            <div class="sptr-pulse-sub">Anytime · sunny weekend</div>
          </div>
        </div>
      </div>`,
    contacts: `
      <div class="sptr-ill sptr-ill-list">
        <div class="sptr-row">
          <div class="sptr-avatar sptr-av-1">M</div>
          <div class="sptr-row-meta">
            <div class="sptr-row-title">Mike</div>
            <div class="sptr-row-sub">Friend</div>
          </div>
        </div>
        <div class="sptr-row">
          <div class="sptr-avatar sptr-av-2">S</div>
          <div class="sptr-row-meta">
            <div class="sptr-row-title">Sarah</div>
            <div class="sptr-row-sub">Partner</div>
          </div>
        </div>
        <div class="sptr-row">
          <div class="sptr-avatar sptr-av-3">D</div>
          <div class="sptr-row-meta">
            <div class="sptr-row-title">Dana</div>
            <div class="sptr-row-sub">Co-parent</div>
          </div>
        </div>
      </div>`,
    groups: `
      <div class="sptr-ill sptr-ill-list">
        <div class="sptr-row">
          <div class="sptr-stack">
            <span class="sptr-avatar sptr-av-1 sptr-stack-1">M</span>
            <span class="sptr-avatar sptr-av-2 sptr-stack-2">S</span>
            <span class="sptr-avatar sptr-av-3 sptr-stack-3">+2</span>
          </div>
          <div class="sptr-row-meta">
            <div class="sptr-row-title">Bowling crew</div>
            <div class="sptr-row-sub">4 members · last invited 2w ago</div>
          </div>
        </div>
        <div class="sptr-row">
          <div class="sptr-stack">
            <span class="sptr-avatar sptr-av-2 sptr-stack-1">A</span>
            <span class="sptr-avatar sptr-av-1 sptr-stack-2">N</span>
          </div>
          <div class="sptr-row-meta">
            <div class="sptr-row-title">Beach Saturdays</div>
            <div class="sptr-row-sub">2 members · invite all in 1 tap</div>
          </div>
        </div>
      </div>`,
  };

  const STEPS = [
    {
      title: 'Welcome to Spontany',
      body: "Let's take 30 seconds to show you around. You can skip any time.",
      placement: 'center',
    },
    {
      selector: '#calendar-container .month-table, #calendar-container',
      title: 'Your calendar',
      body: 'If you share custody, your kid days appear in purple. The lighter cells are kid-free — those are yours to plan around.',
      placement: 'auto',
      pad: 6,
    },
    {
      selector: '#edit-menu-wrap',
      title: 'Edit your schedule',
      body: 'Sharing custody? Tap here to set or change which days are yours, or mark holidays.',
      placement: 'bottom',
      pad: 8,
    },
    {
      selector: '#bn-view-toggle',
      title: 'Day view',
      body: 'Flip to a day-by-day strip showing plans, ideas, and which friends are free. Swipe to move forward in time.',
      placement: 'top',
      pad: 6,
      illustration: ILL.dayView,
    },
    {
      selector: '#bn-fab-btn',
      title: 'Plan with Crafter',
      body: 'Drop a link to any event — Spontany turns it into an invite you can send to friends in one tap.',
      placement: 'top',
      pad: 4,
      illustration: ILL.crafter,
    },
    {
      selector: '#bn-pulse',
      title: 'Pulse — save for later',
      body: 'Save venues and events you like. Spontany resurfaces them when the timing fits your schedule.',
      placement: 'top',
      pad: 6,
      illustration: ILL.pulse,
    },
    {
      selector: '[onclick*="bnTab(\'connections\')"]',
      title: 'Your contacts',
      body: 'Tap the people icon to see your friends, partner, and co-parent — and invite anyone new.',
      placement: 'bottom',
      pad: 6,
      illustration: ILL.contacts,
    },
    {
      selector: '[onclick*="bnTab(\'connections\')"]',
      title: 'Groups & crews',
      body: 'Save a crew you invite together — one tap adds them all to your next plan.',
      placement: 'bottom',
      pad: 6,
      illustration: ILL.groups,
    },
    {
      selector: '#profile-btn',
      title: "You're all set",
      body: 'Tap your profile any time to update your schedule, contacts, or replay this tour.',
      placement: 'bottom',
      pad: 8,
    },
  ];

  // ── DOM ─────────────────────────────────────────────────────────────────
  let root, mask, hole, tip, currentIdx = 0, active = false;

  function injectStyles(){
    if (document.getElementById('spontany-tour-styles')) return;
    const s = document.createElement('style');
    s.id = 'spontany-tour-styles';
    s.textContent = `
    .sptr-ill { width:100%; border-radius:10px; padding:14px; margin:0 0 12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); overflow:hidden; }

    /* Day view */
    .sptr-ill-day { padding:10px 6px; }
    .sptr-ill-strip { display:flex; gap:6px; align-items:stretch; animation: sptr-strip-slide 4.5s ease-in-out infinite; }
    .sptr-day { flex:1; min-height:78px; padding:8px 4px 6px; border-radius:8px; border:1.5px solid rgba(255,255,255,0.10); background:rgba(255,255,255,0.04); display:flex; flex-direction:column; align-items:center; justify-content:flex-start; gap:2px; }
    .sptr-day-name { font-size:10px; font-weight:700; color:rgba(255,255,255,0.55); text-transform:uppercase; letter-spacing:.05em; }
    .sptr-day-num { font-size:22px; font-weight:800; color:#fff; line-height:1; margin-top:1px; }
    .sptr-day-chip { font-size:9px; font-weight:700; color:#0a0a0a; background:#e6f952; padding:2px 6px; border-radius:6px; margin-top:6px; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sptr-day-curr { border-color:rgba(230,249,82,0.55); background:rgba(230,249,82,0.10); transform:scale(1.04); }
    .sptr-day-prev { opacity:.55; }
    .sptr-day-next { opacity:.75; }
    @keyframes sptr-strip-slide {
      0%,40%   { transform:translateX(0); }
      55%,95%  { transform:translateX(-30%); }
      100%     { transform:translateX(0); }
    }

    /* Crafter paste-link → invite */
    .sptr-ill-crafter { display:flex; flex-direction:column; align-items:center; gap:6px; padding:12px; }
    .sptr-cr-input { width:100%; padding:8px 10px; border-radius:8px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); font:12px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:rgba(255,255,255,0.85); }
    .sptr-cr-link { display:inline-block; max-width:100%; overflow:hidden; white-space:nowrap; }
    .sptr-cr-link::before { content:""; }
    .sptr-cr-caret { display:inline-block; width:1px; background:#a78bfa; color:transparent; animation: sptr-blink 1s steps(1) infinite; margin-left:1px; }
    @keyframes sptr-blink { 50% { opacity:0; } }
    .sptr-cr-arrow { color:#a78bfa; font-size:14px; line-height:1; opacity:0; animation: sptr-arrow 4s ease-in-out infinite; }
    @keyframes sptr-arrow {
      0%,30%   { opacity:0; transform:translateY(-3px); }
      40%,55%  { opacity:1; transform:translateY(0); }
      70%,100% { opacity:0; transform:translateY(3px); }
    }
    .sptr-cr-card { display:flex; gap:9px; align-items:center; width:100%; padding:8px; border-radius:8px; background:linear-gradient(180deg,rgba(167,139,250,0.18),rgba(167,139,250,0.06)); border:1px solid rgba(167,139,250,0.45); opacity:0; transform:translateY(6px); animation: sptr-card-in 4s ease-in-out infinite; }
    @keyframes sptr-card-in {
      0%,45%   { opacity:0; transform:translateY(6px); }
      60%,90%  { opacity:1; transform:translateY(0); }
      100%     { opacity:0; transform:translateY(6px); }
    }
    .sptr-cr-thumb { width:36px; height:36px; border-radius:6px; flex-shrink:0; background:linear-gradient(135deg,#7c5cbf,#f97316); }
    .sptr-cr-meta { min-width:0; }
    .sptr-cr-title { font-size:12px; font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sptr-cr-sub { font-size:11px; color:rgba(255,255,255,0.65); margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    /* Pulse feed */
    .sptr-ill-pulse { padding:8px; }
    .sptr-pulse-row { display:flex; gap:9px; align-items:center; padding:7px 8px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); margin-bottom:5px; opacity:0; transform:translateY(4px); animation: sptr-fade-up .5s ease-out forwards; }
    .sptr-pulse-row:last-child { margin-bottom:0; }
    .sptr-pulse-row:nth-child(1){ animation-delay:.05s; }
    .sptr-pulse-row:nth-child(2){ animation-delay:.18s; }
    .sptr-pulse-row:nth-child(3){ animation-delay:.31s; }
    @keyframes sptr-fade-up { to { opacity:1; transform:translateY(0); } }
    .sptr-pulse-thumb { width:30px; height:30px; border-radius:6px; flex-shrink:0; }
    .sptr-pulse-thumb-a { background:linear-gradient(135deg,#f97316,#7c5cbf); }
    .sptr-pulse-thumb-b { background:linear-gradient(135deg,#a78bfa,#1a73e8); }
    .sptr-pulse-thumb-c { background:linear-gradient(135deg,#43a047,#e6f952); }
    .sptr-pulse-meta { min-width:0; flex:1; }
    .sptr-pulse-title { font-size:12px; font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .sptr-pulse-sub { font-size:11px; color:rgba(255,255,255,0.6); margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    /* Contacts / Groups list */
    .sptr-ill-list { padding:8px; }
    .sptr-row { display:flex; gap:10px; align-items:center; padding:7px 8px; border-radius:8px; margin-bottom:5px; opacity:0; transform:translateY(4px); animation: sptr-fade-up .5s ease-out forwards; }
    .sptr-row:last-child { margin-bottom:0; }
    .sptr-row:nth-child(1){ animation-delay:.05s; }
    .sptr-row:nth-child(2){ animation-delay:.18s; }
    .sptr-row:nth-child(3){ animation-delay:.31s; }
    .sptr-avatar { width:30px; height:30px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; color:#fff; flex-shrink:0; }
    .sptr-av-1 { background:linear-gradient(135deg,#7c5cbf,#5b3fa0); }
    .sptr-av-2 { background:linear-gradient(135deg,#f97316,#c44a07); }
    .sptr-av-3 { background:linear-gradient(135deg,#43a047,#2d7d33); }
    .sptr-row-meta { min-width:0; flex:1; }
    .sptr-row-title { font-size:13px; font-weight:700; color:#fff; }
    .sptr-row-sub   { font-size:11px; color:rgba(255,255,255,0.58); margin-top:1px; }
    .sptr-stack { position:relative; width:46px; height:30px; flex-shrink:0; }
    .sptr-stack .sptr-avatar { position:absolute; top:0; width:24px; height:24px; font-size:10px; border:1.5px solid #181828; }
    .sptr-stack-1 { left:0;  z-index:3; }
    .sptr-stack-2 { left:14px; z-index:2; }
    .sptr-stack-3 { left:28px; z-index:1; background:rgba(255,255,255,0.10) !important; color:rgba(255,255,255,0.8); }
    `;
    document.head.appendChild(s);
  }

  function buildShell(){
    if (root) return;
    injectStyles();
    root = document.createElement('div');
    root.id = 'spontany-tour-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.style.cssText = `position:fixed;inset:0;z-index:${Z};pointer-events:none;`;

    // SVG mask: full-screen dim with a rounded-rect cutout for the target.
    mask = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mask.setAttribute('width', '100%');
    mask.setAttribute('height', '100%');
    mask.style.cssText = 'position:absolute;inset:0;pointer-events:auto;';
    mask.innerHTML = `
      <defs>
        <mask id="spontany-tour-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white"/>
          <rect id="spontany-tour-hole" x="0" y="0" width="0" height="0" rx="14" ry="14" fill="black"/>
        </mask>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="rgba(8,8,16,0.78)" mask="url(#spontany-tour-mask)"/>
    `;
    root.appendChild(mask);
    hole = mask.querySelector('#spontany-tour-hole');

    // Tooltip card
    tip = document.createElement('div');
    tip.id = 'spontany-tour-tip';
    tip.style.cssText = `
      position:absolute;max-width:340px;width:calc(100vw - 32px);
      background:linear-gradient(180deg,#181828 0%,#0f0f1a 100%);
      color:#fff;border:1.5px solid rgba(167,139,250,0.45);border-radius:14px;
      box-shadow:0 18px 48px rgba(0,0,0,0.55),0 0 0 1px rgba(0,0,0,0.4);
      padding:16px 16px 14px;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      pointer-events:auto;opacity:0;transform:translateY(4px);
      transition:opacity .18s ease,transform .18s ease;
    `;
    tip.innerHTML = `
      <button id="spontany-tour-close" aria-label="Close tour"
        style="position:absolute;top:8px;right:10px;background:none;border:none;color:rgba(255,255,255,0.55);font-size:18px;cursor:pointer;line-height:1;padding:4px;z-index:2;">×</button>
      <div id="spontany-tour-illustration"></div>
      <div id="spontany-tour-title" style="font-size:15px;font-weight:700;color:#fff;margin:0 24px 6px 0;letter-spacing:.01em;"></div>
      <div id="spontany-tour-body" style="font-size:13.5px;color:rgba(255,255,255,0.82);margin:0 0 14px;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div id="spontany-tour-dots" style="display:flex;gap:5px;align-items:center;"></div>
        <div style="display:flex;gap:8px;">
          <button id="spontany-tour-back"
            style="background:transparent;border:1px solid rgba(255,255,255,0.18);color:rgba(255,255,255,0.78);border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer;">Back</button>
          <button id="spontany-tour-next"
            style="background:#f97316;border:none;color:#0c0c15;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer;">Next</button>
        </div>
      </div>
    `;
    root.appendChild(tip);
    document.body.appendChild(root);

    tip.querySelector('#spontany-tour-close').addEventListener('click', endTour);
    tip.querySelector('#spontany-tour-back').addEventListener('click', prevStep);
    tip.querySelector('#spontany-tour-next').addEventListener('click', nextStep);

    window.addEventListener('resize', positionForCurrent);
    window.addEventListener('scroll', positionForCurrent, { passive: true });
    document.addEventListener('keydown', onKey);
  }

  function onKey(e){
    if (!active) return;
    if (e.key === 'Escape') endTour();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') nextStep();
    else if (e.key === 'ArrowLeft') prevStep();
  }

  // ── Step rendering ──────────────────────────────────────────────────────
  function renderDots(){
    const wrap = tip.querySelector('#spontany-tour-dots');
    wrap.innerHTML = STEPS.map((_, i) =>
      `<span style="width:6px;height:6px;border-radius:50%;background:${i === currentIdx ? '#a78bfa' : 'rgba(255,255,255,0.22)'};"></span>`
    ).join('');
  }

  function showStep(idx){
    currentIdx = Math.max(0, Math.min(STEPS.length - 1, idx));
    const step = STEPS[currentIdx];
    // Re-set illustration HTML so CSS animations restart on every visit.
    const ill = tip.querySelector('#spontany-tour-illustration');
    ill.innerHTML = step.illustration || '';
    tip.querySelector('#spontany-tour-title').textContent = step.title;
    tip.querySelector('#spontany-tour-body').textContent = step.body;
    tip.querySelector('#spontany-tour-back').style.visibility = currentIdx === 0 ? 'hidden' : 'visible';
    tip.querySelector('#spontany-tour-next').textContent = currentIdx === STEPS.length - 1 ? 'Done' : 'Next';
    renderDots();
    positionForCurrent();
    setTimeout(() => {
      if (!tip) return;
      tip.style.opacity = '1';
      tip.style.transform = 'translateY(0)';
    }, 16);
  }

  function findTarget(step){
    if (!step.selector) return null;
    const sels = step.selector.split(',').map(s => s.trim());
    for (const s of sels){
      let el;
      try { el = document.querySelector(s); } catch(e){ continue; }
      if (el && el.getClientRects().length) return el;
    }
    return null;
  }

  function positionForCurrent(){
    if (!active) return;
    const step = STEPS[currentIdx];
    const target = findTarget(step);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tipW = Math.min(340, vw - 32);
    // Re-measure tip after content set; offsetHeight is post-layout.
    const tipH = tip.offsetHeight || 200;

    if (!target || step.placement === 'center'){
      hole.setAttribute('x', '0');
      hole.setAttribute('y', '0');
      hole.setAttribute('width', '0');
      hole.setAttribute('height', '0');
      tip.style.left = Math.max(16, (vw - tipW) / 2) + 'px';
      tip.style.top  = Math.max(16, (vh - tipH) / 2) + 'px';
      return;
    }

    // Bring target into view first if it's offscreen.
    const r0 = target.getBoundingClientRect();
    if (r0.top < 60 || r0.bottom > vh - 60){
      target.scrollIntoView({ block: 'center', behavior: 'instant' in window ? 'instant' : 'auto' });
    }
    const r = target.getBoundingClientRect();
    const pad = step.pad ?? 6;

    // Spotlight cutout
    hole.setAttribute('x', Math.max(0, r.left - pad));
    hole.setAttribute('y', Math.max(0, r.top - pad));
    hole.setAttribute('width', Math.min(vw, r.width + pad * 2));
    hole.setAttribute('height', Math.min(vh, r.height + pad * 2));

    // Tooltip placement: prefer requested side, but with tall illustrated
    // cards we may need to flip or drop into the side with more room.
    const margin = 12;
    const spaceAbove = r.top - margin;
    const spaceBelow = vh - r.bottom - margin;

    let place = step.placement || 'auto';
    if (place === 'auto') place = spaceBelow > spaceAbove ? 'bottom' : 'top';
    if (place === 'bottom' && spaceBelow < tipH + 8 && spaceAbove > spaceBelow) place = 'top';
    else if (place === 'top' && spaceAbove < tipH + 8 && spaceBelow > spaceAbove) place = 'bottom';

    let left = r.left + r.width / 2 - tipW / 2;
    left = Math.max(16, Math.min(vw - tipW - 16, left));

    let top;
    if (place === 'bottom'){
      top = r.bottom + margin;
    } else {
      top = r.top - tipH - margin;
    }
    // Final clamp — if tooltip is taller than available space either way,
    // sit it as high as possible so the buttons stay visible.
    top = Math.max(16, Math.min(vh - tipH - 16, top));

    tip.style.left = left + 'px';
    tip.style.top  = top + 'px';
  }

  function nextStep(){
    if (currentIdx >= STEPS.length - 1) { finishTour(); return; }
    showStep(currentIdx + 1);
  }
  function prevStep(){
    if (currentIdx === 0) return;
    showStep(currentIdx - 1);
  }
  function finishTour(){
    try { localStorage.setItem(STORAGE_KEY, 'done'); } catch(e){}
    endTour();
  }
  function endTour(){
    active = false;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = mask = hole = tip = null;
    document.removeEventListener('keydown', onKey);
    // Mark seen even on skip — don't re-pester on next load.
    try { localStorage.setItem(STORAGE_KEY, 'done'); } catch(e){}
  }

  // ── Public API ──────────────────────────────────────────────────────────
  function start(){
    if (active) return;
    active = true;
    currentIdx = 0;
    buildShell();
    setTimeout(() => showStep(0), 16);
  }

  function maybeAutoStart(){
    try {
      const force = FORCE_AT_LOAD;
      const seen = localStorage.getItem(STORAGE_KEY) === 'done';
      if (force){
        try {
          const params = new URLSearchParams(location.search);
          if (params.has('tour')){
            params.delete('tour');
            const qs = params.toString();
            history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
          }
        } catch(e){}
      }
      if (!force && seen) return;

      const tryStart = (tries) => {
        const ready = document.querySelector('#calendar-container .month-table');
        if (ready) { setTimeout(start, 250); return; }
        if (tries <= 0) { start(); return; }
        setTimeout(() => tryStart(tries - 1), 200);
      };
      tryStart(25);
    } catch(e){}
  }

  window.SpontanyTour = { start, end: endTour, maybeAutoStart, _steps: STEPS };

  if (document.readyState === 'complete') maybeAutoStart();
  else window.addEventListener('load', maybeAutoStart);
})();
