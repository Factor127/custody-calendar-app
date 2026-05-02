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

  const STEPS = [
    {
      title: 'Welcome to Spontany',
      body: "Let's take 30 seconds to show you around. You can skip any time.",
      placement: 'center',
    },
    {
      selector: '#calendar-container .month-table, #calendar-container',
      title: 'Your custody calendar',
      body: 'Purple cells are your days. The lighter cells are kid-free — those are yours to plan around.',
      placement: 'auto',
      pad: 6,
    },
    {
      selector: '#edit-menu-wrap',
      title: 'Edit your schedule',
      body: 'Tap here to change custody days or mark holidays.',
      placement: 'bottom',
      pad: 8,
    },
    {
      selector: '#bn-view-toggle',
      title: 'Day & Month views',
      body: 'Flip between the full month and a day-by-day strip showing plans, ideas, and which friends are free.',
      placement: 'top',
      pad: 6,
    },
    {
      selector: '#bn-fab-btn',
      title: 'Plan something',
      body: 'The Crafter is the fastest path from idea to plan — it matches you to free friends and venues.',
      placement: 'top',
      pad: 4,
    },
    {
      selector: '#bn-pulse',
      title: 'Pulse — save for later',
      body: 'Save venues and events you like. Spontany resurfaces them when the timing fits your schedule.',
      placement: 'top',
      pad: 6,
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

  function buildShell(){
    if (root) return;
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
      position:absolute;max-width:320px;width:calc(100vw - 32px);
      background:linear-gradient(180deg,#181828 0%,#0f0f1a 100%);
      color:#fff;border:1.5px solid rgba(167,139,250,0.45);border-radius:14px;
      box-shadow:0 18px 48px rgba(0,0,0,0.55),0 0 0 1px rgba(0,0,0,0.4);
      padding:18px 18px 14px;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      pointer-events:auto;opacity:0;transform:translateY(4px);
      transition:opacity .18s ease,transform .18s ease;
    `;
    tip.innerHTML = `
      <button id="spontany-tour-close" aria-label="Close tour"
        style="position:absolute;top:8px;right:10px;background:none;border:none;color:rgba(255,255,255,0.55);font-size:18px;cursor:pointer;line-height:1;padding:4px;">×</button>
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
      const el = document.querySelector(s);
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
    const tipW = Math.min(320, vw - 32);
    const tipH = tip.offsetHeight || 160;

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

    // Spotlight
    hole.setAttribute('x', Math.max(0, r.left - pad));
    hole.setAttribute('y', Math.max(0, r.top - pad));
    hole.setAttribute('width', Math.min(vw, r.width + pad * 2));
    hole.setAttribute('height', Math.min(vh, r.height + pad * 2));

    // Tooltip placement: prefer step.placement, else auto (more space wins)
    let place = step.placement || 'auto';
    if (place === 'auto'){
      place = (vh - r.bottom) > r.top ? 'bottom' : 'top';
    }

    const margin = 12;
    let left = r.left + r.width / 2 - tipW / 2;
    left = Math.max(16, Math.min(vw - tipW - 16, left));

    let top;
    if (place === 'bottom'){
      top = r.bottom + margin;
      if (top + tipH > vh - 16) top = r.top - tipH - margin; // flip if no room
    } else {
      top = r.top - tipH - margin;
      if (top < 16) top = r.bottom + margin; // flip
    }
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
    // Defer one tick so layout settles after scrollIntoView in step 2+.
    setTimeout(() => showStep(0), 16);
  }

  function maybeAutoStart(){
    try {
      const force = FORCE_AT_LOAD;
      const seen = localStorage.getItem(STORAGE_KEY) === 'done';
      if (force){
        // Strip ?tour=1 from the (possibly already-rewritten) URL so a refresh
        // doesn't keep retriggering. The page's init may have already removed
        // it — defensive cleanup either way.
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

      // Wait for the calendar to actually paint a row of cells before starting,
      // so the spotlight has something to anchor to.
      const tryStart = (tries) => {
        const ready = document.querySelector('#calendar-container .month-table');
        if (ready) { setTimeout(start, 250); return; }
        if (tries <= 0) { start(); return; } // fall back to centered welcome
        setTimeout(() => tryStart(tries - 1), 200);
      };
      tryStart(25); // ~5s budget
    } catch(e){}
  }

  window.SpontanyTour = { start, end: endTour, maybeAutoStart, _steps: STEPS };

  if (document.readyState === 'complete') maybeAutoStart();
  else window.addEventListener('load', maybeAutoStart);
})();
