/* Seating kiosk — public screen.
 *
 * One page, loaded on every entrance screen for an event:
 *   /e/{event-slug}          the event to show
 *   /e/{event-slug}?k=main   optionally tag which screen, for analytics only
 *
 * It reads the guest list once, caches it, and does all searching locally, so a
 * network blip between guests is invisible. Analytics are fire-and-forget: no
 * failure here may ever reach the screen a guest is standing in front of.
 */
(function () {
  'use strict';

  var CONFIG = window.KIOSK_CONFIG || {};
  var CACHE_PREFIX = 'kiosk:event:';

  // Stage shapes offered per event. "fill" simply takes the whole screen, for
  // hardware already cut to the right proportion.
  var RATIOS = {
    '9:16': '9 / 16',   // portrait totem — the usual event display
    '3:4':  '3 / 4',
    '1:1':  '1 / 1',
    '4:3':  '4 / 3',
    '16:9': '16 / 9',   // landscape screen
    'fill': null,
  };

  var THEMES = ['midnight', 'ivory', 'emerald', 'blush', 'noir'];

  var FONT_STACKS = {
    inter: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    rounded: 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };

  var KEY_ROWS = [
    'QWERTYUIOP'.split(''),
    'ASDFGHJKL'.split(''),
    'ZXCVBNM'.split(''),
  ];

  var state = {
    slug: null,
    kioskParam: null,
    payload: null,
    query: '',
    matches: [],
    idleTimer: null,
    searchTrackTimer: null,
    lastTrackedQuery: '',
    welcomeEnabled: true,
  };

  var el = {};

  // --- Utilities ---------------------------------------------------------

  function $(id) { return document.getElementById(id); }

  /** Fold case and accents so "Zoë" is found by typing "zoe". */
  function normalise(value) {
    var text = String(value == null ? '' : value).toLowerCase();
    return text.normalize ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : text;
  }

  function setText(node, value) {
    node.textContent = value == null ? '' : String(value);
  }

  // --- Routing -----------------------------------------------------------

  function readRoute() {
    // /e/{slug} is the documented shape; a bare /{slug} is accepted so a
    // mistyped bookmark on a kiosk still lands somewhere useful.
    var parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'e') return decodeURIComponent(parts[1]);
    if (parts.length === 1) return decodeURIComponent(parts[0]);
    return null;
  }

  function readKioskParam() {
    var match = /[?&]k=([^&]+)/.exec(window.location.search);
    return match ? decodeURIComponent(match[1]) : null;
  }

  // --- Supabase ----------------------------------------------------------

  function rpc(name, body) {
    // Nothing may be added to this URL. PostgREST reads query parameters on an
    // RPC call as filters on the result and rejects anything it does not
    // recognise, so a stray parameter fails every request. The service worker
    // derives its cache key from the request body instead.
    return fetch(CONFIG.supabaseUrl + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.supabaseKey,
        'Authorization': 'Bearer ' + CONFIG.supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }).then(function (response) {
      if (!response.ok) throw new Error('rpc ' + name + ' failed: ' + response.status);
      return response.json();
    });
  }

  function track(type, extra) {
    if (!state.slug) return;
    var body = {
      p_slug: state.slug,
      p_type: type,
      p_query_text: (extra && extra.query) || null,
      p_guest_id: (extra && extra.guestId) || null,
      p_kiosk_param: state.kioskParam,
    };
    // Never surfaced, never awaited. A dropped analytics ping is not an outage.
    rpc('track_usage_event', body).catch(function () {});
  }

  // --- Cache -------------------------------------------------------------
  //
  // A stopgap ahead of the service worker in the full offline phase: it keeps
  // an already-open kiosk working through a network drop, but a first load on
  // a device still needs connectivity.

  function cacheKey() { return CACHE_PREFIX + state.slug; }

  function readCache() {
    try {
      var raw = window.localStorage.getItem(cacheKey());
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || !entry.payload || !entry.storedAt) return null;
      if (Date.now() - entry.storedAt > CONFIG.cacheMaxAgeMs) return null;
      return entry;
    } catch (error) {
      return null;   // Private mode, cleared storage, corrupt entry: no cache.
    }
  }

  function writeCache(payload) {
    try {
      window.localStorage.setItem(cacheKey(), JSON.stringify({
        storedAt: Date.now(),
        payload: payload,
      }));
    } catch (error) {
      /* Storage full or unavailable — the kiosk still works online. */
    }
  }

  // --- Branding ----------------------------------------------------------

  function applyBranding(branding) {
    var b = branding || {};
    var root = document.documentElement;
    var style = root.style;
    var eventName = (state.payload.event && state.payload.event.name) || '';

    // Theme first, so any explicit colour below overrides the preset.
    root.setAttribute('data-theme', THEMES.indexOf(b.theme) >= 0 ? b.theme : 'midnight');
    root.setAttribute('data-ornament', b.ornament === 'none' ? 'none' : 'botanical');

    var ratio = Object.prototype.hasOwnProperty.call(RATIOS, b.aspect_ratio)
      ? b.aspect_ratio : '9:16';
    if (ratio === 'fill') {
      el.stage.setAttribute('data-fill', 'true');
    } else {
      el.stage.removeAttribute('data-fill');
      style.setProperty('--ratio', RATIOS[ratio]);
    }

    // Legacy per-colour overrides still win, so an event branded before the
    // themes existed keeps the colours it was given.
    if (b.background_color) { style.setProperty('--bg-1', b.background_color); style.setProperty('--bg-2', b.background_color); }
    if (b.accent_color) style.setProperty('--gold', b.accent_color);
    if (b.primary_color) style.setProperty('--gold-soft', b.primary_color);
    if (b.font && FONT_STACKS[b.font]) style.setProperty('--ui', FONT_STACKS[b.font]);

    // --- Welcome ---
    var welcomeOn = b.welcome_enabled !== false;
    state.welcomeEnabled = welcomeOn;
    setText(el.welcomeKicker, b.welcome_kicker || 'Welcome to');
    setText(el.welcomeTitle, b.welcome_title || b.header_text || eventName);
    setText(el.welcomeCtaText, b.welcome_cta || 'Tap here to find your seat');
    setText(el.welcomeNote, b.welcome_note || '');
    el.welcomeNote.hidden = !(b.welcome_note || '');

    if (b.hero_image_url) {
      el.welcomeHeroImg.src = b.hero_image_url;
      el.welcomeHero.hidden = false;
    } else {
      el.welcomeHero.hidden = true;
    }

    // --- Search ---
    setText(el.searchTitle, b.search_title || b.header_text || eventName || 'Find your seat');
    setText(el.searchKicker, b.subtitle_text || 'Search by your name');
    setText(el.searchPlaceholder, b.search_placeholder || 'Type your name here');

    // --- Reveal ---
    setText(el.revealTitle, b.reveal_title || "Here's your table");
    setText(el.revealSeatedLabel, b.reveal_seated_label || 'You are seated at');
    setText(el.revealTagline, b.reveal_tagline || '');
    el.revealTagline.hidden = !(b.reveal_tagline || '');
    setText(el.doneText, b.search_again_text || 'Search again');

    var monogram = b.monogram || initialsFrom(b.welcome_title || eventName);
    setText(el.crestText, monogram);
    el.crest.hidden = !monogram;

    if (b.logo_url) {
      el.welcomeLogo.src = b.logo_url;
      el.searchLogo.src = b.logo_url;
      el.welcomeLogo.hidden = false;
      el.searchLogo.hidden = false;
    }

    document.title = b.welcome_title || b.header_text || eventName || 'Find your table';
  }

  /* "Zarina & Robert" becomes Z&R; a one-word name keeps its first letter. */
  function initialsFrom(text) {
    var words = String(text || '').split(/\s*&\s*|\s+and\s+/i);
    if (words.length > 1) {
      return words.map(function (w) { return (w.trim()[0] || '').toUpperCase(); })
        .filter(Boolean).join('&');
    }
    var first = String(text || '').trim()[0];
    return first ? first.toUpperCase() : '';
  }

  // --- Search ------------------------------------------------------------

  function matchesFor(query) {
    var needle = normalise(query);
    if (!needle) return [];

    var guests = state.payload.guests || [];
    var starts = [];
    var contains = [];

    for (var i = 0; i < guests.length; i++) {
      var guest = guests[i];
      var name = normalise(guest.name);
      var at = name.indexOf(needle);
      if (at === 0) {
        starts.push(guest);
      } else if (at > 0) {
        // A word-start match ("smith" finding "Ada Smith") is worth as much as
        // a name-start one; a mid-word hit is weaker but still shown.
        (name.charAt(at - 1) === ' ' ? starts : contains).push(guest);
      }
    }
    return starts.concat(contains);
  }

  function highlight(name, query) {
    var at = normalise(name).indexOf(normalise(query));
    if (at < 0) return document.createTextNode(name);

    var fragment = document.createDocumentFragment();
    var mark = document.createElement('mark');
    // Slice the original string, not the normalised one, so the guest sees
    // their name exactly as it was entered.
    mark.textContent = name.slice(at, at + query.length);
    fragment.appendChild(document.createTextNode(name.slice(0, at)));
    fragment.appendChild(mark);
    fragment.appendChild(document.createTextNode(name.slice(at + query.length)));
    return fragment;
  }

  function renderResults() {
    // Keys are live from first paint, but the guest list may never arrive —
    // an unreachable API leaves the error screen up, and taps still land here.
    if (!state.payload) return;

    el.results.textContent = '';
    var query = state.query;

    setText(el.searchValue, query);
    el.searchPlaceholder.hidden = query.length > 0;

    if (!query) {
      el.noMatch.hidden = true;
      return;
    }

    state.matches = matchesFor(query);

    if (state.matches.length === 0) {
      var branding = state.payload.branding || {};
      setText(el.noMatch, branding.no_match_text || 'No match yet — keep typing, or ask a host.');
      el.noMatch.hidden = false;
      return;
    }

    el.noMatch.hidden = true;

    // Cap the list: a kiosk screen cannot usefully show 200 names, and a guest
    // who sees a wall of results just types another letter.
    var shown = state.matches.slice(0, 40);
    var fragment = document.createDocumentFragment();

    for (var i = 0; i < shown.length; i++) {
      fragment.appendChild(buildResultRow(shown[i], query));
    }
    if (state.matches.length > shown.length) {
      var hidden = state.matches.length - shown.length;
      var more = document.createElement('p');
      more.className = 'no-match';
      setText(more, 'Keep typing — ' + hidden
        + (hidden === 1 ? ' more name matches.' : ' more names match.'));
      fragment.appendChild(more);
    }
    el.results.appendChild(fragment);
    markOverflow();
  }

  /* A row sliced off by the edge of the band, with no scrollbar on a kiosk,
     just looks broken — and a guest cannot tell there are more names below.
     The fade is dropped again the moment the list is scrolled to the end, so
     the last name is never the one that is hard to read. */
  function markOverflow() {
    var list = el.results;
    var more = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
    if (more) list.setAttribute('data-more', 'true');
    else list.removeAttribute('data-more');
  }

  function buildResultRow(guest, query) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'result';
    button.setAttribute('role', 'option');

    var name = document.createElement('span');
    name.className = 'result-name';
    name.appendChild(highlight(guest.name, query));
    button.appendChild(name);

    var hint = document.createElement('span');
    hint.className = 'result-hint';
    setText(hint, guest.table ? 'Tap to see table' : 'Tap for details');
    button.appendChild(hint);

    button.addEventListener('click', function () { showReveal(guest); });
    return button;
  }

  // --- Screens -----------------------------------------------------------

  function showReveal(guest) {
    setText(el.revealName, guest.name);
    setText(el.revealTable, guest.table || 'See a host');

    el.revealExtra.textContent = '';
    var extra = guest.extra || {};
    var fields = ((state.payload.branding || {}).extra_labels) || {};
    Object.keys(extra).forEach(function (key) {
      if (extra[key] == null || extra[key] === '') return;
      var row = document.createElement('div');
      var dt = document.createElement('dt');
      var dd = document.createElement('dd');
      setText(dt, fields[key] || key);
      setText(dd, extra[key]);
      row.appendChild(dt);
      row.appendChild(dd);
      el.revealExtra.appendChild(row);
    });

    showOnly(el.screenReveal);
    track('reveal', { guestId: guest.id });
    resetIdleTimer();
  }

  function showOnly(node) {
    [el.screenWelcome, el.screenSearch, el.screenReveal].forEach(function (screen) {
      screen.hidden = screen !== node;
    });
  }

  function showSearch() {
    showOnly(el.screenSearch);
  }

  /* Wipe what has been typed but stay on the search screen. This is the Clear
   * key: a guest correcting a typo must not be thrown back to the attract
   * screen mid-word. */
  function clearQuery() {
    state.query = '';
    state.matches = [];
    state.lastTrackedQuery = '';
    renderResults();
    showSearch();
    el.results.scrollTop = 0;
  }

  /* Return to the top of the flow, ready for the next guest. With a welcome
   * screen that is the attract loop; without one it is the search screen,
   * because a kiosk must never sit on the previous guest's result. */
  function resetToStart() {
    state.query = '';
    state.matches = [];
    state.lastTrackedQuery = '';
    renderResults();
    showOnly(state.welcomeEnabled ? el.screenWelcome : el.screenSearch);
    el.results.scrollTop = 0;
  }

  // --- Idle --------------------------------------------------------------
  //
  // Nobody clears the screen after themselves. Without this, the next guest
  // walks up to the previous guest's table number.

  function resetIdleTimer() {
    if (state.idleTimer) window.clearTimeout(state.idleTimer);
    state.idleTimer = window.setTimeout(resetToStart, CONFIG.idleResetMs);
  }

  // --- Input -------------------------------------------------------------

  function typeCharacter(character) {
    if (!state.payload) return;
    // A guest who starts typing at the attract screen means to search.
    if (el.screenSearch.hidden) showSearch();
    if (state.query.length >= 40) return;
    state.query += character;
    afterInput();
  }

  function backspace() {
    state.query = state.query.slice(0, -1);
    afterInput();
  }

  function afterInput() {
    renderResults();
    resetIdleTimer();
    scheduleSearchTracking();
  }

  /* One analytics row per search, not one per keystroke: the interesting event
   * is what someone finished typing, especially when it found nothing. */
  function scheduleSearchTracking() {
    if (state.searchTrackTimer) window.clearTimeout(state.searchTrackTimer);
    if (!state.query) return;

    state.searchTrackTimer = window.setTimeout(function () {
      var query = state.query;
      if (!query || query === state.lastTrackedQuery) return;
      state.lastTrackedQuery = query;
      track(state.matches.length === 0 ? 'no_match' : 'search', { query: query });
    }, 1200);
  }

  function buildKeyboard() {
    var fragment = document.createDocumentFragment();

    KEY_ROWS.forEach(function (letters) {
      var row = document.createElement('div');
      row.className = 'keyboard-row';
      letters.forEach(function (letter) {
        row.appendChild(makeKey(letter, 'key', function () { typeCharacter(letter); }));
      });
      fragment.appendChild(row);
    });

    var lastRow = document.createElement('div');
    lastRow.className = 'keyboard-row';
    lastRow.appendChild(makeKey('Clear', 'key key--wide', clearQuery));
    lastRow.appendChild(makeKey('Space', 'key key--space', function () { typeCharacter(' '); }));
    lastRow.appendChild(makeKey('⌫', 'key key--wide', backspace));
    fragment.appendChild(lastRow);

    el.keyboard.appendChild(fragment);
  }

  function makeKey(label, className, onPress) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    setText(button, label);
    button.addEventListener('click', function () {
      onPress();
      // Drop focus for the same reason: nothing should stay armed for the
      // next space or Enter.
      button.blur();
    });
    return button;
  }

  // A physical keyboard is handy for staff testing a screen before doors open.
  function bindPhysicalKeyboard() {
    window.addEventListener('keydown', function (event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Backspace') { event.preventDefault(); backspace(); return; }
      if (event.key === 'Escape') { clearQuery(); return; }
      if (event.key.length === 1 && /[a-z0-9 '\-]/i.test(event.key)) {
        // Space and Enter activate whichever button holds focus, so a physical
        // space right after tapping a key would fire that key a second time —
        // and after tapping Clear, would silently wipe a half-typed name.
        event.preventDefault();
        typeCharacter(event.key);
      }
    });
  }

  // --- Sync indicator ----------------------------------------------------

  function setSync(stateName, label) {
    el.sync.setAttribute('data-state', stateName);
    setText(el.syncLabel, label || '');
  }

  // --- Boot --------------------------------------------------------------

  function fail(message) {
    el.boot.hidden = false;
    el.app.hidden = true;
    setText(el.bootText, message);
  }

  function start(payload, source) {
    state.payload = payload;
    applyBranding(payload.branding);

    el.boot.hidden = true;
    el.app.hidden = false;

    if (source === 'cache') {
      setSync('offline', 'Offline — showing last synced list');
    } else {
      setSync('live', '');
    }

    resetToStart();
    resetIdleTimer();
  }

  function boot() {
    el = {
      app: $('app'), boot: $('boot'), bootText: $('boot-text'), stage: $('stage'),
      screenWelcome: $('screen-welcome'), screenSearch: $('screen-search'),
      screenReveal: $('screen-reveal'),
      welcomeLogo: $('welcome-logo'), welcomeKicker: $('welcome-kicker'),
      welcomeTitle: $('welcome-title'), welcomeHero: $('welcome-hero'),
      welcomeHeroImg: $('welcome-hero-img'), welcomeCta: $('welcome-cta'),
      welcomeCtaText: $('welcome-cta-text'), welcomeNote: $('welcome-note'),
      searchLogo: $('search-logo'), searchTitle: $('search-title'),
      searchKicker: $('search-kicker'),
      searchValue: $('search-value'), searchPlaceholder: $('search-placeholder'),
      results: $('results'), noMatch: $('no-match'), keyboard: $('keyboard'),
      revealTitle: $('reveal-title'), crest: $('crest'), crestText: $('crest-text'),
      revealName: $('reveal-name'), revealSeatedLabel: $('reveal-seated-label'),
      revealTable: $('reveal-table'), revealExtra: $('reveal-extra'),
      revealTagline: $('reveal-tagline'), done: $('done'), doneText: $('done-text'),
      sync: $('sync'), syncLabel: $('sync-label'),
    };

    state.slug = readRoute();
    state.kioskParam = readKioskParam();

    if (!state.slug) {
      fail('No event in this address. A kiosk URL looks like /e/your-event-name.');
      return;
    }

    buildKeyboard();
    bindPhysicalKeyboard();
    el.done.addEventListener('click', resetToStart);
    el.results.addEventListener('scroll', markOverflow, { passive: true });
    // The whole attract screen is the target, not just the button: a guest
    // reaches for the middle of a totem, not a specific pill.
    el.screenWelcome.addEventListener('click', showSearch);
    ['click', 'touchstart', 'keydown'].forEach(function (name) {
      window.addEventListener(name, resetIdleTimer, { passive: true });
    });

    var cached = readCache();

    rpc('event_public_payload', { p_slug: state.slug })
      .then(function (payload) {
        if (!payload) {
          fail('This event has ended.');
          return;
        }
        writeCache(payload);
        start(payload, 'network');
      })
      .catch(function () {
        // Unreachable API. If this screen has been here before, carry on with
        // what it already knows rather than showing a guest an error.
        if (cached) {
          start(cached.payload, 'cache');
        } else {
          fail('Cannot reach the guest list. Please ask a host for help.');
        }
      });

    // A kiosk stays open all evening; refresh so a late guest list edit lands
    // without anyone touching the screen.
    window.setInterval(function () {
      rpc('event_public_payload', { p_slug: state.slug })
        .then(function (payload) {
          if (!payload) return;
          writeCache(payload);
          state.payload = payload;
          setSync('live', '');
          if (el.screenReveal.hidden) renderResults();
        })
        .catch(function () { setSync('stale', 'Reconnecting…'); });
    }, 120000);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // Offline support is a bonus, never a prerequisite: a failed registration
    // (unsupported browser, insecure origin, blocked by policy) must not stop
    // a screen from working normally.
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  registerServiceWorker();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
