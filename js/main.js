/* ==========================================================================
   BLACKHEARTH GAMES — studio site terminal
   vanilla JS, no build step
   ========================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Storage helpers (Safari Private mode + locked-down browsers throw)
  // ------------------------------------------------------------------
  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function sessionFlag(key, value) {
    try {
      if (arguments.length === 1) return sessionStorage.getItem(key) === '1';
      if (value) sessionStorage.setItem(key, '1'); else sessionStorage.removeItem(key);
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  var state = {
    scheme: load('bh.scheme', 'dark'),
    user: load('bh.user', 'guest'),
    booted: false,
    history: [],
    historyIdx: -1,
    historyDraft: '',
  };
  if (state.scheme !== 'light' && state.scheme !== 'dark') state.scheme = 'dark';
  // Sanity-check the persisted username — reject root and any non-conforming
  // value so localStorage tampering doesn't survive a reload.
  var USERNAME_RE = /^[a-zA-Z0-9_-]{1,24}$/;
  var HISTORY_LIMIT = 500;
  // Matches the CSS chip-nav breakpoint (see styles.css). When this fires,
  // the typed prompt is replaced by the chip nav row and the help screen
  // filters out commands the user can't invoke (no keyboard).
  var MOBILE_MQ = matchMedia('(max-width: 768px), ((hover: none) and (pointer: coarse) and (max-width: 1024px))');
  function isMobile() { return MOBILE_MQ.matches; }
  if (state.user === 'root' || !USERNAME_RE.test(state.user)) state.user = 'guest';

  // ------------------------------------------------------------------
  // DOM refs (guarded — if the prompt elements are missing, bail and
  // leave the static fallback in place rather than throwing.)
  // ------------------------------------------------------------------
  var $ = function (sel) { return document.querySelector(sel); };
  var bufferEl = $('[data-buffer]');
  var formEl = $('[data-prompt-form]');
  var inputEl = $('[data-prompt-input]');
  var statusLineEl = $('[data-status-line]');
  var clockEl = $('[data-clock]');
  var clearKeyKbd = $('[data-clear-key]');
  var schemeKbd = $('[data-scheme-key]');
  var fieldEl = $('.prompt__field');
  var beforeEl = $('[data-prompt-before]');
  var caretEl = $('[data-prompt-caret]');
  var afterEl = $('[data-prompt-after]');
  var ghostEl = $('[data-prompt-ghost]');

  if (!bufferEl || !formEl || !inputEl || !fieldEl || !beforeEl || !caretEl || !afterEl || !ghostEl) {
    console.warn('[blackhearth] terminal elements missing; serving static fallback.');
    return;
  }

  // We made it this far — switch the page into REPL mode. Setting this from
  // JS (not from a head inline script) means a failed/blocked main.js leaves
  // the static layout intact rather than locking the user out of a disabled
  // prompt with hidden panes.
  document.documentElement.classList.add('has-js');

  // ------------------------------------------------------------------
  // Scheme application + status line
  // ------------------------------------------------------------------
  function applyScheme() {
    if (state.scheme === 'light') {
      document.documentElement.setAttribute('data-scheme', 'light');
    } else {
      document.documentElement.removeAttribute('data-scheme');
    }
    updateStatusLine();
    // Icon is rendered by CSS (::before keyed off :root[data-scheme]), so
    // it stays in sync at first paint and on every toggle without a JS
    // textContent flip.
  }
  function updateStatusLine() {
    if (!statusLineEl) return;
    statusLineEl.textContent = 'online · scheme: ' + state.scheme;
  }

  // The prompt prefix shown on the live input and echoed lines.
  function promptHeadText() {
    return state.user + '@blackhearth ~ $';
  }
  function applyUser() {
    var promptHeadEl = document.querySelector('.prompt__head');
    if (promptHeadEl) promptHeadEl.textContent = promptHeadText();
  }

  // ------------------------------------------------------------------
  // Clock — pauses while the tab is backgrounded
  // ------------------------------------------------------------------
  function tickClock() {
    if (!clockEl) return;
    var d = new Date();
    var h = String(d.getUTCHours()).padStart(2, '0');
    var m = String(d.getUTCMinutes()).padStart(2, '0');
    var s = String(d.getUTCSeconds()).padStart(2, '0');
    clockEl.textContent = h + ':' + m + ':' + s + ' UTC';
  }
  var clockTimer = 0;
  function startClock() {
    if (clockTimer) return;
    tickClock();
    clockTimer = setInterval(tickClock, 1000);
  }
  function stopClock() {
    if (!clockTimer) return;
    clearInterval(clockTimer);
    clockTimer = 0;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopClock(); else startClock();
  });

  // ------------------------------------------------------------------
  // Buffer rendering + typewriter
  // ------------------------------------------------------------------
  var activeTypewriters = [];

  // Auto-scroll only when pinned to bottom so users can scroll up to read.
  // The pin target is the end of REAL content (excluding the buffer's tall
  // padding-bottom, which exists only as scroll-room for scrollNodeToTop and
  // should never be scrolled into — that would leave the user staring at
  // empty padding with the form pulled out of sticky-pinning range).
  var SCROLL_TOLERANCE_PX = 24;
  // Buffer padding-bottom is a static CSS value — cache it once instead of
  // reading getComputedStyle on every typewriter tick (that forces a style
  // recalc in the hot path 60×/sec).
  var bufferPaddingBottomCache = -1;
  function bufferPaddingBottom() {
    if (bufferPaddingBottomCache < 0 && bufferEl) {
      bufferPaddingBottomCache = parseFloat(getComputedStyle(bufferEl).paddingBottom) || 0;
    }
    return Math.max(0, bufferPaddingBottomCache);
  }
  function pinScrollTop() {
    if (!bufferEl) return 0;
    var contentEnd = bufferEl.scrollHeight - bufferPaddingBottom();
    return Math.max(0, contentEnd - bufferEl.clientHeight);
  }
  function isPinnedToBottom() {
    if (!bufferEl) return true;
    return pinScrollTop() - bufferEl.scrollTop <= SCROLL_TOLERANCE_PX;
  }
  function scrollToBottom() {
    if (!bufferEl) return;
    bufferEl.scrollTop = pinScrollTop();
  }

  // Sync the form's negative margin-top so it visually sits right after the
  // latest pane's actual content, even when that pane has min-height: 100%
  // inflating its box for scroll-to-echo-top room. The overlap consumes the
  // pane's empty bottom region — terminal background shows through.
  // Cache the latest-output reference. typewriterReveal sets it when it
  // applies the .is-latest-output class; syncFormMargin reads it directly
  // instead of running a querySelector every animation frame.
  var latestOutputEl = null;
  function syncFormMargin() {
    if (!bufferEl || !formEl) return;
    var latest = latestOutputEl;
    if (!latest || !latest.isConnected) {
      latestOutputEl = null;
      formEl.style.marginTop = '';
      return;
    }
    var paneBottom = latest.getBoundingClientRect().bottom;
    var contentBottom = paneBottom;
    var lastChild = latest.lastElementChild;
    if (lastChild) {
      contentBottom = lastChild.getBoundingClientRect().bottom;
    }
    var overlap = Math.max(0, Math.round(paneBottom - contentBottom));
    formEl.style.marginTop = overlap > 0 ? '-' + overlap + 'px' : '';
  }

  // While the post-echo smooth-scroll is in flight, suppress the typewriter's
  // default "pin to bottom" behavior — otherwise scrollToBottom() fires on
  // every tick and fights the smooth scroll for control of scrollTop.
  var afterEchoScroll = false;
  // Tracked timer + fallback IDs so a back-to-back command can cancel a
  // stranded reset from the prior scrollNodeToTop instead of inheriting a
  // stale timer that flips the flag mid-reveal.
  var afterEchoScrollResetId = 0;
  var scrollSettleFallbackId = 0;
  // Queued typewriter-start callbacks waiting for the scroll-to-echo-top
  // animation to finish. scrollNodeToTop fires them on `scrollend` so the
  // reveal is triggered by the actual scroll-completion position, not a timer.
  var pendingScrollSettleQueue = [];
  var waitForScrollSettle = false;
  // Hard upper bound — if scrollend never fires (no scroll needed, browser
  // doesn't support it, etc.), don't strand the queued reveal forever.
  var SCROLL_SETTLE_FALLBACK_MS = 1200;

  function appendBuffer(node, opts) {
    if (!bufferEl) return;
    opts = opts || {};
    var pinned = !afterEchoScroll && isPinnedToBottom();
    // Form is always the last child so output flows above it like a real shell.
    if (formEl && formEl.parentNode === bufferEl) {
      bufferEl.insertBefore(node, formEl);
    } else {
      bufferEl.appendChild(node);
    }
    if (opts.instant) {
      if (pinned) requestAnimationFrame(scrollToBottom);
    } else {
      typewriterReveal(node, { initiallyPinned: pinned });
    }
  }

  // Smoothly scroll the buffer so the given node sits at the top of the
  // visible area. Used right after appending a command's echo so the user
  // sees just the new command and its result rather than the tail of the
  // previous output. Previous content stays in the buffer (scrollable up).
  //
  // While the typewriter is still revealing, scrollHeight grows char by char
  // — so we also keep re-anchoring scrollTop to the echo every frame until
  // the reveal finishes. Without that, the initial smooth scroll clamps to a
  // too-small target and the echo drifts down as the pane fills out.
  function scrollNodeToTop(node) {
    if (!bufferEl || !node) return;
    var nodeRect = node.getBoundingClientRect();
    var bufRect = bufferEl.getBoundingClientRect();
    var target = bufferEl.scrollTop + (nodeRect.top - bufRect.top);
    var maxScroll = Math.max(0, bufferEl.scrollHeight - bufferEl.clientHeight);
    target = Math.max(0, Math.min(target, maxScroll));
    afterEchoScroll = true;
    // Cancel any pending timers from a previous scrollNodeToTop so they
    // can't race the new one — without this a stale 1.5s reset could flip
    // afterEchoScroll=false right in the middle of the new scroll.
    if (afterEchoScrollResetId) clearTimeout(afterEchoScrollResetId);
    if (scrollSettleFallbackId) clearTimeout(scrollSettleFallbackId);

    // Fire any queued typewriter-start callbacks when the scroll truly
    // settles at the target position (or after a fallback timeout if the
    // browser doesn't deliver `scrollend`, or if no scroll was needed).
    function flushScrollSettleQueue() {
      var q = pendingScrollSettleQueue;
      pendingScrollSettleQueue = [];
      q.forEach(function (fn) { try { fn(); } catch (e) {} });
    }
    var settled = false;
    function settle() {
      if (settled) return;
      settled = true;
      bufferEl.removeEventListener('scrollend', settle);
      if (scrollSettleFallbackId) { clearTimeout(scrollSettleFallbackId); scrollSettleFallbackId = 0; }
      flushScrollSettleQueue();
    }
    // Feature-detect scrollend — Safari and older Firefox don't fire it, so
    // we shorten the fallback there to avoid a ~1.2s wait before each reveal.
    var hasScrollend = 'onscrollend' in window;
    if (hasScrollend) bufferEl.addEventListener('scrollend', settle);
    scrollSettleFallbackId = setTimeout(settle, hasScrollend ? SCROLL_SETTLE_FALLBACK_MS : 350);

    var alreadyAtTarget = Math.abs(bufferEl.scrollTop - target) < 1;
    try {
      bufferEl.scrollTo({ top: target, behavior: 'smooth' });
    } catch (e) {
      bufferEl.scrollTop = target;
    }
    // If no scroll was actually required, scrollend may never fire — flush
    // on the next frame so the typewriter doesn't sit idle waiting.
    if (alreadyAtTarget) requestAnimationFrame(settle);

    // Re-anchor scrollTop to the echo each frame so the echo stays at the
    // top of the buffer as the typewriter pushes the prompt down beneath it.
    function reanchor() {
      if (!node.isConnected) return;
      if (activeTypewriters.length === 0 && pendingScrollSettleQueue.length === 0) {
        afterEchoScroll = false;
        return;
      }
      var nr = node.getBoundingClientRect();
      var br = bufferEl.getBoundingClientRect();
      var t = bufferEl.scrollTop + (nr.top - br.top);
      var max = Math.max(0, bufferEl.scrollHeight - bufferEl.clientHeight);
      bufferEl.scrollTop = Math.max(0, Math.min(t, max));
      requestAnimationFrame(reanchor);
    }
    // Start re-anchoring after the smooth scroll has settled enough to take
    // over (~250ms) — earlier than that and we override the smooth animation.
    setTimeout(function () { requestAnimationFrame(reanchor); }, 250);
    // Fallback flag reset in case the typewriter finishes very quickly.
    afterEchoScrollResetId = setTimeout(function () {
      afterEchoScroll = false;
      afterEchoScrollResetId = 0;
    }, 1500);
  }

  // Walk the freshly-inserted node and reveal its text content character by
  // character. Speed is adaptive (short outputs feel typed; long ones complete
  // in roughly the same time). Preserves HTML — only text nodes are touched.
  //
  // The pane is marked .is-latest-output, which gives it min-height: 100%
  // (one viewport). That guarantees scrollNodeToTop can always land the echo
  // at the visible top — short outputs would otherwise lack the scroll room.
  // syncFormMargin() then pulls the form up via negative margin so it sits
  // right after the actual content (not at the bottom of the inflated pane);
  // the empty pane region below the form just reads as terminal background.
  function typewriterReveal(rootNode, opts) {
    opts = opts || {};
    // Demote any prior latest-output marker; this is the new latest.
    if (latestOutputEl && latestOutputEl !== rootNode) {
      latestOutputEl.classList.remove('is-latest-output');
    }
    rootNode.classList.add('is-latest-output');
    latestOutputEl = rootNode;
    var textNodes = [];
    var walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (n.nodeValue && n.nodeValue.length > 0) {
        textNodes.push({ node: n, full: n.nodeValue });
        n.nodeValue = '';
      }
    }
    if (textNodes.length === 0) { syncFormMargin(); return; }
    syncFormMargin();

    var keepPinned = opts.initiallyPinned !== false;

    // Reduced-motion: skip the reveal animation; still respect aria-busy.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      textNodes.forEach(function (e) { e.node.nodeValue = e.full; });
      if (keepPinned) scrollToBottom();
      return;
    }

    var TARGET_DURATION_MS = 600;
    var MIN_MS_PER_CHAR = 1.5;
    var MAX_MS_PER_CHAR = 10;
    var totalChars = textNodes.reduce(function (sum, e) { return sum + e.full.length; }, 0);
    var msPerChar = Math.min(MAX_MS_PER_CHAR, Math.max(MIN_MS_PER_CHAR, TARGET_DURATION_MS / totalChars));
    // If a scroll-to-echo-top is pending, wait for the buffer's `scrollend`
    // event before starting the reveal — that way the typewriter is triggered
    // by the actual scroll-completion position, not a timer.
    var startTime = 0;
    var rafId = 0;
    var finalized = false;
    var deferred = waitForScrollSettle;
    waitForScrollSettle = false;

    if (activeTypewriters.length === 0) bufferEl.setAttribute('aria-busy', 'true');

    var entry = {
      finalize: function () {
        if (finalized) return;
        finalized = true;
        if (rafId) cancelAnimationFrame(rafId);
        textNodes.forEach(function (e) { e.node.nodeValue = e.full; });
        syncFormMargin();
        var idx = activeTypewriters.indexOf(entry);
        if (idx >= 0) activeTypewriters.splice(idx, 1);
        if (activeTypewriters.length === 0) bufferEl.removeAttribute('aria-busy');
        if (keepPinned) scrollToBottom();
      },
    };
    activeTypewriters.push(entry);

    function tick(now) {
      if (finalized) return;
      // Bail on auto-scroll once the user scrolls up — but keep typing.
      // Also bail while a post-echo scroll is in flight so we don't fight it.
      if (keepPinned && (afterEchoScroll || !isPinnedToBottom())) keepPinned = false;

      var elapsed = now - startTime;
      var charsToReveal = Math.floor(elapsed / msPerChar);
      var charIdx = 0;
      for (var i = 0; i < textNodes.length; i++) {
        var nn = textNodes[i];
        if (charsToReveal >= charIdx + nn.full.length) {
          nn.node.nodeValue = nn.full;
          charIdx += nn.full.length;
        } else if (charsToReveal > charIdx) {
          nn.node.nodeValue = nn.full.slice(0, charsToReveal - charIdx);
          break;
        } else {
          break;
        }
      }
      // Keep the form anchored right after the latest revealed content,
      // shrinking the overlap as the pane's actual text grows.
      syncFormMargin();
      if (keepPinned) scrollToBottom();
      if (charsToReveal >= totalChars) entry.finalize();
      else rafId = requestAnimationFrame(tick);
    }
    function start() {
      if (finalized) return;
      startTime = performance.now();
      rafId = requestAnimationFrame(tick);
    }
    if (deferred) {
      pendingScrollSettleQueue.push(start);
    } else {
      start();
    }
  }

  function finalizeAllTypewriters() {
    activeTypewriters.slice().forEach(function (e) { e.finalize(); });
  }

  function makeEcho(cmd) {
    var div = document.createElement('div');
    div.className = 'echo';
    div.innerHTML = '<span class="echo__head"></span><span class="echo__cmd"></span>';
    div.querySelector('.echo__head').textContent = promptHeadText();
    div.querySelector('.echo__cmd').textContent = cmd;
    return div;
  }
  function makeSystem(html) {
    var div = document.createElement('div');
    div.className = 'system';
    div.innerHTML = html;
    return div;
  }
  function clonePane(name) {
    var src = document.querySelector('[data-pane="' + name + '"]');
    if (!src) return null;
    var clone = src.cloneNode(true);
    clone.removeAttribute('hidden');
    clone.removeAttribute('id');
    clone.removeAttribute('data-pane');
    return clone;
  }

  // ------------------------------------------------------------------
  // Commands
  // ------------------------------------------------------------------
  // `mobileVisible: true` = reachable via the mobile chip nav AND listed in
  // the mobile help screen. Commands without it require typing and are
  // hidden on mobile (no keyboard means no way to invoke them).
  var COMMANDS = {
    about:   { aliases: ['whoami', 'bio', 'studio'], run: cmdPane('about'), mobileVisible: true },
    games:   { aliases: ['ls', 'library'], run: cmdPane('games'), mobileVisible: true },
    ethos:   { aliases: ['creed', 'philosophy', 'manifesto'], run: cmdPane('ethos'), mobileVisible: true },
    contact: { aliases: ['email', 'hello', 'hi'], run: cmdPane('contact'), mobileVisible: true },
    open:    { aliases: [], run: cmdOpen, takesArg: true /* targets filled in after OPEN_GAMES is defined */ },
    roll:    { aliases: ['r', 'dice'], run: cmdRoll, takesArg: true, targets: ['1d20'] },
    whois:   { aliases: [], run: cmdWhois, takesArg: true, targets: ['david'] },
    su:      { aliases: [], run: cmdSu, takesArg: true, targets: ['david', 'guest'] },
    help:    { aliases: ['?', 'h'], run: cmdHelp, mobileVisible: true },
    man:     { aliases: ['info'], run: cmdMan, takesArg: true },
    scheme:  { aliases: ['mode', 'theme', 'color', 'colour'], run: cmdScheme, mobileVisible: true },
    clear:   { aliases: ['cls'], run: cmdClear },
    credits: { aliases: [], run: cmdCredits, mobileVisible: true },
    reboot:  { aliases: ['restart'], run: cmdReboot },
    exit:    { aliases: ['quit', 'q'], run: cmdExit },
  };

  // One canonical record per game (id + label + url + alias list). The flat
  // OPEN_TARGETS map is derived from this so lookup is O(1) and the picker
  // doesn't have to dedup by URL anymore.
  var OPEN_GAMES = [
    {
      id: 'court-wizard',
      label: 'court wizard',
      url: 'https://courtwizard.blackhearthgames.com',
      aliases: ['courtwizard', 'cw'],
    },
    {
      id: 'orbs',
      label: 'o.r.b.s.',
      url: 'https://orbs.blackhearthgames.com',
      aliases: ['orb'],
    },
  ];
  var OPEN_TARGETS = Object.create(null);
  OPEN_GAMES.forEach(function (g) {
    OPEN_TARGETS[g.id] = g;
    g.aliases.forEach(function (a) { OPEN_TARGETS[a] = g; });
  });
  // Tab-complete targets are the canonical ids only (aliases still resolve
  // at runtime via OPEN_TARGETS, just not as autosuggested defaults).
  COMMANDS.open.targets = OPEN_GAMES.map(function (g) { return g.id; });

  // ----- dice roller -----
  // Parses NdM[th|tlK][±K] notation. Examples:
  //   1d20         → 1 twenty-sided die
  //   3d6+2        → 3 six-sided dice with +2 modifier
  //   8d20th6      → roll 8d20, take the highest 6
  //   8d20tl6-1    → roll 8d20, take the lowest 6, with -1 modifier
  //   d20          → shorthand for 1d20
  var DICE_RE = /^(\d*)d(\d+)(?:t([hl])(\d+))?([+-]\d+)?$/;
  var MAX_DICE_COUNT = 1000;
  var MAX_DICE_SIDES = 1000000;
  function cmdRoll(args) {
    // Join args without spaces so "roll 1d20 +2" and "roll 1d20+2" both parse.
    var expr = (args || []).join('').toLowerCase();
    if (!expr) {
      var rollExamples = ['roll 1d20', 'roll 3d6+2', 'roll 8d20th6', 'roll 4d6tl3'];
      var rollHtml = rollExamples.map(function (ex) {
        return '<button type="button" class="runnable" data-cmd="' + escapeHtml(ex) +
          '" aria-label="run ' + escapeHtml(ex) + '">' + escapeHtml(ex) + '</button>';
      }).join(' ');
      appendBuffer(makeSystem(
        '<div class="cmd-usage">' +
          '<p>usage: <code>roll &lt;dice&gt;</code></p>' +
          '<p class="cmd-usage__row">examples: ' + rollHtml + '</p>' +
        '</div>'
      ));
      return;
    }
    var m = expr.match(DICE_RE);
    if (!m) {
      appendBuffer(makeSystem(
        '<pre><span class="err">invalid dice: ' + escapeHtml(expr) + '</span>. expected <code>NdM</code>, <code>NdM±K</code>, or <code>NdMth|tlK</code>.</pre>'
      ));
      return;
    }
    var count = m[1] === '' ? 1 : parseInt(m[1], 10);
    var sides = parseInt(m[2], 10);
    var takeDir = m[3];                                // 'h', 'l', or undefined
    var takeCount = m[4] ? parseInt(m[4], 10) : 0;
    var mod = m[5] ? parseInt(m[5], 10) : 0;
    if (count < 1 || count > MAX_DICE_COUNT) {
      appendBuffer(makeSystem('<pre><span class="err">dice count must be between 1 and ' + MAX_DICE_COUNT + '</span>.</pre>'));
      return;
    }
    if (sides < 1 || sides > MAX_DICE_SIDES) {
      appendBuffer(makeSystem('<pre><span class="err">dice sides must be between 1 and ' + MAX_DICE_SIDES + '</span>.</pre>'));
      return;
    }
    if (takeDir && (takeCount < 1 || takeCount > count)) {
      appendBuffer(makeSystem('<pre><span class="err">take count must be between 1 and ' + count + '</span> (the number of dice rolled).</pre>'));
      return;
    }

    var rolls = [];
    for (var i = 0; i < count; i++) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }

    // Build a "kept" flag per roll. Without a take modifier, all rolls count.
    var kept = new Array(count);
    if (takeDir) {
      var indexed = [];
      for (var j = 0; j < count; j++) indexed.push([rolls[j], j]);
      indexed.sort(function (a, b) { return takeDir === 'h' ? b[0] - a[0] : a[0] - b[0]; });
      for (var k = 0; k < count; k++) kept[k] = false;
      for (var n = 0; n < takeCount; n++) kept[indexed[n][1]] = true;
    } else {
      for (var p = 0; p < count; p++) kept[p] = true;
    }

    var sum = 0;
    for (var q = 0; q < count; q++) if (kept[q]) sum += rolls[q];
    var total = sum + mod;

    // Display: kept values bright, dropped values dimmed.
    var parts = [];
    for (var r2 = 0; r2 < count; r2++) {
      parts.push(kept[r2] ? String(rolls[r2]) : '<span class="dim">' + rolls[r2] + '</span>');
    }

    var modStr = mod === 0 ? '' : (mod > 0 ? ' + ' + mod : ' − ' + Math.abs(mod));
    var notation = count + 'd' + sides +
      (takeDir ? 't' + takeDir + takeCount : '') +
      (mod === 0 ? '' : (mod > 0 ? '+' + mod : String(mod)));
    var html =
      '<pre>rolled <span class="accent">' + escapeHtml(notation) + '</span>\n' +
      '  [' + parts.join(', ') + ']' + modStr + ' = <span class="accent">' + total + '</span></pre>';
    appendBuffer(makeSystem(html));
  }

  function cmdOpen(args) {
    var raw = (args[0] || '').toLowerCase();
    if (!raw) {
      // Build a clickable list of game targets so the user can tap one
      // instead of typing. Only canonical targets are listed (aliases are
      // shown in dim text).
      var rows = OPEN_GAMES.map(function (g) {
        var aliasHint = g.aliases && g.aliases.length
          ? ' <span class="dim">(aliases: ' + escapeHtml(g.aliases.join(', ')) + ')</span>'
          : '';
        return '<p class="cmd-usage__row">' +
          '<button type="button" class="runnable" data-cmd="open ' + escapeHtml(g.id) + '" ' +
            'aria-label="open ' + escapeHtml(g.label) + '">→ ' + escapeHtml(g.id) + '</button>' +
          aliasHint +
          '</p>';
      }).join('');
      appendBuffer(makeSystem(
        '<div class="cmd-usage"><p>which game site?</p>' + rows + '</div>'
      ));
      return;
    }
    var target = OPEN_TARGETS[raw];
    if (!target) {
      appendBuffer(makeSystem(
        '<pre><span class="err">no such game: ' + escapeHtml(raw) + '</span>. try <code>open</code> to list available game sites.</pre>'
      ));
      return;
    }
    appendBuffer(makeSystem(
      '<pre>→ opening <span class="accent">' + escapeHtml(target.label) + '</span>&apos;s website in a new tab&hellip;</pre>'
    ));
    window.open(target.url, '_blank', 'noopener,noreferrer');
  }

  function resolveCmd(name) {
    if (!name) return null;
    var lc = name.toLowerCase();
    if (COMMANDS[lc]) return lc;
    for (var key in COMMANDS) {
      if (COMMANDS[key].aliases.indexOf(lc) >= 0) return key;
    }
    return null;
  }

  function cmdPane(name) {
    return function () {
      var pane = clonePane(name);
      if (pane) appendBuffer(pane);
    };
  }

  function cmdSu(args) {
    var raw = args[0];
    if (!raw) {
      appendBuffer(makeSystem(
        '<pre><span class="err">su: missing operand</span>. usage: <code>su &lt;username&gt;</code></pre>'
      ));
      return;
    }
    if (raw.toLowerCase() === 'root') {
      appendBuffer(makeSystem(
        '<pre><span class="err">su: nice try.</span> we can\'t hand out root access to just anyone.</pre>'
      ));
      return;
    }
    if (!USERNAME_RE.test(raw)) {
      appendBuffer(makeSystem(
        '<pre><span class="err">su: invalid username</span>. letters, digits, dashes, and underscores only (max 24 chars).</pre>'
      ));
      return;
    }
    state.user = raw;
    save('bh.user', state.user);
    applyUser();
    appendBuffer(makeSystem(
      '<pre>switched user → <span class="accent">' + escapeHtml(state.user) + '@blackhearth</span></pre>'
    ));
  }

  function cmdWhois(args) {
    var subject = (args[0] || '').toLowerCase();
    if (subject === 'david') {
      appendBuffer(makeSystem(
        '<pre><span class="accent">david yurek</span>\n  founder, sole developer, primary suspect.\n  passion: fantasy worlds, systems design, open code.\n\n  → contact   <a href="mailto:support@blackhearthgames.com">support@blackhearthgames.com</a>\n\nhe made court wizard. he is making o.r.b.s. say hello.</pre>'
      ));
      return;
    }
    appendBuffer(makeSystem('<pre>whois who? try <code>whois david</code>.</pre>'));
  }

  // Each row's `key` is the command this row documents — used to filter by
  // COMMANDS[key].mobileVisible. `label` may include argument hint (e.g.
  // `open <game>`) for display; lookups always use `key`.
  var HELP_CONTENT = [
    { key: 'about',   label: 'about',          desc: 'the studio',                 hint: 'whoami, bio, studio' },
    { key: 'games',   label: 'games',          desc: "what's being developed",     hint: 'ls, library' },
    { key: 'ethos',   label: 'ethos',          desc: 'studio principles',          hint: 'creed, philosophy, manifesto' },
    { key: 'contact', label: 'contact',        desc: 'say hello',                  hint: 'email, hello, hi' },
    { key: 'open',    label: 'open <game>',    desc: "visit a game's website",     hint: 'e.g., open court-wizard' },
    { key: 'roll',    label: 'roll <dice>',    desc: 'roll dice (NdM, ±K, th/tl K)', hint: 'e.g., 1d20, 3d6+2, 8d20th6' },
    { key: 'whois',   label: 'whois david',    desc: 'the founder' },
  ];
  var HELP_UTILITY = [
    { key: 'su',      label: 'su <name>',      desc: 'switch the prompt name',     hint: 'e.g., su david' },
    { key: 'scheme',  label: 'scheme',         desc: 'toggle dark / light',        hint: 'mode, theme' },
    { key: 'clear',   label: 'clear',          desc: 'clear the buffer',           hint: 'cls' },
    { key: 'credits', label: 'credits',        desc: 'who built this terminal' },
    { key: 'reboot',  label: 'reboot',         desc: 'replay the boot sequence',   hint: 'restart' },
    { key: 'help',    label: 'help',           desc: 'this screen',                hint: '?, h' },
    { key: 'man',     label: 'man <cmd>',      desc: 'manual entry for a command', hint: 'e.g., man roll' },
  ];

  function renderHelpRow(row) {
    // `hint` covers both alias lists and example notations. Rendered as a
    // separate grid cell so it aligns vertically across rows on desktop;
    // hidden on narrow viewports via CSS (.help__aliases { display: none }).
    // An empty placeholder is emitted when a row has no hint so the grid's
    // auto-flow doesn't pull the next row's cmd into this row's column 3.
    var hint;
    if (row.hint) {
      var prefix = row.hint.indexOf('e.g.') === 0 ? '' : 'aliases: ';
      hint = '<span class="help__aliases dim">' + escapeHtml(prefix + row.hint) + '</span>';
    } else {
      hint = '<span class="help__aliases" aria-hidden="true"></span>';
    }
    // The cmd cell is a real <button data-cmd="..."> so it's clickable AND
    // keyboard-focusable for users who can't type — the document-level chip
    // handler picks up [data-cmd] and runs it. Argument placeholders are
    // stripped from the data-cmd so e.g. `roll <dice>` invokes `roll`
    // (which prints usage). The aria-label keeps the visible label so the
    // announced action matches what the user sees, and adds "— show usage"
    // for arg-bearing rows since `roll` (no args) prints a usage screen
    // rather than performing a roll.
    var hasArg = /<[^>]+>/.test(row.label);
    var runnable = row.label.replace(/\s+<[^>]+>/g, '').replace(/<[^>]+>\s*/g, ' ').trim() || row.key;
    var aria = hasArg ? row.label + ' — show usage' : 'run ' + row.label;
    return '<div class="help__row">' +
      '<button type="button" class="help__cmd" data-cmd="' + escapeHtml(runnable) +
        '" aria-label="' + escapeHtml(aria) + '">' +
        escapeHtml(row.label) +
      '</button>' +
      '<span class="help__desc">' + escapeHtml(row.desc) + '</span>' +
      hint +
      '</div>';
  }

  function cmdHelp() {
    var mobile = isMobile();
    function visible(row) {
      var c = COMMANDS[row.key];
      return !mobile || (c && c.mobileVisible);
    }
    var content = HELP_CONTENT.filter(visible);
    var utility = HELP_UTILITY.filter(visible);

    var html = '<section class="help" aria-label="command reference">';
    html += '<p class="help__title accent">commands</p>';
    if (content.length) {
      html += '<p class="help__group dim">content</p>';
      content.forEach(function (r) { html += renderHelpRow(r); });
    }
    if (utility.length) {
      html += '<p class="help__group dim">utility</p>';
      utility.forEach(function (r) { html += renderHelpRow(r); });
    }
    if (mobile) {
      html += '<p class="help__footer dim">tap a chip below to navigate · <kbd>☾</kbd>/<kbd>☼</kbd> toggles scheme.</p>';
    } else {
      html += '<p class="help__group dim">keys</p>';
      html += '<pre class="help__keys">' +
        '    enter   run                                           tab     complete\n' +
        '    →       accept suggest                                ↑ / ↓   history\n' +
        '    ⌘K      clear                                         ⌘;      scheme\n' +
        '    esc     cancel current input</pre>';
      html += '<p class="help__footer dim">aliases exist. type the obvious thing — it probably works.</p>';
    }
    html += '</section>';
    appendBuffer(makeSystem(html));
  }

  // ----- man pages -----
  // Mini reference docs for each command. `man <cmd>` prints the entry in
  // a Linux-man-page-like layout. Aliases of the command (resolved via
  // resolveCmd) are accepted as the lookup key, mirroring `man ls` →
  // games behavior in real shells.
  var MAN_PAGES = {
    about: {
      name: 'about — studio identity card',
      synopsis: 'about',
      description: 'Shows a short bio of the studio: who runs it, when it started, what game it\'s working on, and how it operates.',
      examples: ['about'],
    },
    games: {
      name: 'games — what is being developed',
      synopsis: 'games',
      description: "Lists the games this studio has made. Right now: Court Wizard, and O.R.B.S. in development.",
      examples: ['games'],
    },
    ethos: {
      name: 'ethos — studio principles',
      synopsis: 'ethos',
      description: 'A short statement of what this studio cares about and how it operates.',
      examples: ['ethos'],
    },
    contact: {
      name: 'contact — say hello',
      synopsis: 'contact',
      description: 'Shows the studio\'s email and a button that opens your email app with a new message started. We read everything; we usually reply.',
      examples: ['contact'],
    },
    open: {
      name: "open — visit a game's website",
      synopsis: 'open <game>',
      description: "Opens the game's website in a new browser tab. This does not start the game itself — it just takes you to the game's webpage, where you can read more about it, download it, or play it.",
      arguments: [
        ['<game>', 'court-wizard (aliases: courtwizard, cw) · orbs (alias: orb)'],
      ],
      examples: ['open court-wizard', 'open cw', 'open orbs'],
    },
    roll: {
      name: 'roll — roll dice',
      synopsis: 'roll <NdM>[th|tlK][±K]',
      description: 'Rolls dice. You can roll any number of dice with any number of sides, add or subtract a bonus to the total, and optionally keep only the highest or lowest few rolls.',
      arguments: [
        ['N',         'how many dice to roll (defaults to 1)'],
        ['M',         'how many sides each die has'],
        ['thK / tlK', 'keep only the K highest (th) or K lowest (tl) rolls'],
        ['±K',        'a number added to or subtracted from the total'],
      ],
      examples: ['roll 1d20', 'roll d20', 'roll 3d6+2', 'roll 2d8-1', 'roll 8d20th6', 'roll 4d6tl3+1'],
    },
    whois: {
      name: 'whois — look up a person',
      synopsis: 'whois <subject>',
      description: "Prints a short bio of the person you name. Right now, only `whois david` (the founder) is set up.",
      arguments: [
        ['<subject>', 'david (the founder)'],
      ],
      examples: ['whois david'],
    },
    su: {
      name: 'su — switch the prompt username',
      synopsis: 'su <name>',
      description: 'Changes the name shown before the @blackhearth in the prompt (e.g. guest@blackhearth → david@blackhearth). The name sticks across page reloads. `root` is not allowed.',
      arguments: [
        ['<name>', 'a short name (letters, digits, dashes, or underscores; up to 24 characters)'],
      ],
      examples: ['su david', 'su guest'],
    },
    help: {
      name: 'help — command reference',
      synopsis: 'help',
      description: 'Lists every available command with a one-line description.',
      examples: ['help'],
    },
    man: {
      name: 'man — show the manual for a command',
      synopsis: 'man <command>',
      description: 'Shows the manual page for a command. Aliases also work — for example, `man ls` will show the manual for `games`.',
      arguments: [
        ['<command>', 'any command name or alias'],
      ],
      examples: ['man roll', 'man open', 'man scheme'],
    },
    scheme: {
      name: 'scheme — toggle dark / light mode',
      synopsis: 'scheme',
      description: 'Switches between dark and light mode. Your choice sticks across page reloads.',
      examples: ['scheme'],
    },
    clear: {
      name: 'clear — empty the screen',
      synopsis: 'clear',
      description: 'Removes all printed output, leaving a fresh prompt. Your command history is kept. Shortcut: ⌘K (Mac) or Ctrl+K.',
      // No EXAMPLES — running `clear` from within `man clear` would erase
      // the page the user is reading.
    },
    credits: {
      name: 'credits — who built this and what they used',
      synopsis: 'credits',
      description: 'Shows who built this website and which fonts and tools were used along the way.',
      examples: ['credits'],
    },
    reboot: {
      name: 'reboot — start over from the boot screen',
      synopsis: 'reboot',
      description: 'Clears the screen and replays the boot-up animation, then shows the help screen again — like a fresh visit.',
      // No EXAMPLES — tapping `reboot` from inside `man reboot` would wipe
      // the page the user is reading and replay the boot animation.
    },
    exit: {
      name: 'exit — say goodbye',
      synopsis: 'exit',
      description: 'Disables the prompt and prints a farewell. Press any key or click anywhere to bring it back. (The page can\'t actually close itself — browsers don\'t allow that.)',
      // No EXAMPLES — tapping `exit` from inside `man exit` would disable
      // the prompt the user might want to use next.
    },
  };

  // Populate man's tab-completion targets now that both tables exist.
  COMMANDS.man.targets = Object.keys(MAN_PAGES);

  function cmdMan(args) {
    var subject = (args[0] || '').toLowerCase();
    if (!subject) {
      var pageLinks = Object.keys(MAN_PAGES).sort().map(function (p) {
        return '<button type="button" class="runnable" data-cmd="man ' + escapeHtml(p) +
          '" aria-label="show manual for ' + escapeHtml(p) + '">' + escapeHtml(p) + '</button>';
      }).join(', ');
      appendBuffer(makeSystem(
        '<div class="cmd-usage">' +
          '<p>usage: <code>man &lt;command&gt;</code></p>' +
          '<p class="cmd-usage__row">available: ' + pageLinks + '</p>' +
        '</div>'
      ));
      return;
    }
    // Resolve aliases — e.g. `man ls` → games's manual entry.
    // hasOwnProperty guard prevents `man __proto__` / `man constructor` /
    // `man toString` from leaking inherited Object.prototype keys through
    // the lookup and producing nonsense or a TypeError downstream.
    var key = resolveCmd(subject) || subject;
    var page = Object.prototype.hasOwnProperty.call(MAN_PAGES, key) ? MAN_PAGES[key] : null;
    if (!page) {
      appendBuffer(makeSystem(
        '<pre><span class="err">no manual entry for ' + escapeHtml(subject) + '</span>. try <code>man</code> with no argument to list available pages.</pre>'
      ));
      return;
    }
    var html = '<section class="man" aria-label="manual: ' + escapeHtml(key) + '">';
    html += '<p class="man__section accent">NAME</p>';
    html += '<p class="man__body">' + escapeHtml(page.name) + '</p>';
    html += '<p class="man__section accent">SYNOPSIS</p>';
    html += '<p class="man__body"><code>' + escapeHtml(page.synopsis) + '</code></p>';
    html += '<p class="man__section accent">DESCRIPTION</p>';
    html += '<p class="man__body">' + escapeHtml(page.description) + '</p>';
    if (page.arguments && page.arguments.length) {
      html += '<p class="man__section accent">ARGUMENTS</p>';
      page.arguments.forEach(function (pair) {
        html += '<div class="man__arg">' +
          '<span class="man__arg-name"><code>' + escapeHtml(pair[0]) + '</code></span>' +
          '<span class="man__arg-desc">' + escapeHtml(pair[1]) + '</span>' +
          '</div>';
      });
    }
    // ALIASES section is sourced from the COMMANDS table — single source
    // of truth, so adding/removing an alias only requires one edit.
    var cmdAliases = (COMMANDS[key] && COMMANDS[key].aliases) || [];
    if (cmdAliases.length) {
      html += '<p class="man__section accent">ALIASES</p>';
      html += '<p class="man__body">' + escapeHtml(cmdAliases.join(', ')) + '</p>';
    }
    if (page.examples && page.examples.length) {
      html += '<p class="man__section accent">EXAMPLES</p>';
      page.examples.forEach(function (ex) {
        // Clickable so non-typing users can run the example directly.
        html += '<button type="button" class="man__example" data-cmd="' +
          escapeHtml(ex) + '" aria-label="run ' + escapeHtml(ex) + '">' +
          escapeHtml(ex) + '</button>';
      });
    }
    html += '</section>';
    appendBuffer(makeSystem(html));
  }

  function cmdScheme() {
    state.scheme = state.scheme === 'light' ? 'dark' : 'light';
    save('bh.scheme', state.scheme);
    applyScheme();
    appendBuffer(makeSystem('<pre>scheme → <span class="accent">' + state.scheme + '</span></pre>'));
  }

  function cmdClear() {
    if (!bufferEl) return;
    finalizeAllTypewriters();
    Array.from(bufferEl.children).forEach(function (child) {
      if (child !== formEl) bufferEl.removeChild(child);
    });
    if (formEl) formEl.style.marginTop = '';
    latestOutputEl = null;
    // Drop any queued typewriter-start callbacks — their target nodes have
    // been removed and running them would mutate detached DOM. Also unwind
    // the post-echo scroll flags so the next command starts from a clean slate.
    pendingScrollSettleQueue = [];
    waitForScrollSettle = false;
    afterEchoScroll = false;
    if (afterEchoScrollResetId) { clearTimeout(afterEchoScrollResetId); afterEchoScrollResetId = 0; }
    if (scrollSettleFallbackId) { clearTimeout(scrollSettleFallbackId); scrollSettleFallbackId = 0; }
  }

  function cmdCredits() {
    var html =
      '<pre><span class="accent">credits</span>\n───────\n\n' +
      'built by David Yurek, in the open, on top of vanilla html / css / js.\n' +
      'no frameworks, no build step, no analytics. runs on Cloudflare Pages.\n\n' +
      'fonts:\n' +
      '  monaspace neon     (terminal — github, sil ofl)\n' +
      '  monaspace krypton  (ui — github, sil ofl)\n' +
      '  press start 2p     (wordmark — cody boisclair, sil ofl)\n\n' +
      '<span class="dim">source: forthcoming.</span></pre>';
    appendBuffer(makeSystem(html));
  }

  function cmdReboot() {
    // Reset UI state so the replayed boot animation behaves like a fresh load.
    inputEl.blur();                          // fire blur so .is-focused clears
    if (fieldEl) fieldEl.classList.remove('is-focused');
    inputEl.disabled = true;
    state.booted = false;
    sessionFlag('bh.booted', false);
    cmdClear();
    // Clear the URL hash so finishBoot doesn't re-run the previous content
    // command (e.g. #about) after the reboot animation completes. pushState
    // (not replaceState) preserves the prior history entry — Back from a
    // freshly-rebooted state still returns to whatever was last shown.
    if (location.hash) {
      history.pushState({}, '', location.pathname + location.search);
    }
    boot();
  }

  function cmdExit() {
    appendBuffer(makeSystem('<pre>→ goodbye. <span class="dim">(reload or type to return.)</span></pre>'));
    inputEl.disabled = true;
    inputEl.blur();
    if (fieldEl) fieldEl.classList.remove('is-focused');
    // Allow any meaningful keystroke or click to re-enable the prompt so
    // the user isn't trapped in an inert state. Filter out modifier-only
    // taps (Shift, Cmd, Ctrl, Alt, Meta) and browser shortcut combos
    // (Cmd+L, Cmd+R, etc.) so the prompt doesn't silently revive on every
    // unrelated keypress after exit.
    function reviveOnKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;     // shortcut combos
      if (e.key === 'Shift' || e.key === 'Control' ||
          e.key === 'Alt' || e.key === 'Meta') return;    // modifier-only
      revive();
    }
    function revive() {
      document.removeEventListener('keydown', reviveOnKey, true);
      document.removeEventListener('pointerdown', revive, true);
      inputEl.disabled = false;
      refocusInput();
    }
    document.addEventListener('keydown', reviveOnKey, true);
    document.addEventListener('pointerdown', revive, true);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ------------------------------------------------------------------
  // Hash routing
  // ------------------------------------------------------------------
  // Top-level content commands that get pushed to history (so back/forward
  // works through them); other commands run without polluting the URL bar.
  var HISTORY_COMMANDS = ['about', 'games', 'ethos', 'contact'];
  // Legacy hashes that aliased to the canonical commands' previous names.
  var LEGACY_HASHES = Object.create(null);
  LEGACY_HASHES.philosophy = 'ethos';
  LEGACY_HASHES.creed = 'ethos';
  LEGACY_HASHES.launch = 'open';
  LEGACY_HASHES.main = '';
  LEGACY_HASHES.hero = '';
  LEGACY_HASHES.top = '';

  function readRouteHash() {
    var raw = (location.hash || '').replace(/^#/, '').trim().toLowerCase();
    if (raw in LEGACY_HASHES) return LEGACY_HASHES[raw];
    return raw;
  }

  function parse(raw) {
    var trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    var parts = trimmed.split(/\s+/);
    return { cmd: parts[0], args: parts.slice(1) };
  }

  // Given the buffer child that was the form's previousElementSibling BEFORE
  // a command ran, return the first element that command appended (or null
  // if nothing was added). Used by execute() to find a scroll anchor when
  // there's no echo to anchor on.
  function firstAppendedAfter(priorLast) {
    if (!bufferEl || !formEl) return null;
    var next = priorLast ? priorLast.nextElementSibling : bufferEl.firstElementChild;
    return (next && next !== formEl) ? next : null;
  }

  function execute(raw, opts) {
    opts = opts || {};
    var parsed = parse(raw);
    if (!parsed) return;
    var echoNode = null;
    if (opts.echo !== false) {
      echoNode = makeEcho(raw.trim());
      appendBuffer(echoNode, { instant: true });
    }

    // Pre-set the post-echo scroll flag so the typewriter (which starts
    // synchronously inside COMMANDS[key].run()) doesn't fight the imminent
    // scrollNodeToTop with its own auto-pin-to-bottom behavior. Also queue
    // the reveal to wait for the buffer's actual `scrollend` — the prompt
    // visibly returns to the top first, then the result reveals.
    //
    // Set unconditionally: even echo-less invocations (auto-help on boot,
    // popstate routing) should scroll the new output to the top so the
    // boot lines / previous content visibly slide off rather than the new
    // content typing out below them.
    afterEchoScroll = true;
    waitForScrollSettle = true;

    // Remember what was the last buffer child before the command runs so we
    // can identify what got appended (used as the scroll anchor when there's
    // no echo to anchor on).
    var priorLast = (bufferEl && formEl) ? formEl.previousElementSibling : null;

    var key = resolveCmd(parsed.cmd);
    if (!key) {
      appendBuffer(makeSystem(
        '<pre><span class="err">command not found: ' + escapeHtml(parsed.cmd) + '</span>. try <code>help</code>.</pre>'
      ));
      // Even unknown commands deserve the scroll-to-top treatment.
      var notFoundAnchor = echoNode || firstAppendedAfter(priorLast);
      if (notFoundAnchor) requestAnimationFrame(function () {
        if (notFoundAnchor.isConnected) scrollNodeToTop(notFoundAnchor);
      });
      waitForScrollSettle = false;
      return;
    }
    try {
      COMMANDS[key].run(parsed.args);
    } catch (e) {
      console.error('command failed', key, e);
      appendBuffer(makeSystem('<pre><span class="err">that didn\'t work. error logged.</span></pre>'));
    }
    // Reset the wait flag if no typewriter consumed it (e.g. cmdClear).
    waitForScrollSettle = false;
    // Animate the buffer so the new output's first element sits at the top
    // of the visible area. Falls back to the first element appended during
    // this command if no echo exists (auto-help on boot / popstate routing).
    var anchor = echoNode || firstAppendedAfter(priorLast);
    if (anchor) requestAnimationFrame(function () {
      if (anchor.isConnected) scrollNodeToTop(anchor);
    });

    if (opts.pushHistory && HISTORY_COMMANDS.indexOf(key) >= 0) {
      var hash = '#' + key;
      if (location.hash !== hash) history.pushState({ cmd: key }, '', hash);
    } else if (opts.replaceHistory) {
      // Only rewrite the URL for canonical content commands. Non-content
      // commands (help/scheme/clear/etc.) keep whatever hash brought them here
      // so a shared "/#help" link isn't silently stripped to "/".
      if (HISTORY_COMMANDS.indexOf(key) >= 0) {
        var canonical = '#' + key;
        if (location.hash !== canonical) {
          history.replaceState({ cmd: key }, '', canonical);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Boot sequence
  // ------------------------------------------------------------------
  var BOOT_LINES = [
    'BLACKHEARTH-OS v1.0 · 2026',
    '> initializing… ok',
    '> loading session… ok',
    '> ready.',
  ];

  function boot() {
    if (state.booted) return;
    var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var alreadyBooted = sessionFlag('bh.booted');

    if (reduced || alreadyBooted) {
      finishBoot();
      return;
    }

    var bootHost = makeSystem('<pre data-boot></pre>');
    if (bufferEl && formEl && formEl.parentNode === bufferEl) {
      bufferEl.insertBefore(bootHost, formEl);
    } else if (bufferEl) {
      bufferEl.appendChild(bootHost);
    }
    var pre = bootHost.querySelector('[data-boot]');
    var lineIdx = 0;
    var charIdx = 0;
    var lastFrame = 0;
    var skipped = false;
    var rafId = 0;

    function skip() {
      if (skipped) return;
      skipped = true;
      cleanupSkipListeners();
      if (rafId) cancelAnimationFrame(rafId);
      if (pre && pre.isConnected) pre.textContent = BOOT_LINES.join('\n');
      finishBoot();
    }
    function cleanupSkipListeners() {
      document.removeEventListener('keydown', skip, true);
      document.removeEventListener('pointerdown', skip, true);
    }
    // Manual register + manual cleanup so stale listeners don't survive
    // when the boot animation finishes naturally and `reboot` is later run.
    document.addEventListener('keydown', skip, true);
    document.addEventListener('pointerdown', skip, true);

    function tick(ts) {
      if (skipped) return;
      // Bail if a reboot detached this boot host between frames — otherwise
      // we'd keep mutating a disconnected node and re-scheduling rAFs forever.
      if (!pre.isConnected) { cleanupSkipListeners(); return; }
      if (ts - lastFrame >= 18) {
        lastFrame = ts;
        if (lineIdx < BOOT_LINES.length) {
          var line = BOOT_LINES[lineIdx];
          if (charIdx < line.length) {
            pre.textContent += line.charAt(charIdx++);
          } else {
            pre.textContent += '\n';
            lineIdx++;
            charIdx = 0;
          }
        } else {
          cleanupSkipListeners();
          finishBoot();
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function finishBoot() {
    if (state.booted) return;
    state.booted = true;
    sessionFlag('bh.booted', true);
    inputEl.disabled = false;
    updateMirror();

    var hash = readRouteHash();
    if (hash && resolveCmd(hash)) {
      execute(hash, { echo: false, replaceHistory: true });
    } else {
      // First visit / no hash → show the command reference straight away.
      execute('help', { echo: false });
    }

    // Auto-focus the prompt so the user can start typing immediately. Skip if
    // some other element already has focus (e.g. the skip-link, reached via
    // Tab from the address bar) — don't steal that.
    var active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) {
      focusPrompt();
    }
  }

  // ------------------------------------------------------------------
  // Routing (popstate)
  // ------------------------------------------------------------------
  window.addEventListener('popstate', function () {
    if (!state.booted) return; // boot will read the hash itself when it finishes
    finalizeAllTypewriters();
    cmdClear(); // restore the destination view from scratch so back/forward shows a clean state
    var hash = readRouteHash();
    if (hash && resolveCmd(hash)) {
      execute(hash, { echo: false });
    } else {
      // No hash → mirror finishBoot's "show help on a blank state" so back to
      // root doesn't leave the user staring at an empty buffer.
      execute('help', { echo: false });
    }
  });

  // ------------------------------------------------------------------
  // Submit handler
  // ------------------------------------------------------------------
  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var raw = inputEl.value;
    if (!raw.trim()) {
      inputEl.value = '';
      updateMirror();
      return;
    }
    // Finalize in-progress typewriters so the previous output is fully present
    // before the next command's output starts typing.
    finalizeAllTypewriters();
    // Skip consecutive duplicates; cap the buffer at HISTORY_LIMIT so
    // findSuggestion's linear scan stays bounded in long-lived sessions.
    var prev = state.history[state.history.length - 1];
    if (raw !== prev) {
      state.history.push(raw);
      if (state.history.length > HISTORY_LIMIT) {
        state.history.splice(0, state.history.length - HISTORY_LIMIT);
      }
    }
    state.historyIdx = -1;
    inputEl.value = '';
    updateMirror();
    execute(raw, { pushHistory: true });
    refocusInput();
  });

  // ------------------------------------------------------------------
  // Mirror + autosuggestion (fish-style — history first, then commands)
  // ------------------------------------------------------------------
  // Pre-sorted suggestion pool: canonical command names + multi-char aliases.
  // Each entry carries a rank — canonical names rank 0, aliases rank 1 — so a
  // canonical match always beats an alias of the same prefix (e.g. typing
  // `c` suggests `clear` ahead of `cls`). Ties break on length then alpha.
  var SUGGESTIONS = (function () {
    var pool = [];
    Object.keys(COMMANDS).forEach(function (k) {
      pool.push({ s: k, rank: 0 });
      (COMMANDS[k].aliases || []).forEach(function (a) {
        if (a.length > 1) pool.push({ s: a, rank: 1 });
      });
    });
    pool.sort(function (a, b) {
      return a.rank - b.rank || a.s.length - b.s.length || a.s.localeCompare(b.s);
    });
    return pool.map(function (e) { return e.s; });
  })();

  // For commands that take an argument (e.g. whois), the first registered
  // target is the default suggestion when only the command was typed.
  function defaultArgFor(cmdKey) {
    var def = COMMANDS[cmdKey];
    if (!def || !def.takesArg) return '';
    var targets = def.targets || [];
    return targets[0] || '';
  }

  // Returns the suffix to display as ghost (and accept on Tab/→).
  // Matches CASE-SENSITIVELY so typing "Ab" doesn't suggest "out" — which
  // would build the malformed "About" on accept.
  function findSuggestion(text) {
    if (!text) return '';

    // 1. History walk, most-recent first. Match prefix case-sensitively.
    for (var i = state.history.length - 1; i >= 0; i--) {
      var h = state.history[i];
      if (h && h.length > text.length && h.indexOf(text) === 0) {
        return h.slice(text.length);
      }
    }

    // 2. Command names + aliases (SUGGESTIONS is pre-sorted shortest-first).
    for (var j = 0; j < SUGGESTIONS.length; j++) {
      var s = SUGGESTIONS[j];
      if (s !== text && s.indexOf(text) === 0) {
        return s.slice(text.length);
      }
    }

    // 3. The typed text is exactly a command (canonical or alias) — suggest
    //    its default argument. e.g., "whois" → " david".
    var cmdKey = resolveCmd(text);
    if (cmdKey && COMMANDS[cmdKey].takesArg) {
      var def = defaultArgFor(cmdKey);
      if (def) return ' ' + def;
    }

    // 4. Argument completion: "whois da" → "vid".
    var parts = text.split(/\s+/);
    if (parts.length === 2 && parts[0]) {
      var subCmd = resolveCmd(parts[0]);
      if (subCmd && COMMANDS[subCmd].takesArg) {
        var argPrefix = parts[1];
        var argTargets = COMMANDS[subCmd].targets || [];
        for (var k = 0; k < argTargets.length; k++) {
          var t = argTargets[k];
          if (t !== argPrefix && t.indexOf(argPrefix) === 0) {
            return t.slice(argPrefix.length);
          }
        }
      }
    }

    return '';
  }

  // The full active suggestion suffix. Stored in JS rather than reconstructed
  // from DOM because the first char of the suffix is split into the caret box.
  var currentSuggestion = '';
  var lastMirrorKey = '';

  function updateMirror() {
    if (!fieldEl) return;
    var value = inputEl.value;
    var pos = inputEl.selectionStart != null ? inputEl.selectionStart : value.length;
    var atEnd = pos === value.length;
    var ghost = atEnd ? findSuggestion(value) : '';

    // Coalesce: if nothing observable changed since last render, skip the DOM writes.
    var key = value + '\x00' + pos + '\x00' + ghost;
    if (key === lastMirrorKey) return;
    lastMirrorKey = key;

    currentSuggestion = ghost;
    var before = value.slice(0, pos);
    var after = value.slice(pos);
    var caretChar = '';
    var afterRest = after;
    var ghostRest = ghost;
    var caretIsGhost = false;
    if (after.length > 0) {
      caretChar = after.charAt(0);
      afterRest = after.slice(1);
    } else if (ghost.length > 0) {
      caretChar = ghost.charAt(0);
      ghostRest = ghost.slice(1);
      caretIsGhost = true;
    }

    fieldEl.classList.toggle('has-input', value.length > 0);
    beforeEl.textContent = before;
    caretEl.textContent = caretChar;
    // Tell the CSS whether the caret's char came from typed input or from
    // the ghost suggestion — ghost chars render dim to match the rest.
    caretEl.classList.toggle('is-ghost', caretIsGhost);
    afterEl.textContent = afterRest;
    ghostEl.textContent = ghostRest;
  }

  function acceptSuggestion() {
    if (!currentSuggestion) return false;
    inputEl.value = inputEl.value + currentSuggestion;
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    state.historyIdx = -1;
    updateMirror();
    return true;
  }

  function setCaretToEnd(el) {
    // Use the standards-defined API rather than the brittle value-reset trick;
    // some browsers leave the caret at position 0 after value reassignment.
    try { el.setSelectionRange(el.value.length, el.value.length); }
    catch (e) { /* element disabled / unselectable input type — safe to ignore */ }
  }

  // ------------------------------------------------------------------
  // Input event wiring
  // ------------------------------------------------------------------
  inputEl.addEventListener('input', function () {
    state.historyIdx = -1;
    updateMirror();
  });
  inputEl.addEventListener('focus', function () {
    if (fieldEl) fieldEl.classList.add('is-focused');
    updateMirror();
  });
  inputEl.addEventListener('blur', function () {
    if (fieldEl) fieldEl.classList.remove('is-focused');
    updateMirror();
  });
  inputEl.addEventListener('click', updateMirror); // catches caret moves on click that don't fire input
  inputEl.addEventListener('keyup', function (e) {
    // Arrow keys move the caret; updateMirror needs to resync the block-cursor
    // position. Other movement keys (Home/End/etc.) are also covered.
    if (e.key.indexOf('Arrow') === 0 || e.key === 'Home' || e.key === 'End') {
      updateMirror();
    }
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp') {
      if (state.history.length === 0) return;
      e.preventDefault();
      if (state.historyIdx === -1) {
        state.historyDraft = inputEl.value;
        state.historyIdx = state.history.length - 1;
      } else if (state.historyIdx > 0) {
        state.historyIdx--;
      }
      inputEl.value = state.history[state.historyIdx];
      setCaretToEnd(inputEl);
      updateMirror();
    } else if (e.key === 'ArrowDown') {
      if (state.historyIdx === -1) return;
      e.preventDefault();
      if (state.historyIdx < state.history.length - 1) {
        state.historyIdx++;
        inputEl.value = state.history[state.historyIdx];
      } else {
        state.historyIdx = -1;
        inputEl.value = state.historyDraft;
      }
      setCaretToEnd(inputEl);
      updateMirror();
    } else if (e.key === 'ArrowRight' || e.key === 'End') {
      if (inputEl.selectionStart === inputEl.value.length && currentSuggestion) {
        e.preventDefault();
        acceptSuggestion();
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (!acceptSuggestion()) handleTab();
    } else if (e.key === 'Escape') {
      // Clear the current input line (Ctrl-U / fish-cancel style). Useful when
      // the user wants to abandon what they've typed without submitting.
      e.preventDefault();
      if (inputEl.value === '') return;
      inputEl.value = '';
      state.historyIdx = -1;
      state.historyDraft = '';
      updateMirror();
    }
  });

  // ------------------------------------------------------------------
  // Tab completion (cycles to the longest common prefix or prints candidates)
  // ------------------------------------------------------------------
  function handleTab() {
    if (inputEl.selectionStart !== inputEl.value.length) return;
    var raw = inputEl.value;
    if (!raw) return;
    var parts = raw.split(/\s+/);
    var headParts = parts.slice(0, parts.length - 1);
    var prefix = parts[parts.length - 1];

    if (parts.length === 1) {
      // Complete a command name (canonical only — no aliases).
      var prefixLc = prefix.toLowerCase();
      var candidates = Object.keys(COMMANDS).filter(function (k) {
        return k.indexOf(prefixLc) === 0;
      });
      finishTab(candidates, prefix, '');
    } else {
      var cmdKey = resolveCmd(parts[0]);
      if (!cmdKey || !COMMANDS[cmdKey].takesArg) return;
      var targets = COMMANDS[cmdKey].targets || [];
      var argPrefixLc = prefix.toLowerCase();
      var argCandidates = targets.filter(function (t) {
        return t.indexOf(argPrefixLc) === 0;
      });
      finishTab(argCandidates, prefix, headParts.join(' ') + ' ');
    }
  }

  function finishTab(candidates, prefix, head) {
    if (candidates.length === 0) return;
    if (candidates.length === 1) {
      inputEl.value = head + candidates[0] + ' ';
      setCaretToEnd(inputEl);
      updateMirror();
      return;
    }
    var common = longestCommonPrefix(candidates);
    // Only extend the input when the LCP grows the user's existing prefix.
    // With an empty prefix (e.g. tab after "whois david ") we just list
    // candidates instead of silently shortening the user's text.
    if (prefix && common.length > prefix.length) {
      inputEl.value = head + common;
      setCaretToEnd(inputEl);
      updateMirror();
    } else {
      appendBuffer(makeSystem('<pre><span class="dim">' + candidates.join('  ') + '</span></pre>'), { instant: true });
    }
  }
  function longestCommonPrefix(arr) {
    if (!arr.length) return '';
    var a = arr[0];
    for (var i = 1; i < arr.length; i++) {
      var j = 0;
      while (j < a.length && j < arr[i].length && a[j] === arr[i][j]) j++;
      a = a.slice(0, j);
      if (!a) return '';
    }
    return a;
  }

  // ------------------------------------------------------------------
  // Global hotkeys — modifier-based, fire regardless of focus.
  // Every path through here finalizes any in-progress typewriter so
  // overlapping reveals don't fight for scroll.
  // ------------------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    // Don't hijack the user's typing in a different text input. The prompt
    // input itself is OK because it's the natural home of these shortcuts.
    if (isTypingTarget(e.target) && e.target !== inputEl) return;
    var key = e.key.toLowerCase();
    if (key === 'k') {
      e.preventDefault();
      finalizeAllTypewriters();
      execute('clear', { echo: false });
      return;
    }
    if (key === ';' || e.code === 'Semicolon') {
      e.preventDefault();
      finalizeAllTypewriters();
      execute('scheme', { echo: true });
    }
  });

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  // ------------------------------------------------------------------
  // Auto-focus: the input is always focused after boot. If the user clicks
  // anywhere that ISN'T an interactive element (button, link, input,
  // anything with tabindex), pull focus back to the prompt. This makes the
  // terminal "always typing-ready" without forcing users to find the input.
  // ------------------------------------------------------------------
  function focusPrompt() {
    if (inputEl && !inputEl.disabled) inputEl.focus();
  }
  function refocusInput() {
    // After a command runs we'd refocus — but if the user has deliberately
    // moved focus to a link in the output buffer (e.g. tabbed to the email
    // link in the contact pane), don't yank focus away from it.
    var active = document.activeElement;
    if (active && active.closest && active.closest('[role="log"]') && active.tagName === 'A') return;
    focusPrompt();
  }
  // Click anywhere non-interactive → pull focus back to prompt.
  document.addEventListener('pointerdown', function (e) {
    if (!state.booted || inputEl.disabled) return;
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('button, a, input, textarea, select, label, [tabindex]')) return;
    // Defer so the browser's own click → focus semantics finish first.
    setTimeout(focusPrompt, 0);
  });
  // Tab back to the site (e.g. from another window) → refocus the prompt.
  window.addEventListener('focus', function () {
    if (!state.booted) return;
    var active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) {
      focusPrompt();
    }
  });

  // ------------------------------------------------------------------
  // Chip clicks — finalize typewriters first so new output doesn't race.
  // ------------------------------------------------------------------
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    // Mailto and modified-clicks fall through to native handling.
    if (btn.tagName === 'A') {
      var href = btn.getAttribute('href') || '';
      if (href.indexOf('mailto:') === 0) return;
      if (e.metaKey || e.ctrlKey || e.button === 1) return;
    }
    e.preventDefault();
    finalizeAllTypewriters();
    var raw = btn.getAttribute('data-cmd');
    execute(raw, { pushHistory: true });
    refocusInput();
  });

  // ------------------------------------------------------------------
  // Platform-specific kbd labels (Cmd vs. Ctrl)
  // ------------------------------------------------------------------
  (function labelHotkeys() {
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    if (clearKeyKbd && !isMac) clearKeyKbd.textContent = 'Ctrl+K';
    if (schemeKbd && !isMac) schemeKbd.textContent = 'Ctrl+;';
  })();

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------
  applyScheme();
  applyUser();
  startClock();

  // Wait for the critical fonts to load (so the boot animation lines up to
  // monospace columns), but never block the boot on a font promise rejection.
  function startBootFlow() { boot(); }

  if (document.fonts && document.fonts.ready && typeof Promise !== 'undefined') {
    Promise.race([
      document.fonts.ready,
      new Promise(function (r) { setTimeout(r, 1500); }),
    ])
      .then(startBootFlow)
      .catch(startBootFlow); // never strand the user with a disabled prompt
  } else {
    startBootFlow();
  }

})();
