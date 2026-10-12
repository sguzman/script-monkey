// ==UserScript==
// @name         ChatGPT - Force Text Attachment
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.6.0
// @description  Adds a Clipboard button beside ChatGPT's + control to attach clipboard text as a .txt file.
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @updateURL    https://raw.githubusercontent.com/sguzman/script-monkey/main/userscripts/chatgpt.com/chatgpt-force-text-attachment/chatgpt-force-text-attachment.user.js
// @downloadURL  https://raw.githubusercontent.com/sguzman/script-monkey/main/userscripts/chatgpt.com/chatgpt-force-text-attachment/chatgpt-force-text-attachment.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    inputDiscoveryMs: 1200,
    attachmentDetectionMs: 4500,
    attachmentPollMs: 160,
    mountRetryMs: 1500,
    debug: false,
  });

  const PROMPT_SELECTORS = [
    '[data-testid="prompt-textarea"]',
    '#prompt-textarea',
    '[contenteditable="true"][data-lexical-editor="true"]',
    '[contenteditable="true"][role="textbox"]',
  ];
  const PLUS_SELECTORS = [
    '#composer-plus-btn',
    'button[data-testid="composer-plus-btn"]',
    'button[aria-label="Add files and more"]',
    'button[aria-label*="Add files" i]',
    'button[title*="Add files" i]',
  ];
  const FILE_LABEL_SELECTOR =
    '[data-testid*="attachment"],[data-testid*="file"],[aria-label],[title]';

  let attaching = false;
  let clipboardButton = null;
  let mountedPlus = null;
  let mountedComposer = null;
  let mountTimer = null;
  let positionFrame = null;
  let composerResizeObserver = null;
  let nextMountAt = 0;

  function log(...args) {
    if (CONFIG.debug) console.debug('[chatgpt-force-text-attachment]', ...args);
  }

  function visible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getPrompt() {
    for (const selector of PROMPT_SELECTORS) {
      const matches = document.querySelectorAll(selector);
      for (const match of matches) {
        if (visible(match)) return match;
      }
    }
    return null;
  }

  function composerRoot() {
    const prompt = getPrompt();
    if (!prompt) return null;

    const form = prompt.closest('form');
    if (form) return form;

    let root = prompt;
    for (let depth = 0; depth < 7 && root.parentElement; depth += 1) {
      root = root.parentElement;
      if (root === document.body) break;
      if (
        root.querySelector('#composer-plus-btn') ||
        root.querySelector('[data-testid="composer-plus-btn"]') ||
        root.querySelector('[data-testid="send-button"]')
      ) {
        return root;
      }
    }
    return prompt.parentElement;
  }

  function findComposerPlus() {
    const root = composerRoot();
    for (const selector of PLUS_SELECTORS) {
      const local = root?.querySelector(selector);
      if (local instanceof HTMLButtonElement && visible(local)) return local;
    }
    for (const selector of PLUS_SELECTORS) {
      for (const candidate of document.querySelectorAll(selector)) {
        if (candidate instanceof HTMLButtonElement && visible(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  function makeClipboardFile(text) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = 'clipboard-' +
      d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.txt';
    return new File([text], name, {
      type: 'text/plain;charset=utf-8',
      lastModified: Date.now(),
    });
  }

  function makeDataTransfer(file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    return transfer;
  }

  function acceptsTextFile(input) {
    if (!(input instanceof HTMLInputElement) ||
        !input.isConnected || input.type !== 'file' || input.disabled) {
      return false;
    }
    const accept = (input.getAttribute('accept') || '').trim().toLowerCase();
    if (!accept) return true;
    return accept.split(',').some((part) => {
      const value = part.trim();
      return value === '*/*' || value === '.txt' ||
        value === 'text/plain' || value === 'text/*';
    });
  }

  function rankedUploadInputs(localOnly = false) {
    const root = composerRoot();
    const all = localOnly
      ? (root ? root.querySelectorAll('input[type="file"]') : [])
      : document.querySelectorAll('input[type="file"]');

    return Array.from(all)
      .filter(acceptsTextFile)
      .map((input) => ({
        input,
        score:
          (root?.contains(input) ? 100 : 0) +
          (input.multiple ? 30 : 0) +
          (!(input.getAttribute('accept') || '').trim() ? 15 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .map(({ input }) => input);
  }

  function clickComposerPlus() {
    const plus = findComposerPlus();
    if (!plus || plus.disabled || plus.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    try {
      plus.click();
      return true;
    } catch (error) {
      log('Could not open attachment menu.', error);
      return false;
    }
  }

  async function discoverUploadInputs() {
    const local = rankedUploadInputs(true);
    if (local.length) return local;

    // The current composer may create the input only when + is opened.
    // Do not assign files to unrelated page-level inputs before this point.
    if (!clickComposerPlus()) return [];

    const until = Date.now() + CONFIG.inputDiscoveryMs;
    do {
      const candidates = rankedUploadInputs();
      if (candidates.length) return candidates;
      await new Promise((resolve) => setTimeout(resolve, 80));
    } while (Date.now() < until);
    return [];
  }

  function attachmentAppears(filename) {
    const root = composerRoot();
    if (!root) return false;

    // textContent does not force layout, unlike innerText. An exact, newly
    // generated filename is stronger evidence than a changing chip count.
    if (root.textContent?.includes(filename)) return true;

    for (const node of root.querySelectorAll(FILE_LABEL_SELECTOR)) {
      if (
        node.getAttribute('title')?.includes(filename) ||
        node.getAttribute('aria-label')?.includes(filename)
      ) {
        return true;
      }
    }
    return false;
  }

  function waitForAttachment(filename) {
    // Do not observe the document. ChatGPT streams thousands of mutations:
    // checking all of them can freeze a long conversation.
    return new Promise((resolve) => {
      const until = Date.now() + CONFIG.attachmentDetectionMs;
      function check() {
        if (attachmentAppears(filename)) {
          resolve(true);
        } else if (Date.now() >= until) {
          resolve(false);
        } else {
          setTimeout(check, CONFIG.attachmentPollMs);
        }
      }
      check();
    });
  }

  async function tryUploadInput(file) {
    const inputs = await discoverUploadInputs();
    if (!inputs.length) return 'unavailable';

    for (const input of inputs) {
      try {
        if (!input.isConnected) continue;
        const transfer = makeDataTransfer(file);
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, 'files'
        )?.set;
        if (setter) setter.call(input, transfer.files);
        else input.files = transfer.files;

        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        // A FileList holding the file does NOT mean that ChatGPT uploaded it.
        // Avoid another upload attempt here: it could create duplicates if
        // ChatGPT is still processing the first event.
        return (await waitForAttachment(file.name)) ? 'confirmed' : 'unconfirmed';
      } catch (error) {
        log('File input rejected generated attachment.', error);
      }
    }
    return 'unavailable';
  }

  async function tryDrop(file) {
    const target = getPrompt() || composerRoot();
    if (!(target instanceof HTMLElement)) return 'unavailable';

    try {
      const transfer = makeDataTransfer(file);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: transfer,
        }));
      }
      return (await waitForAttachment(file.name)) ? 'confirmed' : 'unconfirmed';
    } catch (error) {
      log('File drop rejected.', error);
      return 'unavailable';
    }
  }

  function toast(message, isError = false) {
    if (!document.body) return;
    const element = document.createElement('div');
    element.textContent = message;
    Object.assign(element.style, {
      position: 'fixed',
      left: '50%',
      bottom: '84px',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      padding: '9px 13px',
      borderRadius: '8px',
      font: '13px/1.4 system-ui, sans-serif',
      color: '#fff',
      background: isError ? 'rgba(155, 28, 28, 0.96)' : 'rgba(25, 25, 25, 0.96)',
      boxShadow: '0 4px 18px rgba(0, 0, 0, 0.28)',
      pointerEvents: 'none',
    });
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 2600);
  }

  async function attachClipboardText() {
    if (!navigator.clipboard?.readText) {
      toast('Clipboard access is unavailable.', true);
      return;
    }
    // Read immediately within the button's trusted click, before any awaits.
    const text = await navigator.clipboard.readText();
    if (!text) {
      toast('Clipboard has no plain text to attach.', true);
      return;
    }

    const file = makeClipboardFile(text);
    let outcome = await tryUploadInput(file);
    if (outcome === 'unavailable') outcome = await tryDrop(file);

    if (outcome === 'confirmed') {
      toast('Attached ' + file.name);
    } else if (outcome === 'unconfirmed') {
      toast('Upload not confirmed. Check composer; nothing was pasted.', true);
      console.warn('[chatgpt-force-text-attachment] Upload event sent but file not confirmed:', file.name);
    } else {
      toast('Could not find a working file upload. Nothing was pasted.', true);
      console.error('[chatgpt-force-text-attachment] No compatible upload path available.');
    }
  }

  function makeClipboardButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'sm-force-text-attach';
    button.setAttribute('aria-label', 'Attach clipboard text as a .txt file');
    button.title = 'Attach clipboard text as a .txt file';
    button.innerHTML = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"',
      ' viewBox="0 0 24 24" fill="none" stroke="currentColor"',
      ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"',
      ' aria-hidden="true" focusable="false">',
      '<rect x="8" y="4" width="12" height="18" rx="2"/>',
      '<path d="M16 4.5V3a1 1 0 0 0-1-1h-2"/>',
      '<path d="M8 8H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/>',
      '<path d="M11 13h6M11 17h4"/>',
      '</svg><span>Clipboard</span>',
    ].join('');

    Object.assign(button.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      height: '32px',
      minHeight: '32px',
      padding: '0 9px',
      margin: '0',
      position: 'fixed',
      left: '-10000px',
      top: '-10000px',
      border: '1px solid var(--border-light, rgba(128,128,128,0.45))',
      borderRadius: '999px',
      background: 'var(--main-surface-secondary, rgba(128,128,128,0.18))',
      zIndex: '1000',
      pointerEvents: 'auto',
      color: 'var(--text-primary, inherit)',
      fontFamily: 'inherit',
      fontSize: '12px',
      fontWeight: '600',
      lineHeight: '1',
      cursor: 'pointer',
      flexShrink: '0',
      whiteSpace: 'nowrap',
    });
    button.addEventListener('mouseenter', () => {
      if (!button.disabled) button.style.background = 'rgba(128,128,128,0.28)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'var(--main-surface-secondary, rgba(128,128,128,0.18))';
    });
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (attaching) return;

      attaching = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.style.opacity = '0.5';
      try {
        await attachClipboardText();
      } catch (error) {
        toast('Could not read or attach clipboard text.', true);
        console.error('[chatgpt-force-text-attachment] Attachment failed.', error);
      } finally {
        attaching = false;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.style.opacity = '1';
      }
    });
    return button;
  }

  // Float outside the composer: never insert a button into ChatGPT's
  // editor or toolbar, where it would change layout and block clicks.
  function composerFor(plus) {
    const prompt = getPrompt();
    let ancestor = plus.parentElement;
    for (let depth = 0; ancestor && ancestor !== document.body && depth < 14; depth += 1) {
      if (prompt && ancestor.contains(prompt)) return ancestor;
      ancestor = ancestor.parentElement;
    }
    return plus.closest('form') || composerRoot();
  }

  function positionClipboardButton() {
    positionFrame = null;
    if (!clipboardButton || !mountedPlus?.isConnected ||
        !mountedComposer?.isConnected) {
      if (clipboardButton) clipboardButton.style.display = 'none';
      return;
    }

    const composerRect = mountedComposer.getBoundingClientRect();
    const plusRect = mountedPlus.getBoundingClientRect();
    if (composerRect.width <= 0 || plusRect.width <= 0 ||
        plusRect.bottom < 0 || plusRect.top > window.innerHeight) {
      clipboardButton.style.display = 'none';
      return;
    }

    // Show text when space permits. Fall back to an icon in a small gutter.
    // If even the icon would overlap the composer, hide instead.
    clipboardButton.style.display = 'inline-flex';
    const label = clipboardButton.querySelector('span');
    if (label) label.style.display = '';
    clipboardButton.style.width = '';
    clipboardButton.style.padding = '0 9px';
    const gutterWidth = composerRect.left - 12;
    let buttonWidth = clipboardButton.getBoundingClientRect().width;
    if (buttonWidth > gutterWidth) {
      if (label) label.style.display = 'none';
      clipboardButton.style.width = '34px';
      clipboardButton.style.padding = '0';
      buttonWidth = 34;
    }
    if (gutterWidth < buttonWidth + 8 || composerRect.left > window.innerWidth) {
      clipboardButton.style.display = 'none';
      return;
    }

    clipboardButton.style.left =
      Math.round(composerRect.left - buttonWidth - 12) + 'px';
    clipboardButton.style.top =
      Math.round(plusRect.top + (plusRect.height - 32) / 2) + 'px';
  }

  function scheduleClipboardPosition() {
    if (positionFrame !== null) return;
    positionFrame = requestAnimationFrame(positionClipboardButton);
  }

  function mountClipboardButton() {
    mountTimer = null;
    const plus = findComposerPlus();
    if (!plus || !document.body) {
      nextMountAt = Date.now() + CONFIG.mountRetryMs;
      return;
    }

    const composer = composerFor(plus);
    if (!composer) {
      nextMountAt = Date.now() + CONFIG.mountRetryMs;
      return;
    }

    if (!clipboardButton) clipboardButton = makeClipboardButton();
    if (clipboardButton.parentElement !== document.body) {
      document.body.appendChild(clipboardButton);
    }

    if (mountedComposer !== composer) {
      composerResizeObserver?.disconnect();
      composerResizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(scheduleClipboardPosition)
        : null;
      composerResizeObserver?.observe(composer);
    }

    mountedPlus = plus;
    mountedComposer = composer;
    nextMountAt = 0;
    scheduleClipboardPosition();
  }

  function scheduleClipboardMount() {
    if (mountTimer !== null) return;
    const delay = Math.max(250, nextMountAt - Date.now());
    mountTimer = setTimeout(mountClipboardButton, delay);
  }

  function startClipboardButton() {
    // The mutation callback is inert while the existing composer is mounted.
    const observer = new MutationObserver(() => {
      if (mountedPlus?.isConnected &&
          mountedComposer?.isConnected &&
          clipboardButton?.parentElement === document.body) return;
      scheduleClipboardMount();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleClipboardPosition, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleClipboardPosition, { passive: true });
    mountClipboardButton();
  }

  if (document.documentElement) startClipboardButton();
  else document.addEventListener('DOMContentLoaded', startClipboardButton, { once: true });

  log('Loaded. Clipboard floats outside the composer, left of its + control.');
})();
