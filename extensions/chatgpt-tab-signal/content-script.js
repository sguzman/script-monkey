'use strict';

(() => {
  if (globalThis.__chatgptPromptBoundNotifierInstalled) return;
  globalThis.__chatgptPromptBoundNotifierInstalled = true;

  const RENDER_SETTLE_DELAY_MS = 2500;
  const MAX_REQUEST_EVENTS_PER_MINUTE = 60;
  let eventWindowStartedAt = Date.now();
  let eventWindowCount = 0;
  let eventWindowBlocked = false;
  let activeRequestId = '';
  let suppressedRequestId = '';
  let lastCompletedRequestId = '';
  let completionToken = 0;
  let pendingTimer = null;
  // This file is dynamically injected only after the originating tab
  // starts a matching ChatGPT conversation request. No popup is required.
  // An explicit disable message can still cancel pending work.
  let enabled = true;


  // No persistent MutationObserver: browser head churn must never trigger a
  // feedback cycle. Only explicit state transitions update the favicon.
  // Chromium may retain removed icons, so restore the href on idle.
  let signalState = 'idle';
  let signalIcon = null;
  // Pre-rendered 32px PNGs. Chromium accepts SVG data URLs as declared
  // icons, but can fail to display them visibly in a real browser tab.
  // PNGs use a traditional favicon format without any canvas or polling.
  const ICONS = {
    generating: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAwUlEQVR42u2Xyw2EMAxEyTQHRexWAOVABWwRUB1cAUFIxp/ksL4Bws+xHGumaQpHyP1hnJct9n34dsGkgDcwW0jQBucWAkt4Sg5YwlNywRr+lhMe8FhueMGfGCi9iOB5+jtW8Q4E9vT9pz09T7+VWlJUB67wp3dZMyCBS4qo5xb8C0iN2LQzN4HqwB2IgZ8EiecmPAqVemYgV0xqybS6boFHF64MSHW9VCFDw1xI5Dm0HA7rDaBps5gc9Vsza3NaPHbc9Vs2uEgchgAAAABJRU5ErkJggg==',
    unread: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA5klEQVR42s2X3Q2DMAyEyc0AI7SLtWPBYnSEdgf6FKlCcew4vtC8IPFz39mxgj1NF6/U+sHt8T5qz1/bkigGNLDXSIoGtxoBE27RABNu0QIbrmliBLymjVFwiQEWaF9n03tgRJ/hkolfFtiR7+tczQZG7P39+RGzAPa+l+CUIvTAzQa0irZWvMuAVtHSfUv0qoFSRUfCVQMlIS3dLXDTFkgmvEVXNKA1DRbhVnhmoucwiVho6eEkE97oXQdRhp2vYW05+79wzjR6+/reDhkRw0VPe46oCcc7GyByzPJo/P9oxh5OL19fYWqDL7kN+A4AAAAASUVORK5CYII=',
    finished: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA5klEQVR42s2X3Q2DMAyEyQ1Bd2pXgOnaFehOdAn6FKlCcew4vtC8IPFz39mxgj1NF6/U+sH8vB+155/1nSgGNLDXSIoGtxoBE27RABNu0QIbrmliBLymjVFwiQEWaF8203tgRJ/hkolfFtiR78tWzQZG7P3t9RCzAPa+l+CUIvTAzQa0irZWvMuAVtHSfUv0qoFSRUfCVQMlIS3dLXDTFkgmvEVXNKA1DRbhVnhmoucwiVho6eEkE97oXQdRhp2vYW05+79wzjR6+/reDhkRw0VPe46oCcc7GyByzPJo/P9oxh5OL19fqNuDLyQWmWkAAAAASUVORK5CYII='
  };

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
    const desiredType = showingSignal ? 'image/png' : original.type;

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
    if (!enabled || signalState === nextState) return;
    signalState = nextState;
    reconcileSignalIcon();
    // Separate, browser-managed per-tab icon: no DOM watching and no
    // dependency on whether Chrome renders the page-provided favicon.
    chrome.runtime.sendMessage({
      type: 'CHATGPT_TAB_STATE', state: nextState
    }).catch(() => {});
  }

  function clearUnreadWhenViewed() {
    if (enabled && signalState === 'unread' && pageIsActive()) setTabSignal('finished');
  }
  window.addEventListener('focus', clearUnreadWhenViewed, true);
  document.addEventListener('visibilitychange', clearUnreadWhenViewed, true);
  document.addEventListener('pointerdown', () => {
    clearUnreadWhenViewed();
    if (enabled && signalState === 'preview' && pageIsActive()) setTabSignal('finished');
  }, { capture: true, passive: true });
  document.addEventListener('keydown', () => {
    clearUnreadWhenViewed();
    if (enabled && signalState === 'preview' && pageIsActive()) setTabSignal('finished');
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    if (enabled) reconcileSignalIcon();
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

  // A new conversation can be assigned its /c/<id> URL while the first
  // answer is finishing. This is the SAME document, not a navigation away.
  // Do not drop the first response's completion for that route promotion.
  function sameConversationDocument(originalPath) {
    const currentPath = location.pathname;
    return currentPath === originalPath ||
      (originalPath === '/' && /^\/c\/[^/]+\/?$/.test(currentPath));
  }

  function scheduleCompletion(requestId) {
    if (!enabled) return;
    if (requestId && requestId !== activeRequestId) return;
    if (suppressedRequestId && requestId === suppressedRequestId) return;
    if (requestId && requestId === lastCompletedRequestId) return;
    cancelPendingCompletion();
    const token = ++completionToken;
    const originalPath = location.pathname;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (!enabled || token !== completionToken || !sameConversationDocument(originalPath)) return;
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
    if (!enabled || !isStopButton(event.target)) return;
    // A manual Stop is not a completed response, even if the HTTP request
    // completes successfully just after this click.
    suppressedRequestId = activeRequestId;
    completionToken++;
    cancelPendingCompletion();
    setTabSignal('idle');
  }, true);

  // A network or extension event storm is not permission to rewrite the
  // favicon indefinitely. Each tab can process at most 60 lifecycle events
  // per rolling one-minute window; on overflow it goes idle and fails closed.
  function allowRequestEvent() {
    const now = Date.now();
    if (now - eventWindowStartedAt >= 60000) {
      eventWindowStartedAt = now;
      eventWindowCount = 0;
      eventWindowBlocked = false;
    }
    eventWindowCount++;
    if (eventWindowCount <= MAX_REQUEST_EVENTS_PER_MINUTE) return true;
    if (!eventWindowBlocked) {
      eventWindowBlocked = true;
      completionToken++;
      cancelPendingCompletion();
      setTabSignal('idle');
    }
    return false;
  }

  function disable() {
    // Revoke before touching the page. No further notifications or writes
    // are permitted until a new explicit popup activation.
    enabled = false;
    completionToken++;
    cancelPendingCompletion();
    activeRequestId = '';
    suppressedRequestId = '';
    eventWindowCount = 0;
    eventWindowBlocked = false;
    lastCompletedRequestId = '';
    signalState = 'idle';
    // Removing our own single favicon link is not a head observer or loop.
    if (signalIcon?.isConnected) signalIcon.remove();
    signalIcon = null;
    chrome.runtime.sendMessage({
      type: 'CHATGPT_TAB_STATE', state: 'idle'
    }).catch(() => {});
  }

  function enable() {
    // Repeated START messages must not reset the per-tab storm counter.
    // Reactivate only when a global off previously disabled this document.
    if (enabled) return;
    enabled = true;
    completionToken++;
    cancelPendingCompletion();
    activeRequestId = '';
    suppressedRequestId = '';
    lastCompletedRequestId = '';
    eventWindowStartedAt = Date.now();
    eventWindowCount = 0;
    eventWindowBlocked = false;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'CHATGPT_DISABLE_TAB') {
      disable();
      return;
    }
    if (message?.type === 'CHATGPT_ENABLE_TAB') {
      enable();
      return;
    }
    if (!enabled) return;
    const requestId = String(message?.requestId || '');
    if (message?.type !== 'CHATGPT_PREVIEW_UNREAD' &&
        (message?.type === 'CHATGPT_GENERATION_STARTED' ||
         message?.type === 'CHATGPT_GENERATION_ABORTED' ||
         message?.type === 'CHATGPT_CONVERSATION_REQUEST_COMPLETED') &&
        !allowRequestEvent()) return;
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
