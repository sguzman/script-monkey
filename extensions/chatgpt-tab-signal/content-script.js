'use strict';

(() => {
  const BUILD = '0.1.27';
  const previousOwner = globalThis.__chatgptPromptBoundNotifierOwner;
  if (previousOwner?.build === BUILD) return;
  previousOwner?.dispose?.();
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
  // A completed conversation can make auxiliary POSTs without a user send.
  // Keep their network IDs separate and never promote them to a generation.
  const ignoredRequestIds = new Set();
  let completionToken = 0;
  let pendingTimer = null;
  let completionObserver = null;
  let completionBaseline = 0;
  // UI evidence is required; completed network transport alone is not.
  const COPY_ACTION = 'button[data-testid="copy-turn-action-button"]';
  const STOP_ACTION = 'button[data-testid="stop-button"], button[aria-label="Stop generating"]';
  function completedResponseVisible() {
    const actions = document.querySelectorAll(COPY_ACTION);
    const stop = document.querySelector(STOP_ACTION);
    return actions.length > completionBaseline &&
      !(stop && stop.getClientRects?.().length);
  }
  function stopCompletionWatch() {
    completionObserver?.disconnect();
    completionObserver = null;
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  // This file is dynamically injected only after the originating tab
  // starts a matching ChatGPT conversation request. No popup is required.
  // A disable message can still cancel pending work.
  let enabled = true;


  // The lightweight chat decorator alone owns the favicon and title.
  // Status changes are forwarded into the same isolated extension world.
  // The response watcher never writes a favicon or a title itself.
  const published = document.documentElement?.dataset?.chatgptTabSignalState;
  let signalState = ['idle','generating','unread','finished','interrupted',
    'error','limit','response_load_failed','conversation_load_failed'].includes(published)
    ? published : 'idle';
  const listeners = [];
  function register(target, event, listener, options) {
    target.addEventListener(event, listener, options);
    listeners.push([target,event,listener,options]);
  }
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
      // An old error banner is not evidence of a new failure.
      const error = visibleError();
      if (error && (error === 'limit' ||
          error !== errorVisibleBeforeRequest ||
          activeRequestHadPromptIntent)) setTabSignal(error);
    }, 1600);
  }

  function clearUnreadWhenViewed() {
    if (enabled && signalState === 'unread' && pageIsActive()) setTabSignal('finished');
  }
  register(window, 'focus', clearUnreadWhenViewed, true);
  register(document, 'visibilitychange', clearUnreadWhenViewed, true);
  register(document, 'pointerdown', () => {
    clearUnreadWhenViewed();
    if (enabled && signalState === 'unread' && pageIsActive()) setTabSignal('finished');
  }, { capture: true, passive: true });
  register(document, 'keydown', () => {
    clearUnreadWhenViewed();
    if (enabled && signalState === 'unread' && pageIsActive()) setTabSignal('finished');
  }, true);

  // One-time user intent, rather than every POST, distinguishes a new
  // prompt from incidental conversation endpoint activity. No observers,
  // transcript scanning, or polling.
  function notePromptIntent() { lastPromptIntentAt = Date.now(); }
  register(document, 'click', event => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest([
      'button[data-testid="send-button"]',
      'button[data-testid="regenerate-response-button"]',
      'button[data-testid="retry-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]'
    ].join(','))) notePromptIntent();
  }, true);
  register(document, 'keydown', event => {
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

  // A 2xx POST cannot prove thinking, tool execution or rendering finished.
  // Only a new completed assistant-response action can do that. The observer
  // is request-scoped: it is never running on idle tabs.
  function cancelPendingCompletion() {
    stopCompletionWatch();
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
    if (!enabled || (requestId && requestId !== activeRequestId) ||
        requestId === suppressedRequestId ||
        (requestId && requestId === lastCompletedRequestId)) return;
    cancelPendingCompletion();
    const token = ++completionToken;
    const originalPath = location.pathname;
    const eligible = () => enabled && token === completionToken &&
      sameConversationDocument(originalPath) &&
      requestId === activeRequestId &&
      requestId !== suppressedRequestId &&
      requestId !== lastCompletedRequestId;
    function verify() {
      pendingTimer = null;
      if (!eligible() || !completedResponseVisible()) return;
      const error = visibleError();
      if (error && error !== errorVisibleBeforeRequest) {
        cancelPendingCompletion();
        setTabSignal(error);
        chrome.runtime.sendMessage({type:'CHATGPT_RESPONSE_REJECTED',requestId})
          .catch(() => {});
        return;
      }
      cancelPendingCompletion();
      lastCompletedRequestId = requestId;
      setTabSignal(pageIsActive() ? 'finished' : 'unread');
      chrome.runtime.sendMessage({
        type:'CHATGPT_RESPONSE_COMPLETE', requestId,
        completionKey:requestId, fingerprint:requestId,
        sessionTitle:document.title,
        notificationIcon:globalThis.__chatgptTabSignalGetIcon?.() || null,
        response:'Response finished.'
      }).catch(() => {});
    }
    function consider() {
      if (!eligible() || pendingTimer !== null ||
          !completedResponseVisible()) return;
      pendingTimer = setTimeout(verify, RENDER_SETTLE_DELAY_MS);
    }
    consider();
    if (pendingTimer !== null) return;
    const container = document.querySelector('main');
    if (!container || typeof MutationObserver !== 'function') return;
    // Observe only while waiting for completion of an active request.
    completionObserver = new MutationObserver(consider);
    completionObserver.observe(container,{childList:true,subtree:true});
    consider();
  }

  function isStopButton(node) {
    if (!(node instanceof Element)) return false;
    return Boolean(node.closest('button[data-testid="stop-button"], button[data-testid="fruitjuice-stop-button"]'));
  }

  register(document, 'click', (event) => {
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
    ignoredRequestIds.clear();
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
    ignoredRequestIds.clear();
    eventWindowStartedAt = Date.now();
    eventWindowCount = 0;
    eventWindowBlocked = false;
  }

  const onMessage = (message) => {
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
    if (requestId && ignoredRequestIds.has(requestId) &&
        message?.type !== 'CHATGPT_GENERATION_STARTED') return;
    if (message?.type !== 'CHATGPT_PREVIEW_UNREAD' &&
        (message?.type === 'CHATGPT_GENERATION_STARTED' ||
         message?.type === 'CHATGPT_GENERATION_ABORTED' ||
         message?.type === 'CHATGPT_CONVERSATION_REQUEST_FAILED' ||
         message?.type === 'CHATGPT_CONVERSATION_REQUEST_COMPLETED') &&
        !allowRequestEvent()) return;
    if (message?.type === 'CHATGPT_GENERATION_STARTED') {
      if (requestId && (activeRequestId === requestId ||
          ignoredRequestIds.has(requestId))) return;
      const now = Date.now();
      // Network lifecycle messages may arrive after later user input.
      // Bind the gesture to when the request ACTUALLY started, not when a
      // delayed extension message happened to reach this page.
      const startedAt = Number(message.startedAt) || now;
      const userSubmitted = lastPromptIntentAt > 0 &&
        startedAt >= lastPromptIntentAt - 250 &&
        startedAt - lastPromptIntentAt <= 10000;
      if (userSubmitted) lastPromptIntentAt = 0;
      // Critical: the conversation endpoint is used for more than user
      // generations. A completed response is terminal until the user sends
      // or explicitly retries. Neither a tab focus nor an incidental POST
      // can ever demote its check/bell to an hourglass.
      if (!userSubmitted && ['finished','unread','limit'].includes(signalState)) {
        if (requestId) {
          ignoredRequestIds.add(requestId);
          if (ignoredRequestIds.size > MAX_REQUEST_EVENTS_PER_MINUTE)
            ignoredRequestIds.delete(ignoredRequestIds.values().next().value);
          chrome.runtime.sendMessage({
            type:'CHATGPT_REQUEST_IGNORED',requestId
          }).catch(() => {});
        }
        return;
      }
      completionToken++;
      cancelPendingCompletion();
      cancelPendingErrorCheck();
      activeRequestId = requestId;
      suppressedRequestId = '';
      activeRequestHadPromptIntent = userSubmitted;
      successfulStateBeforeRequest = signalState === 'finished' ||
        signalState === 'unread' ? signalState : null;
      completionBaseline = document.querySelectorAll(COPY_ACTION).length;
      if (document.documentElement?.dataset)
        document.documentElement.dataset.chatgptTabSignalCopyBaseline =
          String(completionBaseline);
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
      // A failed HTTP request, even after Send, isn't proof of a failed
      // conversation. ChatGPT can retry or complete another request.
      if (foundError && (foundError === 'limit' ||
          foundError !== errorVisibleBeforeRequest ||
          activeRequestHadPromptIntent)) {
        setTabSignal(foundError);
      } else {
        setTabSignal(successfulStateBeforeRequest &&
          !activeRequestHadPromptIntent ? successfulStateBeforeRequest : 'idle');
      }
      scheduleErrorCheck(requestId);
    } else if (message?.type === 'CHATGPT_PREVIEW_UNREAD') {
      if (requestId && requestId !== activeRequestId) return;
      if (requestId === suppressedRequestId) return;
      // A terminal success must never be downgraded by a late worker hint.
      if (requestId && requestId === lastCompletedRequestId) return;
      if (!completedResponseVisible()) return;
      const error=visibleError();
      if (error && error !== errorVisibleBeforeRequest) {
        cancelPendingCompletion();
        setTabSignal(error);
        chrome.runtime.sendMessage({type:'CHATGPT_RESPONSE_REJECTED',requestId})
          .catch(() => {});
      } else {
        cancelPendingCompletion();
        lastCompletedRequestId = requestId;
        setTabSignal(pageIsActive()?'finished':'unread');
      }
    } else if (message?.type === 'CHATGPT_CONVERSATION_REQUEST_COMPLETED') {
      if (requestId && activeRequestId && requestId !== activeRequestId) return;
      if (requestId) activeRequestId = requestId;
      scheduleCompletion(requestId);
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.__chatgptPromptBoundNotifierOwner = {
    build: BUILD,
    dispose() {
      enabled = false;
      completionToken++;
      cancelPendingCompletion();
      cancelPendingErrorCheck();
      for (const [target, event, listener, options] of listeners) {
        target.removeEventListener?.(event, listener, options);
      }
      listeners.length = 0;
      chrome.runtime.onMessage.removeListener?.(onMessage);
    }
  };
})();
