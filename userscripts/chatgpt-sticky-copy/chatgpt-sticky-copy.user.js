// ==UserScript==
// @name         ChatGPT Sticky Copy Button
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.2.0
// @description  Keep Copy available on long ChatGPT code and writing blocks without covering the composer.
// @author       Salvador Guzman
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    scanDebounceMs: 120,
    minimumBlockWidth: 220,
    minimumBlockHeight: 88,
    maximumHeaderOffset: 120,
    minimumContentBelowCopy: 36,
    edgeInset: 10,
    bottomInset: 28,
    composerFallbackReserve: 64,
    buttonWidth: 68,
    buttonHeight: 32,
    copiedLabelMs: 1100,
    debug: false,
  };

  const COPY_LABEL_RE = /\bcopy\b/i;
  const EXCLUDED_COPY_LABEL_RE = /\bcopy\s+(?:link|url|response|message|conversation)\b/i;
  const TURN_SELECTOR = [
    '[data-testid^="conversation-turn-"]',
    '[data-message-author-role]',
  ].join(',');
  const PROMPT_INPUT_SELECTOR = [
    '#prompt-textarea',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Message"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
  ].join(',');

  const records = new Map();
  let scanTimer = 0;
  let positionFrame = 0;

  const log = (...args) => {
    if (CONFIG.debug) console.debug('[chatgpt-sticky-copy]', ...args);
  };

  function controlLabel(control) {
    return [
      control?.getAttribute?.('aria-label'),
      control?.getAttribute?.('title'),
      control?.getAttribute?.('data-tooltip-content'),
      control?.getAttribute?.('data-testid'),
      control?.innerText,
      control?.textContent,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isCopyControl(control) {
    if (!(control instanceof HTMLElement)) return false;
    if (!control.matches('button,[role="button"]')) return false;
    if (control.classList.contains('sm-sticky-copy-button')) return false;

    const label = controlLabel(control);
    if (!label || EXCLUDED_COPY_LABEL_RE.test(label)) return false;
    return COPY_LABEL_RE.test(label) || /copy/i.test(control.getAttribute('data-testid') || '');
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < innerHeight &&
      rect.right > 0 &&
      rect.left < innerWidth
    );
  }

  function isTurnBoundary(element, turnRoot) {
    if (!(element instanceof HTMLElement)) return true;
    if (element === turnRoot) return true;
    if (element.matches('main,body,html')) return true;
    if (element.matches(TURN_SELECTOR)) return true;
    return false;
  }

  function hasMeaningfulBody(element, buttonRect, elementRect) {
    if (elementRect.width < CONFIG.minimumBlockWidth) return false;
    if (elementRect.height < CONFIG.minimumBlockHeight) return false;

    const headerOffset = buttonRect.top - elementRect.top;
    const contentBelow = elementRect.bottom - buttonRect.bottom;
    if (headerOffset < -4 || headerOffset > CONFIG.maximumHeaderOffset) return false;
    if (contentBelow < CONFIG.minimumContentBelowCopy) return false;

    if (
      element.querySelector(
        'pre,code,textarea,iframe,[contenteditable="true"],[data-testid*="artifact" i],[data-testid*="writing" i],[data-testid*="canvas" i]',
      )
    ) {
      return true;
    }

    const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 40) return true;

    // Newer rich/writing blocks can keep their rendered body in a nested surface that
    // contributes little useful text to the shell itself. Geometry still distinguishes
    // those shells from the ordinary response-level Copy action at the bottom of a turn.
    return element.childElementCount >= 2 && elementRect.height >= 140 && contentBelow >= 80;
  }

  function findCopyBlock(copyControl) {
    const turnRoot = copyControl.closest(TURN_SELECTOR);
    const buttonRect = copyControl.getBoundingClientRect();
    let current = copyControl.parentElement;

    while (current && current !== document.body) {
      if (isTurnBoundary(current, turnRoot)) break;
      const rect = current.getBoundingClientRect();
      if (hasMeaningfulBody(current, buttonRect, rect)) return current;
      current = current.parentElement;
    }

    return null;
  }

  function findLiveNativeCopy(block, preferred) {
    if (preferred?.isConnected && block.contains(preferred) && isCopyControl(preferred)) return preferred;

    const controls = block.querySelectorAll('button,[role="button"]');
    for (const control of controls) {
      if (isCopyControl(control)) return control;
    }
    return null;
  }

  function fallbackText(block) {
    const codeBlocks = block.querySelectorAll('pre code, pre');
    if (codeBlocks.length === 1) {
      return (codeBlocks[0].innerText || codeBlocks[0].textContent || '').trimEnd();
    }

    const clone = block.cloneNode(true);
    clone.querySelectorAll('button,[role="button"],script,style,svg,.sm-sticky-copy-button').forEach((node) => node.remove());
    return (clone.innerText || clone.textContent || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function copyFallback(block) {
    const text = fallbackText(block);
    if (!text) throw new Error('No fallback text found for this block.');

    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return;
    }

    await navigator.clipboard.writeText(text);
  }

  function flashLabel(button, label) {
    const previous = button.textContent;
    button.textContent = label;
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = previous;
    }, CONFIG.copiedLabelMs);
  }

  async function handleCopy(record) {
    const native = findLiveNativeCopy(record.block, record.nativeCopy);
    if (native) {
      record.nativeCopy = native;
      native.click();
      flashLabel(record.overlay, 'Copied');
      return;
    }

    try {
      await copyFallback(record.block);
      flashLabel(record.overlay, 'Copied');
    } catch (error) {
      log('copy failed', error);
      flashLabel(record.overlay, 'Failed');
    }
  }

  function createOverlay(block, nativeCopy) {
    const overlay = document.createElement('button');
    overlay.type = 'button';
    overlay.className = 'sm-sticky-copy-button';
    overlay.textContent = 'Copy';
    overlay.setAttribute('aria-label', 'Copy this ChatGPT block');
    overlay.title = 'Copy this block';

    Object.assign(overlay.style, {
      position: 'fixed',
      zIndex: '2147483646',
      width: `${CONFIG.buttonWidth}px`,
      height: `${CONFIG.buttonHeight}px`,
      padding: '0 10px',
      border: '1px solid rgba(127, 127, 127, 0.35)',
      borderRadius: '8px',
      background: 'rgba(32, 32, 32, 0.94)',
      color: '#fff',
      font: '500 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
      cursor: 'pointer',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
    });

    const record = { block, nativeCopy, overlay };
    overlay.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handleCopy(record);
    });

    overlay.addEventListener('mouseenter', () => {
      overlay.style.background = 'rgba(48, 48, 48, 0.98)';
    });
    overlay.addEventListener('mouseleave', () => {
      overlay.style.background = 'rgba(32, 32, 32, 0.94)';
    });

    document.body.appendChild(overlay);
    records.set(block, record);
    return record;
  }

  function removeRecord(block) {
    const record = records.get(block);
    if (!record) return;
    record.overlay.remove();
    records.delete(block);
  }

  function nativeCopyIsOnScreen(record) {
    const native = findLiveNativeCopy(record.block, record.nativeCopy);
    if (!native) return false;
    record.nativeCopy = native;
    return isVisible(native);
  }

  function composerContainerFor(input) {
    const form = input.closest('form');
    if (form instanceof HTMLElement) {
      const rect = form.getBoundingClientRect();
      if (rect.width >= CONFIG.minimumBlockWidth && rect.height > 0 && rect.bottom > innerHeight * 0.55) {
        return form;
      }
    }

    const inputRect = input.getBoundingClientRect();
    let current = input.parentElement;
    while (current && current !== document.body) {
      const testId = current.getAttribute('data-testid') || '';
      const ariaLabel = current.getAttribute('aria-label') || '';
      const semanticName = `${testId} ${ariaLabel}`;
      const rect = current.getBoundingClientRect();
      if (
        /composer|prompt/i.test(semanticName) &&
        rect.width >= CONFIG.minimumBlockWidth &&
        rect.height >= inputRect.height + 12 &&
        rect.bottom > innerHeight * 0.55
      ) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function composerExclusionTop() {
    let exclusionTop = innerHeight;
    const inputs = document.querySelectorAll(PROMPT_INPUT_SELECTOR);

    for (const input of inputs) {
      if (!(input instanceof HTMLElement) || !input.isConnected) continue;
      if (input.closest(TURN_SELECTOR)) continue;

      const rect = input.getBoundingClientRect();
      if (
        rect.width < 100 ||
        rect.height <= 0 ||
        rect.bottom <= innerHeight * 0.55 ||
        rect.top >= innerHeight ||
        rect.bottom <= 0
      ) {
        continue;
      }

      const container = composerContainerFor(input);
      const candidateTop = container
        ? container.getBoundingClientRect().top
        : rect.top - CONFIG.composerFallbackReserve;

      exclusionTop = Math.min(exclusionTop, candidateTop);
    }

    return Math.max(0, Math.min(innerHeight, exclusionTop));
  }

  function positionOverlay(record) {
    const { block, overlay } = record;
    if (!block.isConnected) {
      removeRecord(block);
      return;
    }

    const rect = block.getBoundingClientRect();
    const safeBottom = composerExclusionTop();
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, safeBottom);
    const visibleHeight = visibleBottom - visibleTop;

    if (
      rect.width < CONFIG.minimumBlockWidth ||
      visibleHeight < Math.min(CONFIG.buttonHeight, rect.height) ||
      rect.right <= 0 ||
      rect.left >= innerWidth ||
      nativeCopyIsOnScreen(record)
    ) {
      overlay.style.display = 'none';
      return;
    }

    const inset = CONFIG.edgeInset;
    const minTop = Math.max(inset, rect.top + inset);
    const maxTop = Math.min(
      safeBottom - CONFIG.buttonHeight - CONFIG.bottomInset,
      rect.bottom - CONFIG.buttonHeight - CONFIG.bottomInset,
    );

    if (maxTop < minTop) {
      overlay.style.display = 'none';
      return;
    }

    const top = maxTop;
    const minLeft = Math.max(inset, rect.left + inset);
    const maxLeft = Math.min(
      innerWidth - CONFIG.buttonWidth - inset,
      rect.right - CONFIG.buttonWidth - inset,
    );

    if (maxLeft < minLeft) {
      overlay.style.display = 'none';
      return;
    }

    overlay.style.top = `${Math.round(top)}px`;
    overlay.style.left = `${Math.round(maxLeft)}px`;
    overlay.style.display = 'flex';
  }

  function updatePositions() {
    positionFrame = 0;
    for (const record of records.values()) positionOverlay(record);
  }

  function schedulePositionUpdate() {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(updatePositions);
  }

  function scan() {
    scanTimer = 0;
    const controls = document.querySelectorAll('button,[role="button"]');

    for (const control of controls) {
      if (!isCopyControl(control)) continue;
      const block = findCopyBlock(control);
      if (!block) continue;

      const existing = records.get(block);
      if (existing) {
        existing.nativeCopy = control;
      } else {
        createOverlay(block, control);
      }
    }

    for (const [block] of records) {
      if (!block.isConnected) removeRecord(block);
    }

    schedulePositionUpdate();
  }

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, CONFIG.scanDebounceMs);
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === 'childList' && (mutation.addedNodes.length || mutation.removedNodes.length))) {
      scheduleScan();
      schedulePositionUpdate();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('scroll', schedulePositionUpdate, true);
  document.addEventListener('input', schedulePositionUpdate, true);
  document.addEventListener('focusin', schedulePositionUpdate, true);
  window.addEventListener('resize', schedulePositionUpdate, { passive: true });
  window.addEventListener('hashchange', scheduleScan);
  window.addEventListener('popstate', scheduleScan);

  scan();
})();
