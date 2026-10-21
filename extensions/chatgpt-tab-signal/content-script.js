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
  let errorVisibleBeforeRequest = null;
  // A failed secondary POST must not replace an already completed answer.
  let lastPromptIntentAt = 0;
  let activeRequestHadPromptIntent = false;
  let successfulStateBeforeRequest = null;
  let completionToken = 0;
  let pendingTimer = null;
  // This file is dynamically injected only after the originating tab
  // starts a matching ChatGPT conversation request. No popup is required.
  // A disable message can still cancel pending work.
  let enabled = true;


  // The lightweight chat decorator alone owns the favicon and title.
  // Status changes are forwarded into the same isolated extension world.
  // The response watcher never writes a favicon or a title itself.
  let signalState = 'idle';
  let pendingErrorCheck = null;
  function setTabSignal(nextState) {
    if (!enabled || signalState === nextState) return;
    signalState = nextState;
    globalThis.__chatgptTabSignalSetStatus?.(nextState);
  }
  function visibleError() {
    return globalThis.__chatgptTabSignalDetectError?.() || null;
  }
  function cancelPendingErrorCheck() {
    if (pendingErrorCheck !== null) clearTimeout(pendingErrorCheck);
    pendingErrorCheck = null;
  }
  function scheduleErrorCheck(requestId) {
    cancelPendingErrorCheck();
    const token = completionToken;
    pendingErrorCheck = setTimeout(() => {
      pendingErrorCheck = null;
      if (!enabled || token !== completionToken ||
          (requestId && requestId !== activeRequestId) ||
          requestId === suppressedRequestId ||
          (requestId && requestId === lastCompletedRequestId)) return;
      const error = visibleError();
      if (error) setTabSignal(error);
    }, 1600);
  }

  function clearUnreadWhenViewed() {
    if (enabled && signalState === 'unread' && pageIsActive()) setTabSignal('finished');
  }
  window.addEventListener('focus', clearUnreadWhenViewed, true);
  document.addEventListener('visibilitychange', clearUnreadWhenViewed, true);
  document.addEventListener('pointerdown', () => {
    clearUnreadWhenViewed();
    if (enabled && signalState === 'unread' && pageIsActive()) setTabSignal('finished');
  }, { capture: true, passive: true });
  document.addEventListener('keydown', () => {
    clearUnreadWhenViewed();
    if (enabled && signalState === 'unread' && pageIsActive()) setTabSignal('finished');
  }, true);

  // One-time user intent, rather than every POST, distinguishes a new
  // prompt from incidental conversation endpoint activity. No observers,
  // transcript scanning, or polling.
  function notePromptIntent() { lastPromptIntentAt = Date.now(); }
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest([
      'button[data-testid="send-button"]',
      'button[data-testid="regenerate-response-button"]',
      'button[data-testid="retry-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]'
    ].join(','))) notePromptIntent();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing ||
        !(event.target instanceof Element)) return;
    if (event.target.closest('#prompt-textarea, [data-testid="prompt-textarea"]')) {
      notePromptIntent();
    }
  }, true);

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
      // A stale banner from an earlier request must never suppress a
      // successful completion, sound or desktop notification. Only a
      // newly observed recognized error can override 2xx completion.
      const error = visibleError();
      if (error && error !== errorVisibleBeforeRequest) {
        setTabSignal(error);
        chrome.runtime.sendMessage({type:'CHATGPT_RESPONSE_REJECTED',requestId})
          .catch(() => {});
        return;
      }
      lastCompletedRequestId = requestId;
      setTabSignal(pageIsActive() ? 'finished' : 'unread');
      chrome.runtime.sendMessage({
        type: 'CHATGPT_RESPONSE_COMPLETE',
        requestId,
        completionKey: requestId,
        fingerprint: requestId,
        sessionTitle: document.title,
        // The same PNG is used in the tab and the native desktop alert.
        // This carries no URL, conversation ID, or answer text.
        notificationIcon: globalThis.__chatgptTabSignalGetIcon?.() || null,
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
    if (activeRequestId) chrome.runtime.sendMessage({
      type:'CHATGPT_REQUEST_CANCELED',requestId:activeRequestId
    }).catch(() => {});
    completionToken++;
    cancelPendingCompletion();
    cancelPendingErrorCheck();
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
      cancelPendingErrorCheck();
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
    cancelPendingErrorCheck();
    activeRequestId = '';
    suppressedRequestId = '';
    eventWindowCount = 0;
    eventWindowBlocked = false;
    lastCompletedRequestId = '';
    errorVisibleBeforeRequest = null;
    lastPromptIntentAt = 0;
    activeRequestHadPromptIntent = false;
    successfulStateBeforeRequest = null;
    signalState = 'idle';
    globalThis.__chatgptTabSignalSetStatus?.('idle');
  }

  function enable() {
    // Repeated START messages must not reset the per-tab storm counter.
    // Reactivate only when a global off previously disabled this document.
    if (enabled) return;
    enabled = true;
    completionToken++;
    cancelPendingCompletion();
    cancelPendingErrorCheck();
    activeRequestId = '';
    suppressedRequestId = '';
    lastCompletedRequestId = '';
    errorVisibleBeforeRequest = null;
    lastPromptIntentAt = 0;
    activeRequestHadPromptIntent = false;
    successfulStateBeforeRequest = null;
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
         message?.type === 'CHATGPT_CONVERSATION_REQUEST_FAILED' ||
         message?.type === 'CHATGPT_CONVERSATION_REQUEST_COMPLETED') &&
        !allowRequestEvent()) return;
    if (message?.type === 'CHATGPT_GENERATION_STARTED') {
      if (requestId && activeRequestId === requestId) return;
      completionToken++;
      cancelPendingCompletion();
      cancelPendingErrorCheck();
      activeRequestId = requestId;
      suppressedRequestId = '';
      const now = Date.now();
      activeRequestHadPromptIntent =
        lastPromptIntentAt > 0 && now - lastPromptIntentAt <= 10000;
      lastPromptIntentAt = 0; // Consume a gesture for only one POST.
      successfulStateBeforeRequest = signalState === 'finished' ||
        signalState === 'unread' ? signalState : null;
      errorVisibleBeforeRequest = visibleError();
      setTabSignal('generating');
    } else if (message?.type === 'CHATGPT_GENERATION_ABORTED' ||
               message?.type === 'CHATGPT_CONVERSATION_REQUEST_FAILED') {
      if (requestId && activeRequestId && requestId !== activeRequestId) return;
      // The same request can send a late transport event after the page has
      // already confirmed and announced the answer. Success is terminal.
      if (requestId && requestId === lastCompletedRequestId) return;
      completionToken++;
      cancelPendingCompletion();
      if (requestId && requestId === suppressedRequestId) {
        setTabSignal('idle'); // Manual Stop is not a network failure.
        return;
      }
      if (message.type === 'CHATGPT_GENERATION_ABORTED') {
        // A browser/client abort is not proof of a network error.
        setTabSignal(successfulStateBeforeRequest &&
          !activeRequestHadPromptIntent ? successfulStateBeforeRequest : 'idle');
        return;
      }
      const foundError = visibleError();
      // A secondary backend POST may fail after a successful answer.
      // Without visible error UI or a new user send, the conversation
      // itself has not been shown to fail.
      setTabSignal(foundError || (successfulStateBeforeRequest &&
        !activeRequestHadPromptIntent ? successfulStateBeforeRequest : 'error'));
      scheduleErrorCheck(requestId);
    } else if (message?.type === 'CHATGPT_PREVIEW_UNREAD') {
      if (requestId && requestId !== activeRequestId) return;
      if (requestId === suppressedRequestId) return;
      // A terminal success must never be downgraded by a late worker hint.
      if (requestId && requestId === lastCompletedRequestId) return;
      const error=visibleError();
      if (error && error !== errorVisibleBeforeRequest) {
        setTabSignal(error);
        chrome.runtime.sendMessage({type:'CHATGPT_RESPONSE_REJECTED',requestId})
          .catch(() => {});
      } else {
        setTabSignal(pageIsActive()?'finished':'unread');
      }
    } else if (message?.type === 'CHATGPT_CONVERSATION_REQUEST_COMPLETED') {
      if (requestId && activeRequestId && requestId !== activeRequestId) return;
      if (requestId) activeRequestId = requestId;
      scheduleCompletion(requestId);
    }
  });
})();
