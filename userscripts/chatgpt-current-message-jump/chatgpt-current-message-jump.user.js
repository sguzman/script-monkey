// ==UserScript==
// @name         ChatGPT Current Message Jump
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.2.0
// @description  Show a safe-gutter arrow that jumps to the top of the current long ChatGPT assistant message without covering content or controls.
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
    gutterGap: 14,
    viewportInset: 12,
    revealAfterPx: 80,
    minimumExtraHeightPx: 24,
    composerGap: 18,
    scrollMarginTop: 12,
    verticalFractions: [0.42, 0.56, 0.70, 0.30],
    debug: false,
  };

  const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';
  const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
  const CONTENT_SELECTOR = [
    '[data-testid="writing-block-container"]',
    'pre',
    'table',
    'blockquote',
    'figure',
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
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
    'button',
    'a[href]',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="dialog"]',
    'dialog',
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

  function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sm-current-message-jump';
    button.textContent = '↑';
    button.setAttribute('aria-label', 'Jump to top of current long ChatGPT message');
    button.title = 'Top of current message';

    Object.assign(button.style, {
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

    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(48, 48, 48, 0.99)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'rgba(32, 32, 32, 0.94)';
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      jumpToActiveTurnTop();
    });

    document.body.appendChild(button);
    return button;
  }

  const button = createButton();

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
    if (turn.matches(ASSISTANT_SELECTOR)) return turn;
    return turn.querySelector(ASSISTANT_SELECTOR);
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

  function visibleHeight(rect, viewTop, viewBottom) {
    return Math.max(0, Math.min(rect.bottom, viewBottom) - Math.max(rect.top, viewTop));
  }

  function chooseActiveTurn(viewTop, viewBottom) {
    const turns = assistantRoots();
    if (!turns.length) return null;

    const centerY = viewTop + (viewBottom - viewTop) / 2;
    let centerTurn = null;
    let centerTurnSpan = Infinity;
    let largest = null;
    let largestVisible = 0;

    for (const turn of turns) {
      const rect = turn.getBoundingClientRect();
      const seenHeight = visibleHeight(rect, viewTop, viewBottom);
      if (seenHeight <= 0) continue;

      if (rect.top <= centerY && rect.bottom >= centerY && rect.height < centerTurnSpan) {
        centerTurn = turn;
        centerTurnSpan = rect.height;
      }

      if (seenHeight > largestVisible) {
        largest = turn;
        largestVisible = seenHeight;
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

    return {
      left: Math.max(0, left),
      right: Math.min(innerWidth, right),
    };
  }

  function isImportantHit(element) {
    if (!(element instanceof Element)) return false;
    if (element === button || button.contains(element)) return false;

    const control = element.closest(IMPORTANT_CONTROL_SELECTOR);
    if (!(control instanceof HTMLElement)) return false;
    if (control === button || button.contains(control)) return false;
    return visible(control);
  }

  function spotIsClear(left, top) {
    const size = CONFIG.buttonSize;
    const samples = [
      [left + size / 2, top + size / 2],
      [left + 5, top + 5],
      [left + size - 5, top + 5],
      [left + 5, top + size - 5],
      [left + size - 5, top + size - 5],
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

  function safePlacement(turn, viewTop, viewBottom) {
    const bounds = contentBounds(turn, viewTop, viewBottom);
    const size = CONFIG.buttonSize;
    const inset = CONFIG.viewportInset;
    const gap = CONFIG.gutterGap;

    const horizontal = [];
    const right = Math.ceil(bounds.right + gap);
    if (right + size <= innerWidth - inset) horizontal.push(right);

    const left = Math.floor(bounds.left - gap - size);
    if (left >= inset) horizontal.push(left);

    if (!horizontal.length) {
      log('No geometric gutter wide enough for jump button.', bounds);
      return null;
    }

    const usableHeight = viewBottom - viewTop;
    for (const fraction of CONFIG.verticalFractions) {
      const ideal = Math.round(viewTop + usableHeight * fraction - size / 2);
      const top = Math.max(viewTop + inset, Math.min(ideal, viewBottom - size - inset));
      if (top < viewTop + inset || top + size > viewBottom - inset) continue;

      for (const candidateLeft of horizontal) {
        if (spotIsClear(candidateLeft, top)) {
          return { left: candidateLeft, top };
        }
      }
    }

    log('Gutters exist, but every sampled position contains an actual interactive control.');
    return null;
  }

  function shouldShow(turn, viewTop, viewBottom) {
    const rect = turn.getBoundingClientRect();
    const usableHeight = viewBottom - viewTop;

    if (usableHeight <= CONFIG.buttonSize * 2) return false;
    if (rect.height <= usableHeight + CONFIG.minimumExtraHeightPx) return false;
    if (rect.top > viewTop - CONFIG.revealAfterPx) return false;
    if (rect.bottom <= viewTop || rect.top >= viewBottom) return false;
    return true;
  }

  function hide() {
    button.style.display = 'none';
    activeTurn = null;
  }

  function update() {
    frame = 0;

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

  function jumpToActiveTurnTop() {
    if (!(activeTurn instanceof HTMLElement) || !activeTurn.isConnected) {
      scheduleUpdate();
      return;
    }

    const oldMargin = activeTurn.style.scrollMarginTop;
    activeTurn.style.scrollMarginTop = `${CONFIG.scrollMarginTop}px`;
    activeTurn.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });

    requestAnimationFrame(() => {
      if (activeTurn?.isConnected) activeTurn.style.scrollMarginTop = oldMargin;
      scheduleUpdate();
    });
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
  document.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });

  scheduleUpdate();
})();
