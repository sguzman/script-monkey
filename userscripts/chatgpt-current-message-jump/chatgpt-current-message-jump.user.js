// ==UserScript==
// @name         ChatGPT Current Message Jump
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.1.0
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
    buttonSize: 38,
    gutterGap: 14,
    viewportInset: 12,
    minimumLongTurnExtraPx: 24,
    revealAfterPx: 96,
    collisionPadding: 8,
    scrollMarginTop: 12,
    verticalFractions: [0.44, 0.58, 0.72, 0.32],
    debug: false,
  };

  const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';
  const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
  const PROMPT_INPUT_SELECTOR = [
    '#prompt-textarea',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Message"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
  ].join(',');
  const CONTENT_PIECE_SELECTOR = [
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
  const COLLISION_SELECTOR = [
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
    'nav',
    'aside',
  ].join(',');

  let activeTurn = null;
  let updateFrame = 0;

  const log = (...args) => {
    if (CONFIG.debug) console.debug('[chatgpt-current-message-jump]', ...args);
  };

  function isVisibleElement(element) {
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
    button.setAttribute('aria-label', 'Jump to the top of the current long ChatGPT message');
    button.title = 'Top of current message';

    Object.assign(button.style, {
      position: 'fixed',
      zIndex: '2147483645',
      width: `${CONFIG.buttonSize}px`,
      height: `${CONFIG.buttonSize}px`,
      padding: '0',
      border: '1px solid rgba(127, 127, 127, 0.38)',
      borderRadius: '999px',
      background: 'rgba(32, 32, 32, 0.92)',
      color: '#fff',
      font: '600 22px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
      cursor: 'pointer',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
    });

    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(48, 48, 48, 0.98)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'rgba(32, 32, 32, 0.92)';
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

  function assistantTurns() {
    const turns = [];
    const seen = new Set();

    for (const turn of document.querySelectorAll(TURN_SELECTOR)) {
      if (!(turn instanceof HTMLElement)) continue;
      const assistant = turn.matches(ASSISTANT_SELECTOR) ? turn : turn.querySelector(ASSISTANT_SELECTOR);
      if (!(assistant instanceof HTMLElement)) continue;
      if (seen.has(turn)) continue;
      seen.add(turn);
      turns.push(turn);
    }

    if (turns.length) return turns;

    for (const assistant of document.querySelectorAll(ASSISTANT_SELECTOR)) {
      if (!(assistant instanceof HTMLElement) || seen.has(assistant)) continue;
      seen.add(assistant);
      turns.push(assistant);
    }

    return turns;
  }

  function assistantContent(turn) {
    if (!(turn instanceof HTMLElement)) return null;
    if (turn.matches(ASSISTANT_SELECTOR)) return turn;
    return turn.querySelector(ASSISTANT_SELECTOR);
  }

  function composerExclusionTop() {
    let top = innerHeight;

    for (const input of document.querySelectorAll(PROMPT_INPUT_SELECTOR)) {
      if (!(input instanceof HTMLElement) || !isVisibleElement(input)) continue;
      if (input.closest(TURN_SELECTOR)) continue;

      const inputRect = input.getBoundingClientRect();
      if (inputRect.bottom <= innerHeight * 0.5) continue;

      const form = input.closest('form');
      if (form instanceof HTMLElement) {
        const formRect = form.getBoundingClientRect();
        if (formRect.height > 0 && formRect.bottom > innerHeight * 0.5) {
          top = Math.min(top, formRect.top);
          continue;
        }
      }

      top = Math.min(top, inputRect.top - 20);
    }

    return Math.max(0, Math.min(innerHeight, top));
  }

  function visibleIntersectionHeight(rect, top, bottom) {
    return Math.max(0, Math.min(rect.bottom, bottom) - Math.max(rect.top, top));
  }

  function chooseActiveTurn(viewTop, viewBottom) {
    const turns = assistantTurns();
    if (!turns.length) return null;

    const centerY = viewTop + (viewBottom - viewTop) / 2;
    let containingCenter = null;
    let containingCenterHeight = Infinity;
    let largestVisible = null;
    let largestVisibleHeight = 0;

    for (const turn of turns) {
      const rect = turn.getBoundingClientRect();
      const visibleHeight = visibleIntersectionHeight(rect, viewTop, viewBottom);
      if (visibleHeight <= 0) continue;

      if (rect.top <= centerY && rect.bottom >= centerY && rect.height < containingCenterHeight) {
        containingCenter = turn;
        containingCenterHeight = rect.height;
      }

      if (visibleHeight > largestVisibleHeight) {
        largestVisible = turn;
        largestVisibleHeight = visibleHeight;
      }
    }

    return containingCenter || largestVisible;
  }

  function horizontalContentBounds(turn, viewTop, viewBottom) {
    const content = assistantContent(turn) || turn;
    const contentRect = content.getBoundingClientRect();
    let left = Infinity;
    let right = -Infinity;

    const pieces = content.querySelectorAll(CONTENT_PIECE_SELECTOR);
    for (const piece of pieces) {
      if (!(piece instanceof HTMLElement)) continue;
      const rect = piece.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 4) continue;
      if (rect.bottom <= viewTop || rect.top >= viewBottom) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }

    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
      left = contentRect.left;
      right = contentRect.right;
    }

    return {
      left: Math.max(0, left),
      right: Math.min(innerWidth, right),
    };
  }

  function rectanglesOverlap(a, b, padding = 0) {
    return !(
      a.right + padding <= b.left ||
      a.left - padding >= b.right ||
      a.bottom + padding <= b.top ||
      a.top - padding >= b.bottom
    );
  }

  function candidateRect(left, top) {
    return {
      left,
      top,
      right: left + CONFIG.buttonSize,
      bottom: top + CONFIG.buttonSize,
      width: CONFIG.buttonSize,
      height: CONFIG.buttonSize,
    };
  }

  function collidesWithImportantUi(candidate) {
    const collisions = document.querySelectorAll(COLLISION_SELECTOR);

    for (const element of collisions) {
      if (!(element instanceof HTMLElement) || element === button || !isVisibleElement(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rectanglesOverlap(candidate, rect, CONFIG.collisionPadding)) return true;
    }

    return false;
  }

  function safePlacement(turn, viewTop, viewBottom) {
    const bounds = horizontalContentBounds(turn, viewTop, viewBottom);
    const size = CONFIG.buttonSize;
    const inset = CONFIG.viewportInset;
    const gap = CONFIG.gutterGap;

    const horizontalCandidates = [];
    const rightLeft = Math.ceil(bounds.right + gap);
    if (rightLeft + size <= innerWidth - inset) horizontalCandidates.push(rightLeft);

    const leftLeft = Math.floor(bounds.left - gap - size);
    if (leftLeft >= inset) horizontalCandidates.push(leftLeft);

    if (!horizontalCandidates.length) return null;

    const usableHeight = viewBottom - viewTop;
    for (const fraction of CONFIG.verticalFractions) {
      const idealTop = Math.round(viewTop + usableHeight * fraction - size / 2);
      const top = Math.max(viewTop + inset, Math.min(idealTop, viewBottom - size - inset));

      if (top < viewTop + inset || top + size > viewBottom - inset) continue;

      for (const left of horizontalCandidates) {
        const candidate = candidateRect(left, top);
        if (!collidesWithImportantUi(candidate)) return candidate;
      }
    }

    return null;
  }

  function shouldShowForTurn(turn, viewTop, viewBottom) {
    const rect = turn.getBoundingClientRect();
    const usableHeight = viewBottom - viewTop;

    if (usableHeight <= CONFIG.buttonSize * 2) return false;
    if (rect.height <= usableHeight + CONFIG.minimumLongTurnExtraPx) return false;
    if (rect.top >= viewTop - CONFIG.revealAfterPx) return false;
    if (rect.bottom <= viewTop || rect.top >= viewBottom) return false;

    return true;
  }

  function hideButton() {
    button.style.display = 'none';
    activeTurn = null;
  }

  function update() {
    updateFrame = 0;

    const viewTop = 0;
    const viewBottom = composerExclusionTop();
    const turn = chooseActiveTurn(viewTop, viewBottom);

    if (!(turn instanceof HTMLElement) || !shouldShowForTurn(turn, viewTop, viewBottom)) {
      hideButton();
      return;
    }

    const placement = safePlacement(turn, viewTop, viewBottom);
    if (!placement) {
      log('No safe gutter placement; hiding jump button.');
      hideButton();
      return;
    }

    activeTurn = turn;
    button.style.left = `${placement.left}px`;
    button.style.top = `${placement.top}px`;
    button.style.display = 'flex';
  }

  function scheduleUpdate() {
    if (updateFrame) return;
    updateFrame = requestAnimationFrame(update);
  }

  function jumpToActiveTurnTop() {
    if (!(activeTurn instanceof HTMLElement) || !activeTurn.isConnected) {
      scheduleUpdate();
      return;
    }

    const previousScrollMarginTop = activeTurn.style.scrollMarginTop;
    activeTurn.style.scrollMarginTop = `${CONFIG.scrollMarginTop}px`;
    activeTurn.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });

    requestAnimationFrame(() => {
      if (activeTurn?.isConnected) activeTurn.style.scrollMarginTop = previousScrollMarginTop;
      scheduleUpdate();
    });
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });

  scheduleUpdate();
})();
