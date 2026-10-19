'use strict';

(() => {
  if (globalThis.__chatgptPromptBoundNotifierInstalled) return;
  globalThis.__chatgptPromptBoundNotifierInstalled = true;

  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const FINAL_TURN_WAIT_MS = 30000;
  const STREAM_SETTLE_MS = 900;
  // Post-network polling only; cap the work even on a stalled/background tab.
  const STREAM_POLL_MS = 3000;
  const GENERATION_HARD_CAP_MS = 180000;
  const MAX_RECENT_TURNS = 96;
  const STOP_BUTTON_SELECTOR =
    'button[data-testid="stop-button"], button[data-testid="fruitjuice-stop-button"]';
  let watchToken = 0;
  let lastSentFingerprint = '';
  let suppressUntilEpoch = 0;
  let activeRequestId = '';
  let lastArmedRequestId = '';
  let cancelWatch = null;


  // No persistent MutationObserver: browser head churn must never trigger a
  // feedback cycle. Only explicit state transitions update the favicon.
  // Chromium may retain removed icons, so restore the href on idle.
  let signalState = 'idle';
  let signalIcon = null;
  const ICONS = {
    generating: makeSignalIcon('#94a3b8', false),
    unread: makeSignalIcon('#2563eb', true),
    finished: makeSignalIcon('#16a34a', true)
  };

  function makeSignalIcon(color, done) {
    const center = done
      ? '<path d="M9 16l4 4 7-8" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<circle cx="16" cy="16" r="5" fill="white"/>';
    const markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="' + color + '"/>' + center + '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(markup);
  }

  // Version 0.1.0 inserted Unicode prefixes into titles. Clean up any
  // leftover prefix from that version; never add a new title indicator.
  function clearLegacyTitlePrefix() {
    const raw = document.title || '';
    const cleaned = raw.replace(/^[●◌]\s+/, '');
    if (raw !== cleaned) document.title = cleaned;
  }

  function siteFavicon() {
    const icons = document.head?.querySelectorAll('link[rel~="icon"]') || [];
    for (let i = icons.length - 1; i >= 0; i -= 1) {
      const icon = icons[i];
      if (icon === signalIcon || icon.dataset?.chatgptTabSignal === 'true') continue;
      const media = icon.getAttribute('media');
      if (media && typeof window.matchMedia === 'function' && !window.matchMedia(media).matches) continue;
      const href = icon.getAttribute('href');
      if (href) return { href, type: icon.getAttribute('type') || '' };
    }
    // Browser favicon lookup convention if ChatGPT supplies no explicit link.
    return { href: '/favicon.ico', type: 'image/x-icon' };
  }

  function reconcileSignalIcon() {
    clearLegacyTitlePrefix();
    const head = document.head;
    if (!head || (signalState === 'idle' && !signalIcon)) return;

    const original = siteFavicon();
    const showingSignal = signalState !== 'idle';
    const unread = signalState === 'unread' || signalState === 'preview';
    const desiredHref = !showingSignal
      ? original.href
      : unread ? ICONS.unread
      : signalState === 'finished' ? ICONS.finished : ICONS.generating;
    const desiredType = showingSignal ? 'image/svg+xml' : original.type;

    if (!signalIcon) {
      signalIcon = document.createElement('link');
      signalIcon.rel = 'icon';
      signalIcon.dataset.chatgptTabSignal = 'true';
    }
    if (signalIcon.getAttribute('href') !== desiredHref) {
      signalIcon.setAttribute('href', desiredHref);
    }
    if (desiredType) {
      if (signalIcon.getAttribute('type') !== desiredType) {
        signalIcon.setAttribute('type', desiredType);
      }
    } else if (signalIcon.hasAttribute('type')) {
      signalIcon.removeAttribute('type');
    }

    // Always keep it last. Unlike removing the icon on idle, updating the
    // href back to ChatGPT's icon forces Chromium to refresh the tab image.
    if (head.lastElementChild !== signalIcon) head.appendChild(signalIcon);
  }

  function setTabSignal(nextState) {
    if (signalState === nextState) return;
    signalState = nextState;
    reconcileSignalIcon();
  }

  function clearUnreadWhenViewed() {
    if (signalState === 'unread' && pageIsActive()) setTabSignal('finished');
  }
  window.addEventListener('focus', clearUnreadWhenViewed, true);
  document.addEventListener('visibilitychange', clearUnreadWhenViewed, true);
  document.addEventListener('pointerdown', () => {
    clearUnreadWhenViewed();
    if (signalState === 'preview' && pageIsActive()) setTabSignal('finished');
  }, { capture: true, passive: true });
  document.addEventListener('keydown', () => {
    clearUnreadWhenViewed();
    if (signalState === 'preview' && pageIsActive()) setTabSignal('finished');
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    clearLegacyTitlePrefix();
    reconcileSignalIcon();
  }, { once: true });

  function pageIsActive() {
    try {
      return document.visibilityState === 'visible' && document.hasFocus();
    } catch {
      return document.visibilityState === 'visible';
    }
  }

  function notifyPageReturned() {
    chrome.runtime.sendMessage({ type: 'CHATGPT_PAGE_RETURNED' }).catch(() => {});
  }

  window.addEventListener('focus', notifyPageReturned, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') notifyPageReturned();
  }, true);
  document.addEventListener('pointerdown', notifyPageReturned, { capture: true, passive: true });
  document.addEventListener('keydown', notifyPageReturned, { capture: true, passive: true });

  function turnNodes() {
    try {
      const standard = document.querySelectorAll('[data-testid^="conversation-turn-"]');
      const nodes = standard.length ? standard
        : document.querySelectorAll('[data-chatgpt-search-unit-key*="fallback-turn-"]');
      // The native selector may inspect more nodes, but JavaScript processes
      // only the recent tail and never allocates an array of the full chat.
      const first = Math.max(0, nodes.length - MAX_RECENT_TURNS);
      const recent = [];
      for (let i = first; i < nodes.length; i += 1) recent.push(nodes[i]);
      return recent;
    } catch {
      return [];
    }
  }

  function roleOf(turn) {
    if (!turn) return '';
    try {
      const key = turn.getAttribute('data-chatgpt-search-unit-key') || '';
      const direct = normalize(
        turn.getAttribute('data-turn') ||
        turn.getAttribute('data-message-author-role') ||
        turn.getAttribute('data-conversation-role') ||
        (key.match(/:(user|assistant)$/) || [])[1] || ''
      ).toLowerCase();
      if (direct === 'user' || direct === 'assistant') return direct;
      if (turn.querySelector('[data-message-author-role="user"], [data-conversation-role="user"]')) return 'user';
      if (turn.querySelector('[data-message-author-role="assistant"], [data-conversation-role="assistant"]')) return 'assistant';
    } catch {}
    return '';
  }

  function assistantText(turn) {
    if (!turn) return '';
    try {
      const roleNode = turn.matches?.('[data-message-author-role="assistant"]')
        ? turn
        : turn.querySelector('[data-message-author-role="assistant"]') || turn;
      const rendered = roleNode.querySelector(
        '[data-markdown-text-style="assistant-message"], .markdown, [class*="prose"], [data-message-content]'
      );
      return normalize(
        rendered
          ? (rendered.textContent || rendered.innerText || '')
          : (roleNode.textContent || roleNode.innerText || '')
      );
    } catch {
      return '';
    }
  }

  function latestPromptSnapshot() {
    const turns = turnNodes();
    let latestUserIndex = -1;
    for (let i = 0; i < turns.length; i += 1) {
      if (roleOf(turns[i]) === 'user') latestUserIndex = i;
    }
    if (latestUserIndex < 0) return null;

    let assistantIndex = -1;
    let response = '';
    for (let i = latestUserIndex + 1; i < turns.length; i += 1) {
      if (roleOf(turns[i]) !== 'assistant') continue;
      const text = assistantText(turns[i]);
      if (!text) continue;
      assistantIndex = i;
      response = text;
    }

    const userTurn = turns[latestUserIndex];
    const promptKey = [
      location.pathname,
      userTurn?.getAttribute('data-testid') ||
      userTurn?.getAttribute('data-chatgpt-search-unit-key') ||
      `user-${latestUserIndex}`
    ].join('|');

    if (!response || assistantIndex < 0) {
      return { promptKey, assistantKey: '', response: '' };
    }

    const assistantTurn = turns[assistantIndex];
    return {
      promptKey,
      assistantKey:
        assistantTurn?.getAttribute('data-testid') ||
        assistantTurn?.getAttribute('data-chatgpt-search-unit-key') ||
        `assistant-${assistantIndex}`,
      response
    };
  }

  function answerBoundToLatestPrompt() {
    return latestPromptSnapshot()?.response || '';
  }

  function isElementVisible(node) {
    if (!node) return false;
    try {
      // A stop button kept mounted but display:none must not count as
      // "generating", otherwise completion would never be detected.
      return typeof node.getClientRects !== 'function' || node.getClientRects().length > 0;
    } catch {
      return true;
    }
  }

  function isGenerating() {
    try {
      const stopButtons = document.querySelectorAll(STOP_BUTTON_SELECTOR);
      for (const button of stopButtons) {
        if (isElementVisible(button)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // A single bounded timer replaces the previous full-conversation
  // MutationObserver + two polling timers. No permanent DOM observation:
  // this work runs only after the conversation network request completes.
  function waitForAnswerBoundToLatestPrompt() {
    return new Promise((resolve) => {
      let settled = false;
      let pollId = null;
      let stableText = '';
      let stableSince = 0;
      let generationEndedAt = 0;
      const startedAt = Date.now();
      const originalPath = location.pathname;

      const finish = (text) => {
        if (settled) return;
        settled = true;
        if (pollId !== null) clearInterval(pollId);
        if (cancelWatch === cancelThisWatch) cancelWatch = null;
        resolve(text);
      };
      const cancelThisWatch = () => finish(null);
      cancelWatch = cancelThisWatch;

      const check = () => {
        if (settled) return;
        const now = Date.now();
        if (location.pathname !== originalPath ||
            now - startedAt >= GENERATION_HARD_CAP_MS) {
          finish(null);
          return;
        }

        if (isGenerating()) {
          stableText = '';
          stableSince = 0;
          generationEndedAt = 0;
          return;
        }

        if (!generationEndedAt) generationEndedAt = now;
        const text = answerBoundToLatestPrompt();
        if (!text) {
          if (now - generationEndedAt >= FINAL_TURN_WAIT_MS) finish(null);
          return;
        }
        if (text !== stableText) {
          stableText = text;
          stableSince = now;
          return;
        }
        if (now - stableSince >= STREAM_SETTLE_MS) finish(text);
      };

      pollId = setInterval(check, STREAM_POLL_MS);
      check();
    });
  }

  function sendCompletion(snapshot) {
    const fingerprint = `${activeRequestId}|${snapshot.promptKey}|${snapshot.assistantKey}|${snapshot.response.slice(0, 1000)}`;
    if (fingerprint === lastSentFingerprint) return;

    lastSentFingerprint = fingerprint;
    setTabSignal(pageIsActive() ? 'finished' : 'unread');
    chrome.runtime.sendMessage({
      type: 'CHATGPT_RESPONSE_COMPLETE',
      sessionTitle: document.title,
      // Only the notification preview leaves the page context. Never send
      // an entire long answer (or private conversation history) over MV3 IPC.
      response: snapshot.response.slice(0, 260),
      fingerprint,
      completionKey: snapshot.assistantKey
        ? `${snapshot.promptKey}|${snapshot.assistantKey}`
        : '',
      requestId: activeRequestId,
      dismissOnReturn: false
    }).catch(() => {});
  }

  function armForCurrentPrompt(requestId) {
    if (Date.now() < suppressUntilEpoch) return;
    if (requestId && lastArmedRequestId === requestId) return;
    if (requestId) lastArmedRequestId = requestId;
    if (cancelWatch) cancelWatch();
    const token = ++watchToken;
    const expectedPath = location.pathname;
    waitForAnswerBoundToLatestPrompt()
      .then((text) => {
        if (token !== watchToken || !text || location.pathname !== expectedPath) return;
        const resolved = latestPromptSnapshot();
        if (resolved?.response) {
          sendCompletion(resolved);
        } else {
          sendCompletion({
            promptKey: '',
            assistantKey: '',
            response: text
          });
        }
      });
  }

  function isStopButton(node) {
    if (!(node instanceof Element)) return false;
    return Boolean(node.closest('button[data-testid="stop-button"], button[data-testid="fruitjuice-stop-button"]'));
  }

  document.addEventListener('click', (event) => {
    if (!isStopButton(event.target)) return;
    // A manual stop is not a successful completion. The next conversation
    // request will arm the watcher again.
    watchToken += 1;
    if (cancelWatch) cancelWatch();
    setTabSignal('idle');
    suppressUntilEpoch = Date.now() + 1500;
  }, true);

  chrome.runtime.onMessage.addListener((message) => {
    const requestId = String(message?.requestId || '');
    if (message?.type === 'CHATGPT_GENERATION_STARTED') {
      if (requestId && activeRequestId === requestId) return;
      activeRequestId = requestId;
      lastArmedRequestId = '';
      suppressUntilEpoch = 0;
      watchToken += 1;
      if (cancelWatch) cancelWatch();
      setTabSignal('generating');
    } else if (message?.type === 'CHATGPT_GENERATION_ABORTED') {
      if (requestId && activeRequestId && requestId !== activeRequestId) return;
      watchToken += 1;
      if (cancelWatch) cancelWatch();
      if (signalState === 'generating') setTabSignal('idle');
    } else if (message?.type === 'CHATGPT_PREVIEW_UNREAD') {
      setTabSignal('preview');
    } else if (message?.type === 'CHATGPT_CONVERSATION_REQUEST_COMPLETED') {
      if (requestId && activeRequestId && requestId !== activeRequestId) return;
      if (requestId) activeRequestId = requestId;
      armForCurrentPrompt(requestId);
    }
  });
})();
