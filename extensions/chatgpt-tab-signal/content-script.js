'use strict';

(() => {
  if (globalThis.__chatgptPromptBoundNotifierInstalled) return;
  globalThis.__chatgptPromptBoundNotifierInstalled = true;

  const RENDER_SETTLE_DELAY_MS = 2500;
  let activeRequestId = '';
  let suppressedRequestId = '';
  let lastCompletedRequestId = '';
  let completionToken = 0;
  let pendingTimer = null;


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
    reconcileSignalIcon();
  }, { once: true });

  function pageIsActive() {
    try {
      return document.visibilityState === 'visible' && document.hasFocus();
    } catch {
      return document.visibilityState === 'visible';
    }
  }

  // The only completion authority is Chromium's successful conversation POST.
  // No transcript selector, no stop-button query, no MutationObserver, no poll.
  // A single cancellable timeout gives React time to paint the final state.
  function cancelPendingCompletion() {
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function scheduleCompletion(requestId) {
    if (requestId && requestId !== activeRequestId) return;
    if (suppressedRequestId && requestId === suppressedRequestId) return;
    if (requestId && requestId === lastCompletedRequestId) return;
    cancelPendingCompletion();
    const token = ++completionToken;
    const originalPath = location.pathname;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (token !== completionToken || location.pathname !== originalPath) return;
      if (requestId !== activeRequestId || requestId === suppressedRequestId) return;
      if (requestId && requestId === lastCompletedRequestId) return;
      lastCompletedRequestId = requestId;
      setTabSignal(pageIsActive() ? 'finished' : 'unread');
      chrome.runtime.sendMessage({
        type: 'CHATGPT_RESPONSE_COMPLETE',
        requestId,
        completionKey: requestId,
        fingerprint: requestId,
        sessionTitle: document.title,
        response: 'Response finished.'
      }).catch(() => {});
    }, RENDER_SETTLE_DELAY_MS);
  }

  function isStopButton(node) {
    if (!(node instanceof Element)) return false;
    return Boolean(node.closest('button[data-testid="stop-button"], button[data-testid="fruitjuice-stop-button"]'));
  }

  document.addEventListener('click', (event) => {
    if (!isStopButton(event.target)) return;
    // A manual Stop is not a completed response, even if the HTTP request
    // completes successfully just after this click.
    suppressedRequestId = activeRequestId;
    completionToken++;
    cancelPendingCompletion();
    setTabSignal('idle');
  }, true);

  chrome.runtime.onMessage.addListener((message) => {
    const requestId = String(message?.requestId || '');
    if (message?.type === 'CHATGPT_GENERATION_STARTED') {
      if (requestId && activeRequestId === requestId) return;
      completionToken++;
      cancelPendingCompletion();
      activeRequestId = requestId;
      suppressedRequestId = '';
      setTabSignal('generating');
    } else if (message?.type === 'CHATGPT_GENERATION_ABORTED') {
      if (requestId && activeRequestId && requestId !== activeRequestId) return;
      completionToken++;
      cancelPendingCompletion();
      if (signalState === 'generating') setTabSignal('idle');
    } else if (message?.type === 'CHATGPT_PREVIEW_UNREAD') {
      setTabSignal('preview');
    } else if (message?.type === 'CHATGPT_CONVERSATION_REQUEST_COMPLETED') {
      if (requestId && activeRequestId && requestId !== activeRequestId) return;
      if (requestId) activeRequestId = requestId;
      scheduleCompletion(requestId);
    }
  });
})();
