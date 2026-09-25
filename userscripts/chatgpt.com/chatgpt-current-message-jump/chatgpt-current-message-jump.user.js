// ==UserScript==
// @name         ChatGPT Current Message Jump
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.7.0
// @description  Show a safe-gutter arrow that jumps to the start of the current ChatGPT exchange without covering content or controls.
// @author       Salvador Guzman
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    buttonSize: 40,
    rightInset: 6,
    fallbackGutterGap: 6,
    fallbackViewportInset: 6,
    revealAfterPx: 80,
    minimumExtraHeightPx: 24,
    composerGap: 18,
    scrollMarginTop: 12,
    contentCollisionPadding: 4,
    verticalFractions: [0.42, 0.56, 0.70, 0.30],
    virtualizationAttempts: 8,
    virtualizationProbePx: 220,
    debug: false,
  };

  const STANDARD_TURN_SELECTOR = '[data-testid^="conversation-turn-"]';
  const SHELL_TURN_SELECTOR = '[data-app-shell-main-surface] [data-thread-find-target="conversation"] [data-turn-key]';
  const TURN_SELECTOR = `${STANDARD_TURN_SELECTOR}, ${SHELL_TURN_SELECTOR}`;
  const ASSISTANT_SELECTOR = [
    '[data-message-author-role="assistant"]',
    '[data-turn="assistant"]',
    '.agent-turn',
    '[data-content-search-unit-key$=":assistant"]',
    '[data-chatgpt-agent-turn-start]',
  ].join(',');
  const USER_SELECTOR = [
    '[data-message-author-role="user"]',
    '[data-turn="user"]',
    '.user-turn',
    '[data-content-search-unit-key$=":user"]',
  ].join(',');
  const CONTENT_SELECTOR = [
    '[data-testid="writing-block-container"]',
    'pre', 'table', 'blockquote', 'figure', 'p',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol',
  ].join(',');
  const PROMPT_INPUT_SELECTOR = [
    '#prompt-textarea',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Message"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
  ].join(',');
  const IMPORTANT_CONTROL_SELECTOR = [
    '.sm-sticky-copy-button',
    'button', 'a[href]', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="dialog"]', 'dialog',
  ].join(',');

  let activeTurn = null;
  let frame = 0;

  const log = (...args) => {
    if (CONFIG.debug) console.debug('[chatgpt-current-message-jump]', ...args);
  };

  function visible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
  }

  function conversationTurns() {
    const turns = Array.from(document.querySelectorAll(TURN_SELECTOR)).filter(
      (element) => element instanceof HTMLElement,
    );

    // Some ChatGPT renderers nest the newer shell turn inside a legacy
    // conversation-turn wrapper. Prefer the outer native turn in that case so
    // one logical row is not counted twice.
    return turns.filter((turn) => {
      if (!turn.matches(SHELL_TURN_SELECTOR)) return true;
      const outer = turn.closest(STANDARD_TURN_SELECTOR);
      return !(outer instanceof HTMLElement && outer !== turn);
    });
  }

  function turnRole(turn) {
    if (!(turn instanceof HTMLElement)) return null;

    const direct = turn.getAttribute('data-turn');
    if (direct === 'assistant' || direct === 'user') return direct;

    const hasAssistant = turn.matches(ASSISTANT_SELECTOR) || Boolean(turn.querySelector(ASSISTANT_SELECTOR));
    const hasUser = turn.matches(USER_SELECTOR) || Boolean(turn.querySelector(USER_SELECTOR));

    if (hasAssistant && !hasUser) return 'assistant';
    if (hasUser && !hasAssistant) return 'user';
    if (hasAssistant && hasUser) return 'mixed';
    return null;
  }

  function rawTurnKey(turn) {
    if (!(turn instanceof HTMLElement)) return null;
    return turn.getAttribute('data-turn-id')
      || turn.getAttribute('data-turn-key')
      || turn.getAttribute('data-testid')
      || null;
  }

  function logicalTurnMembers(turn) {
    const wrapper = wrapperFor(turn);
    if (!(wrapper instanceof HTMLElement)) return [];
    const key = rawTurnKey(wrapper);
    const role = turnRole(wrapper);

    if (!key) return [wrapper];

    return conversationTurns().filter((candidate) => (
      rawTurnKey(candidate) === key
      && turnRole(candidate) === role
    ));
  }

  function logicalRect(turn) {
    const members = logicalTurnMembers(turn);
    if (!members.length) return turn.getBoundingClientRect();

    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;

    for (const member of members) {
      const rect = member.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }

    if (!Number.isFinite(top)) return turn.getBoundingClientRect();
    return {
      left,
      right,
      top,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function assistantRoots() {
    const roots = [];
    const seen = new Set();
    for (const assistant of document.querySelectorAll(ASSISTANT_SELECTOR)) {
      if (!(assistant instanceof HTMLElement)) continue;
      const turn = assistant.closest(TURN_SELECTOR) || assistant;
      if (!(turn instanceof HTMLElement) || seen.has(turn)) continue;
      seen.add(turn);
      roots.push(turn);
    }
    return roots;
  }

  function assistantBody(turn) {
    if (!(turn instanceof HTMLElement)) return null;
    const nested = turn.querySelector(
      '[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"], .agent-turn',
    );
    if (nested instanceof HTMLElement) return nested;
    return turn.matches(ASSISTANT_SELECTOR) ? turn : null;
  }

  function wrapperFor(turn) {
    if (!(turn instanceof HTMLElement)) return null;
    return turn.matches(TURN_SELECTOR) ? turn : turn.closest(TURN_SELECTOR);
  }

  function turnKey(turn) {
    return rawTurnKey(wrapperFor(turn));
  }

  function resolveTurn(key, fallback = null) {
    if (key) {
      for (const turn of conversationTurns()) {
        if (rawTurnKey(turn) === key) return turn;
      }
    }
    return fallback instanceof HTMLElement && fallback.isConnected ? fallback : null;
  }

  function userTargetInside(turn) {
    if (!(turn instanceof HTMLElement)) return null;
    if (turnRole(turn) === 'user') return turn;

    const target = turn.querySelector(
      '[data-content-search-unit-key$=":user"], [data-message-author-role="user"]',
    );
    return target instanceof HTMLElement ? target : null;
  }

  function previousConversationTurn(turn) {
    const wrapper = wrapperFor(turn);
    if (!(wrapper instanceof HTMLElement)) return null;

    // Newer shell renderers can hold both halves of an exchange inside one
    // native turn. In that shape the user's prompt is already inside the same
    // shell, so use it directly.
    const localUser = userTargetInside(wrapper);
    if (localUser && turnRole(wrapper) === 'mixed') return localUser;

    const turns = conversationTurns();
    const members = logicalTurnMembers(wrapper);
    const first = members.length ? members[0] : wrapper;
    let index = turns.indexOf(first);
    if (index < 0) index = turns.indexOf(wrapper);

    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = turns[i];
      if (rawTurnKey(candidate) === rawTurnKey(wrapper) && turnRole(candidate) === turnRole(wrapper)) {
        continue;
      }
      const role = turnRole(candidate);
      if (role === 'user') return candidate;
      if (role === 'mixed') {
        const nestedUser = userTargetInside(candidate);
        if (nestedUser) return nestedUser;
      }
    }

    return null;
  }

  function usableTurn(turn) {
    if (!(turn instanceof HTMLElement) || !turn.isConnected) return false;
    const rect = turn.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function composerTop() {
    let top = innerHeight;
    for (const input of document.querySelectorAll(PROMPT_INPUT_SELECTOR)) {
      if (!(input instanceof HTMLElement) || !visible(input)) continue;
      if (input.closest(TURN_SELECTOR)) continue;
      const rect = input.getBoundingClientRect();
      if (rect.top < innerHeight * 0.45 || rect.bottom <= 0) continue;
      top = Math.min(top, rect.top - CONFIG.composerGap);
    }
    return Math.max(CONFIG.buttonSize * 2, Math.min(innerHeight, top));
  }

  function visibleHeight(rect, top, bottom) {
    return Math.max(0, Math.min(rect.bottom, bottom) - Math.max(rect.top, top));
  }

  function chooseActiveTurn(viewTop, viewBottom) {
    const centerY = viewTop + (viewBottom - viewTop) / 2;
    let centerTurn = null;
    let centerSpan = Infinity;
    let largest = null;
    let largestVisible = 0;

    for (const turn of assistantRoots()) {
      const rect = logicalRect(turn);
      const seen = visibleHeight(rect, viewTop, viewBottom);
      if (seen <= 0) continue;
      if (rect.top <= centerY && rect.bottom >= centerY && rect.height < centerSpan) {
        centerTurn = turn;
        centerSpan = rect.height;
      }
      if (seen > largestVisible) {
        largest = turn;
        largestVisible = seen;
      }
    }
    return centerTurn || largest;
  }

  function contentBounds(turn, viewTop, viewBottom) {
    const body = assistantBody(turn) || turn;
    const bodyRect = body.getBoundingClientRect();
    let left = Infinity;
    let right = -Infinity;

    for (const piece of body.querySelectorAll(CONTENT_SELECTOR)) {
      if (!(piece instanceof HTMLElement)) continue;
      const rect = piece.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 4) continue;
      if (rect.bottom <= viewTop || rect.top >= viewBottom) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }

    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
      left = bodyRect.left;
      right = bodyRect.right;
    }
    return { left: Math.max(0, left), right: Math.min(innerWidth, right) };
  }

  function isImportantHit(element) {
    if (!(element instanceof Element)) return false;
    if (element === button || button.contains(element)) return false;
    const control = element.closest(IMPORTANT_CONTROL_SELECTOR);
    return control instanceof HTMLElement && control !== button && !button.contains(control) && visible(control);
  }

  function rectsOverlap(a, b, padding = 0) {
    return !(
      a.right + padding <= b.left ||
      a.left - padding >= b.right ||
      a.bottom + padding <= b.top ||
      a.top - padding >= b.bottom
    );
  }

  function candidateRect(left, top) {
    return { left, top, right: left + CONFIG.buttonSize, bottom: top + CONFIG.buttonSize };
  }

  function spotIsClearOfControls(left, top) {
    const size = CONFIG.buttonSize;
    const samples = [
      [left + size / 2, top + size / 2],
      [left + 5, top + 5], [left + size - 5, top + 5],
      [left + 5, top + size - 5], [left + size - 5, top + size - 5],
    ];
    const oldPointerEvents = button.style.pointerEvents;
    button.style.pointerEvents = 'none';
    try {
      for (const [x, y] of samples) {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        for (const hit of document.elementsFromPoint(x, y)) {
          if (isImportantHit(hit)) return false;
        }
      }
    } finally {
      button.style.pointerEvents = oldPointerEvents;
    }
    return true;
  }

  function rangeRectsFor(element) {
    const range = document.createRange();
    try {
      range.selectNodeContents(element);
      return Array.from(range.getClientRects());
    } catch {
      return [];
    } finally {
      range.detach?.();
    }
  }

  function overlapsRenderedMessageContent(turn, left, top) {
    const body = assistantBody(turn) || turn;
    const candidate = candidateRect(left, top);
    const padding = CONFIG.contentCollisionPadding;

    for (const piece of body.querySelectorAll(CONTENT_SELECTOR)) {
      if (!(piece instanceof HTMLElement)) continue;
      const pieceRect = piece.getBoundingClientRect();
      if (!rectsOverlap(candidate, pieceRect, padding)) continue;
      if (piece.matches('pre, table, figure, [data-testid="writing-block-container"]')) return true;
      const lineRects = rangeRectsFor(piece);
      if (!lineRects.length) return true;
      for (const lineRect of lineRects) {
        if (lineRect.width > 0 && lineRect.height > 0 && rectsOverlap(candidate, lineRect, padding)) return true;
      }
    }
    return false;
  }

  function safePlacement(turn, viewTop, viewBottom) {
    const bounds = contentBounds(turn, viewTop, viewBottom);
    const size = CONFIG.buttonSize;
    const inset = CONFIG.fallbackViewportInset;
    const gap = CONFIG.fallbackGutterGap;
    const usableHeight = viewBottom - viewTop;
    const candidates = [
      innerWidth - size - CONFIG.rightInset,
      Math.ceil(bounds.right + gap),
      Math.floor(bounds.left - gap - size),
    ];

    for (const fraction of CONFIG.verticalFractions) {
      const ideal = Math.round(viewTop + usableHeight * fraction - size / 2);
      const top = Math.max(viewTop + inset, Math.min(ideal, viewBottom - size - inset));
      if (top < viewTop + inset || top + size > viewBottom - inset) continue;

      for (const left of candidates) {
        if (left < inset || left + size > innerWidth - inset) continue;
        if (!spotIsClearOfControls(left, top)) continue;
        if (overlapsRenderedMessageContent(turn, left, top)) continue;
        return { left, top };
      }
    }
    return null;
  }

  function shouldShow(turn, viewTop, viewBottom) {
    const rect = logicalRect(turn);
    const usableHeight = viewBottom - viewTop;
    if (usableHeight <= CONFIG.buttonSize * 2) return false;
    if (rect.height <= usableHeight + CONFIG.minimumExtraHeightPx) return false;
    if (rect.top > viewTop - CONFIG.revealAfterPx) return false;
    return rect.bottom > viewTop && rect.top < viewBottom;
  }

  function hide() {
    button.style.display = 'none';
    activeTurn = null;
  }

  function update() {
    frame = 0;
    if (!button.isConnected) document.body.appendChild(button);
    const viewTop = 0;
    const viewBottom = composerTop();
    const turn = chooseActiveTurn(viewTop, viewBottom);
    if (!(turn instanceof HTMLElement) || !shouldShow(turn, viewTop, viewBottom)) {
      hide();
      return;
    }
    const placement = safePlacement(turn, viewTop, viewBottom);
    if (!placement) {
      hide();
      return;
    }
    activeTurn = turn;
    button.style.left = `${Math.round(placement.left)}px`;
    button.style.top = `${Math.round(placement.top)}px`;
    button.style.display = 'flex';
  }

  function scheduleUpdate() {
    if (frame) return;
    frame = requestAnimationFrame(update);
  }

  function scrollElementToTop(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const oldMargin = element.style.scrollMarginTop;
    element.style.scrollMarginTop = `${CONFIG.scrollMarginTop}px`;
    element.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
    requestAnimationFrame(() => {
      if (element.isConnected) element.style.scrollMarginTop = oldMargin;
    });
    return true;
  }

  function scrollContainerFor(element) {
    let current = element?.parentElement || null;
    while (current && current !== document.body && current !== document.documentElement) {
      const style = getComputedStyle(current);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 1) {
        return current;
      }
      current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function probeUpFrom(element, pixels) {
    const scroller = scrollContainerFor(element);
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      window.scrollBy({ top: -pixels, behavior: 'auto' });
    } else {
      scroller.scrollBy({ top: -pixels, behavior: 'auto' });
    }
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function jumpToActiveExchangeStart() {
    if (!(activeTurn instanceof HTMLElement) || !activeTurn.isConnected) {
      scheduleUpdate();
      return;
    }

    const snapshot = activeTurn;
    const key = turnKey(snapshot);
    let current = resolveTurn(key, snapshot);
    let target = current ? previousConversationTurn(current) : null;

    if (usableTurn(target)) {
      scrollElementToTop(target);
      return;
    }

    // Long chats can virtualize the preceding user turn out of the live DOM.
    // First jump to the known assistant boundary, then probe slightly upward so
    // ChatGPT mounts the adjacent predecessor, and only then align that turn.
    if (!current || !scrollElementToTop(current)) return;

    for (let attempt = 0; attempt < CONFIG.virtualizationAttempts; attempt += 1) {
      await nextPaint();
      current = resolveTurn(key, snapshot);
      if (!current) break;

      target = previousConversationTurn(current);
      if (usableTurn(target)) {
        scrollElementToTop(target);
        return;
      }

      probeUpFrom(current, CONFIG.virtualizationProbePx);
    }

    log('Could not hydrate the conversation turn preceding the active assistant response.');
  }

  function createButton() {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'sm-current-message-jump';
    element.textContent = '↑';
    element.setAttribute('aria-label', 'Jump to the start of the current ChatGPT exchange');
    element.title = 'Start of current exchange';
    Object.assign(element.style, {
      position: 'fixed',
      zIndex: '2147483645',
      width: `${CONFIG.buttonSize}px`,
      height: `${CONFIG.buttonSize}px`,
      padding: '0',
      border: '1px solid rgba(127, 127, 127, 0.42)',
      borderRadius: '999px',
      background: 'rgba(32, 32, 32, 0.94)',
      color: '#fff',
      font: '650 23px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.24)',
      cursor: 'pointer',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
    });
    element.addEventListener('mouseenter', () => {
      element.style.background = 'rgba(48, 48, 48, 0.99)';
    });
    element.addEventListener('mouseleave', () => {
      element.style.background = 'rgba(32, 32, 32, 0.94)';
    });
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void jumpToActiveExchangeStart();
    });
    document.body.appendChild(element);
    return element;
  }

  const button = createButton();

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
  document.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });

  // React occasionally replaces large page subtrees during renderer rollouts.
  // A cheap watchdog makes the control self-healing if our injected button is
  // detached without a useful mutation reaching the normal update path.
  setInterval(scheduleUpdate, 1000);

  scheduleUpdate();
})();
