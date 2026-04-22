// sa.js - Spontany first-party analytics (lightweight, no dependencies)
(function() {
  var SID_KEY = 'sa_sid';
  var sid = sessionStorage.getItem(SID_KEY);
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(SID_KEY, sid);
  }

  // Collect UTMs from URL on first load, persist in sessionStorage
  var params = new URLSearchParams(location.search);
  ['utm_source','utm_medium','utm_campaign','utm_content','fbclid'].forEach(function(k) {
    var v = params.get(k);
    if (v) sessionStorage.setItem(k, v);
  });
  // Capture referrer once per session
  if (document.referrer && !sessionStorage.getItem('sa_ref')) {
    sessionStorage.setItem('sa_ref', document.referrer);
  }

  // Device context (computed once)
  var w = screen.width;
  var device = w <= 480 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop';
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  var tzOffset = new Date().getTimezoneOffset();

  // Session start timestamp for elapsed_ms calculation
  if (!sessionStorage.getItem('sa_start')) {
    sessionStorage.setItem('sa_start', Date.now().toString());
  }

  // Get token from URL or localStorage (authenticated pages)
  var token = params.get('token') || '';
  try { token = token || localStorage.getItem('myToken') || ''; } catch(e) {}

  // Get role (person_a or person_b) - set by match.html
  function getRole() {
    return sessionStorage.getItem('sa_role') || 'person_a';
  }

  window.sa = function(event, extraProps) {
    var utmProps = {};
    ['utm_source','utm_medium','utm_campaign','utm_content','fbclid'].forEach(function(k) {
      var v = sessionStorage.getItem(k);
      if (v) utmProps[k] = v;
    });
    var ref = sessionStorage.getItem('sa_ref');
    if (ref) utmProps.referrer = ref;
    var variant = sessionStorage.getItem('sa_variant') || '';
    if (variant) utmProps.variant = variant;

    var elapsed = Date.now() - parseInt(sessionStorage.getItem('sa_start') || Date.now());

    var props = Object.assign({
      device: device,
      tz: tz,
      tz_offset: tzOffset,
      role: getRole(),
      elapsed_ms: elapsed
    }, utmProps, extraProps || {});

    var body = {
      event: event,
      props: props,
      page: location.pathname,
      session_id: sid,
      token: token
    };

    // sendBeacon for reliability (fires even on page unload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/sa', new Blob([JSON.stringify(body)], {type: 'application/json'}));
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/sa', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(body));
    }
  };
})();
