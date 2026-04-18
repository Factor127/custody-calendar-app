// LP SDK — injected into every landing page variant.
// Requires /sa.js to be loaded first (sets up window.sa()).
//
// LP authors use exactly 4 calls:
//   LP.init({ id, type, totalSteps })   → auto-fires lp_view
//   LP.ctaClick()                        → fires lp_cta_click
//   LP.step(index, name)                 → fires demo_step
//   LP.complete()                        → fires demo_complete
//
// Everything else (floating CTA, nudge panel, share sheet) is auto-injected.
(function() {
  'use strict';

  var state = {
    id: null,
    type: 'hero',
    totalSteps: 0,
    currentStep: 0,
    initAt: 0,
    ctaClicked: false,
  };

  function sa(evt, props) {
    if (typeof window.sa === 'function') window.sa(evt, props || {});
  }

  var LP = {
    init: function(opts) {
      opts = opts || {};
      state.id         = opts.id || window.__LP_ID || 'unknown';
      state.type       = opts.type || window.__LP_TYPE || 'hero';
      state.totalSteps = opts.totalSteps || 0;
      state.initAt     = Date.now();

      // Make sure variant is known to sa()
      try { sessionStorage.setItem('sa_variant', state.id); } catch(e) {}

      sa('lp_view', { lp_type: state.type, total_steps: state.totalSteps });

      // Auto-fire demo_abandon on page unload if started but not completed
      window.addEventListener('beforeunload', function() {
        if (state.currentStep > 0 && state.currentStep < state.totalSteps) {
          sa('demo_abandon', {
            step_index: state.currentStep,
            total_steps: state.totalSteps,
            lp_type: state.type,
          });
        }
      });

      // Inject shared components after DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectShared);
      } else {
        injectShared();
      }
    },

    ctaClick: function(meta) {
      state.ctaClicked = true;
      sa('lp_cta_click', Object.assign({ lp_type: state.type }, meta || {}));
    },

    step: function(index, name) {
      state.currentStep = index;
      sa('demo_step', {
        step_index: index,
        step_name: name || '',
        total_steps: state.totalSteps,
        lp_type: state.type,
      });
    },

    complete: function(meta) {
      sa('demo_complete', Object.assign({
        total_steps: state.totalSteps,
        lp_type: state.type,
      }, meta || {}));
    },

    // Navigate to shared signup, preserving variant + UTM
    goToSignup: function(source) {
      var params = new URLSearchParams();
      params.set('variant', state.id);
      ['utm_source','utm_medium','utm_campaign','utm_content','fbclid'].forEach(function(k) {
        var v = sessionStorage.getItem(k);
        if (v) params.set(k, v);
      });
      if (source) params.set('src', source);
      window.location.href = '/lp/_signup?' + params.toString();
    },
  };

  // ── Shared components: floating CTA + nudge panel ─────────────────────────
  function injectShared() {
    if (document.getElementById('lp-shared-root')) return;
    var root = document.createElement('div');
    root.id  = 'lp-shared-root';
    root.innerHTML = SHARED_HTML;
    document.body.appendChild(root);

    var style = document.createElement('style');
    style.textContent = SHARED_CSS;
    document.head.appendChild(style);

    wireShared();
  }

  function wireShared() {
    var floatBtn   = document.getElementById('lp-float-cta');
    var nudgeLink  = document.getElementById('lp-nudge-open');
    var drawer     = document.getElementById('lp-nudge-drawer');
    var backdrop   = document.getElementById('lp-backdrop');
    var closeBtn   = document.getElementById('lp-nudge-close');
    var form       = document.getElementById('lp-nudge-form');
    var thanks     = document.getElementById('lp-nudge-thanks');

    // Floating CTA visibility — reveal after 30% scroll
    function onScroll() {
      var pct = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
      if (pct > 0.25) floatBtn.classList.add('visible');
      else            floatBtn.classList.remove('visible');
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    floatBtn.addEventListener('click', function() {
      sa('lp_cta_float_click', { lp_type: state.type });
      LP.goToSignup('float');
    });

    function openDrawer() {
      drawer.classList.add('open');
      backdrop.classList.add('open');
      sa('nudge_open', { lp_type: state.type });
    }
    function closeDrawer() {
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
    }

    if (nudgeLink) nudgeLink.addEventListener('click', function(e) {
      e.preventDefault();
      openDrawer();
    });
    backdrop.addEventListener('click', closeDrawer);
    closeBtn.addEventListener('click', closeDrawer);

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var phone = form.phone.value.trim();
      var name  = form.first_name.value.trim();
      var time  = form.querySelector('input[name="time_choice"]:checked');
      if (!phone || !time) return;

      var submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Scheduling…';

      var utm = {};
      ['utm_source','utm_medium','utm_campaign','utm_content'].forEach(function(k) {
        var v = sessionStorage.getItem(k);
        if (v) utm[k] = v;
      });

      fetch('/api/nudge/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone,
          first_name: name,
          time_choice: time.value,
          tz_offset_min: new Date().getTimezoneOffset(),
          variant: state.id,
          session_id: sessionStorage.getItem('sa_sid'),
          utm_source:   utm.utm_source,
          utm_campaign: utm.utm_campaign,
          utm_content:  utm.utm_content,
        }),
      })
      .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
      .then(function(res) {
        if (res.ok) {
          sa('nudge_scheduled', { time_choice: time.value, lp_type: state.type });
          form.style.display = 'none';
          thanks.style.display = 'block';
        } else {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Try again';
          if (res.body && res.body.error === 'rate_limited') {
            thanks.textContent = 'You already have a nudge scheduled. Check your texts.';
            form.style.display = 'none';
            thanks.style.display = 'block';
          }
        }
      })
      .catch(function() {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Try again';
      });
    });
  }

  var SHARED_HTML = [
    '<button id="lp-float-cta" type="button" aria-label="Sign up">',
      'Try it free →',
    '</button>',
    '<div id="lp-backdrop" aria-hidden="true"></div>',
    '<aside id="lp-nudge-drawer" role="dialog" aria-label="Nudge me later">',
      '<button id="lp-nudge-close" type="button" aria-label="Close">&times;</button>',
      '<h3>Not right now? We\'ll nudge you.</h3>',
      '<p class="sub">One text, at a time that works. Reply STOP anytime.</p>',
      '<form id="lp-nudge-form">',
        '<label>First name<input name="first_name" type="text" placeholder="Alex" maxlength="40"></label>',
        '<label>Mobile<input name="phone" type="tel" placeholder="+1 214 555 0123" required></label>',
        '<fieldset>',
          '<legend>When?</legend>',
          '<label class="radio"><input type="radio" name="time_choice" value="tonight_9pm" required><span>Tonight, 9pm</span></label>',
          '<label class="radio"><input type="radio" name="time_choice" value="tomorrow_9am"><span>Tomorrow, 9am</span></label>',
          '<label class="radio"><input type="radio" name="time_choice" value="this_weekend"><span>This weekend</span></label>',
        '</fieldset>',
        '<button type="submit">Nudge me</button>',
        '<p class="fine">By tapping, you consent to one SMS from Spontany at the time you chose. Msg&amp;data rates may apply. Reply STOP to opt out.</p>',
      '</form>',
      '<div id="lp-nudge-thanks" style="display:none;">Got it — we\'ll text you. 📲</div>',
    '</aside>',
  ].join('');

  var SHARED_CSS = `
  #lp-float-cta {
    position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%) translateY(120%);
    padding: 14px 28px; border-radius: 999px; border: 0; cursor: pointer;
    background: #c4d630; color: #0a0a0a; font-weight: 700; font-size: 15px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.35); transition: transform 0.3s ease; z-index: 9999;
    font-family: inherit;
  }
  #lp-float-cta.visible { transform: translateX(-50%) translateY(0); }
  #lp-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5); opacity: 0; pointer-events: none;
    transition: opacity 0.2s; z-index: 9998;
  }
  #lp-backdrop.open { opacity: 1; pointer-events: auto; }
  #lp-nudge-drawer {
    position: fixed; left: 0; right: 0; bottom: 0;
    max-width: 480px; margin: 0 auto; background: #111; color: #fff;
    border-radius: 20px 20px 0 0; padding: 24px 20px 32px;
    transform: translateY(100%); transition: transform 0.3s ease;
    z-index: 10000; font-family: inherit; box-sizing: border-box;
  }
  #lp-nudge-drawer.open { transform: translateY(0); }
  #lp-nudge-drawer h3 { margin: 0 0 8px; font-size: 19px; }
  #lp-nudge-drawer p.sub { margin: 0 0 20px; color: rgba(255,255,255,0.6); font-size: 13px; }
  #lp-nudge-drawer label { display: block; margin: 12px 0 4px; font-size: 13px; color: rgba(255,255,255,0.7); }
  #lp-nudge-drawer input[type="text"], #lp-nudge-drawer input[type="tel"] {
    width: 100%; padding: 12px 14px; background: #1a1a1a; color: #fff;
    border: 1px solid #2a2a2a; border-radius: 10px; font-size: 15px; box-sizing: border-box;
    font-family: inherit;
  }
  #lp-nudge-drawer fieldset { border: 0; padding: 0; margin: 16px 0 8px; }
  #lp-nudge-drawer legend { font-size: 13px; color: rgba(255,255,255,0.7); margin-bottom: 8px; }
  #lp-nudge-drawer label.radio {
    display: flex; align-items: center; gap: 10px; padding: 12px;
    background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px;
    margin: 6px 0; cursor: pointer; color: #fff;
  }
  #lp-nudge-drawer label.radio:has(input:checked) { border-color: #c4d630; background: rgba(196,214,48,0.08); }
  #lp-nudge-drawer label.radio input { accent-color: #c4d630; }
  #lp-nudge-drawer button[type="submit"] {
    width: 100%; padding: 14px; margin-top: 16px;
    background: #c4d630; color: #0a0a0a; border: 0; border-radius: 999px;
    font-weight: 700; font-size: 15px; cursor: pointer; font-family: inherit;
  }
  #lp-nudge-drawer button[type="submit"]:disabled { opacity: 0.6; }
  #lp-nudge-close {
    position: absolute; top: 12px; right: 12px; background: transparent; color: #fff;
    border: 0; font-size: 28px; cursor: pointer; line-height: 1; padding: 4px 10px;
  }
  #lp-nudge-drawer .fine { color: rgba(255,255,255,0.35); font-size: 11px; margin-top: 12px; line-height: 1.4; }
  #lp-nudge-thanks { text-align: center; padding: 40px 20px; font-size: 17px; }
  @media (prefers-reduced-motion: reduce) {
    #lp-float-cta, #lp-nudge-drawer, #lp-backdrop { transition: none; }
  }
  `;

  window.LP = LP;
})();
