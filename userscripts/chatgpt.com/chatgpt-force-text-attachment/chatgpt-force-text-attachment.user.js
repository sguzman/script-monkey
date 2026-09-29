// ==UserScript==
// @name         ChatGPT - Force Text Attachment
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.4.0
// @description  Alt+V forces clipboard text into a .txt attachment instead of the ChatGPT composer.
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    inputDiscoveryMs: 1400,
    attachmentDetectionMs: 3500,
    debug: false,
  });

  const PROMPT_SELECTORS = [
    '[data-testid="prompt-textarea"]',
    '#prompt-textarea',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'form[data-chatgpt-composer] [contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][role="textbox"]',
  ];

  const PLUS_SELECTORS = [
    '#composer-plus-btn',
    'button[data-testid="composer-plus-btn"]',
  ];

  const ATTACHMENT_UI_SELECTOR = [
    '[data-testid*="attachment"]',
    '[data-testid*="upload"]',
    '[data-testid*="file"]',
    '[data-testid*="chip"]',
    '[aria-label*="Remove file" i]',
    '[aria-label*="Remove attachment" i]',
  ].join(',');

  let attaching = false;

  function log(...args) {
    if (CONFIG.debug) {
      console.debug('[chatgpt-force-text-attachment]', ...args);
    }
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
      const candidates = Array.from(document.querySelectorAll(selector));
      const live = candidates.find((node) => visible(node));
      if (live) return live;
      if (candidates[0]) return candidates[0];
    }
    return null;
  }

  function composerRoot() {
    const prompt = getPrompt();
    if (!(prompt instanceof HTMLElement)) return document.body;

    let current =
      prompt.closest('form[data-chatgpt-composer]') ||
      prompt.closest('[data-testid*="composer"]') ||
      prompt.closest('form') ||
      prompt.parentElement;

    let fallback = current || document.body;

    while (current && current !== document.body) {
      fallback = current;
      if (
        current.querySelector('[data-testid="send-button"]') ||
        current.querySelector('button[type="submit"]')
      ) {
        return current;
      }
      current = current.parentElement;
    }

    return fallback || document.body;
  }

  function isComposerTarget(target) {
    if (!(target instanceof Element)) return false;

    const prompt = getPrompt();
    if (!(prompt instanceof HTMLElement)) return false;

    if (
      target === prompt ||
      prompt.contains(target) ||
      target.closest('[data-testid="prompt-textarea"]') === prompt ||
      target.closest('#prompt-textarea') === prompt ||
      target.closest('[contenteditable="true"]') === prompt
    ) {
      return true;
    }

    // Current ChatGPT renderers can put the actual key target one wrapper away
    // from the visible editor. Accept it only when focus still proves the
    // composer owns the keystroke.
    const active = document.activeElement;
    return active === prompt || (active instanceof Node && prompt.contains(active));
  }

  function isExactForceAttachHotkey(event) {
    return (
      (event.code === 'KeyV' || event.key?.toLowerCase() === 'v') &&
      event.altKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.repeat
    );
  }

  function timestamp() {
    const d = new Date();
    const pad = (value) => String(value).padStart(2, '0');

    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      '-',
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds()),
    ].join('');
  }

  function makeClipboardFile(text) {
    return new File([text], `clipboard-${timestamp()}.txt`, {
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
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return false;

    const accept = (input.getAttribute('accept') || '').trim().toLowerCase();
    if (!accept) return true;

    const parts = accept.split(',').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return true;

    if (parts.every((part) => part.startsWith('image/'))) return false;

    return parts.some((part) => (
      part === '*/*' ||
      part === '.txt' ||
      part === 'text/plain' ||
      part === 'text/*' ||
      part.startsWith('text/')
    )) || !parts.every((part) => part.startsWith('image/'));
  }

  function rankedUploadInputs() {
    const root = composerRoot();
    const local = root ? Array.from(root.querySelectorAll('input[type="file"]')) : [];
    const global = Array.from(document.querySelectorAll('input[type="file"]'));
    const seen = new Set();

    const inputs = [...local, ...global].filter((input) => {
      if (!(input instanceof HTMLInputElement) || seen.has(input)) return false;
      seen.add(input);
      return acceptsTextFile(input);
    });

    return inputs
      .map((input) => {
        const rect = input.getBoundingClientRect();
        const accept = (input.getAttribute('accept') || '').toLowerCase();
        const localToComposer = root instanceof Element && root.contains(input);
        const score =
          (input.multiple ? 100 : 0) +
          (localToComposer ? 60 : 0) +
          (rect.width > 0 && rect.height > 0 ? 30 : 0) +
          (!accept ? 25 : 0) +
          (accept.includes('text') || accept.includes('.txt') ? 20 : 0);

        return { input, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(({ input }) => input);
  }

  function findComposerPlus() {
    const root = composerRoot();

    for (const selector of PLUS_SELECTORS) {
      const local = root?.querySelector?.(selector);
      if (local instanceof HTMLButtonElement && visible(local)) return local;
    }

    for (const selector of PLUS_SELECTORS) {
      const candidate = Array.from(document.querySelectorAll(selector))
        .find((node) => node instanceof HTMLButtonElement && visible(node));
      if (candidate instanceof HTMLButtonElement) return candidate;
    }

    return null;
  }

  function clickComposerPlus() {
    const button = findComposerPlus();
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    try {
      button.focus({ preventScroll: true });

      // A normal HTMLElement.click() is the least fragile path here. Dispatching
      // hand-built pointer events can miss React's activation semantics.
      button.click();
      log('Activated composer plus control.');
      return true;
    } catch (error) {
      log('Could not activate composer plus control.', error);
      return false;
    }
  }

  async function waitForUploadInputs(timeoutMs) {
    const existing = rankedUploadInputs();
    if (existing.length) return existing;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const inputs = rankedUploadInputs();
      if (inputs.length) return inputs;
    }

    return [];
  }

  async function discoverUploadInputs() {
    let inputs = rankedUploadInputs();
    if (inputs.length) return inputs;

    // ChatGPT no longer guarantees a standing file input in the composer.
    // Opening the exact + menu causes the current renderer to expose its upload
    // input. Do this before giving up or trying drag/drop.
    if (clickComposerPlus()) {
      inputs = await waitForUploadInputs(CONFIG.inputDiscoveryMs);
      if (inputs.length) return inputs;
    }

    return rankedUploadInputs();
  }

  function captureAttachmentState() {
    const root = composerRoot() || document.body;
    const nodes = Array.from(root.querySelectorAll(ATTACHMENT_UI_SELECTOR));
    const inputFiles = Array.from(document.querySelectorAll('input[type="file"]'))
      .filter((input) => input instanceof HTMLInputElement)
      .flatMap((input) => Array.from(input.files || []).map((file) => file.name));

    return {
      uiCount: nodes.length,
      uiSignature: nodes
        .slice(0, 30)
        .map((node) => [
          node.getAttribute?.('data-testid') || '',
          node.getAttribute?.('aria-label') || '',
          node.getAttribute?.('title') || '',
          node.textContent || '',
        ].join('|'))
        .join('||'),
      inputFiles,
    };
  }

  function attachmentEvidence(filename, baseline) {
    const root = composerRoot() || document.body;
    const lower = filename.toLowerCase();

    if ((root.innerText || root.textContent || '').toLowerCase().includes(lower)) {
      return true;
    }

    for (const input of document.querySelectorAll('input[type="file"]')) {
      if (!(input instanceof HTMLInputElement)) continue;
      if (Array.from(input.files || []).some((file) => file.name === filename)) {
        return true;
      }
    }

    const now = captureAttachmentState();
    if (now.uiCount > baseline.uiCount) return true;
    if (baseline.uiSignature && now.uiSignature && now.uiSignature !== baseline.uiSignature) return true;

    return now.inputFiles.includes(filename);
  }

  function waitForAttachment(filename, baseline, timeoutMs) {
    return new Promise((resolve) => {
      if (attachmentEvidence(filename, baseline)) {
        resolve(true);
        return;
      }

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(value);
      };

      const observer = new MutationObserver(() => {
        if (attachmentEvidence(filename, baseline)) finish(true);
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-testid', 'aria-label', 'title', 'data-state'],
      });

      const timer = setTimeout(
        () => finish(attachmentEvidence(filename, baseline)),
        timeoutMs,
      );
    });
  }

  async function tryUploadInputs(file) {
    const inputs = await discoverUploadInputs();

    if (!inputs.length) {
      log('No compatible ChatGPT file input found, even after opening composer +.');
      return false;
    }

    for (const input of inputs) {
      const baseline = captureAttachmentState();

      try {
        const transfer = makeDataTransfer(file);
        const filesSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'files',
        )?.set;

        if (filesSetter) {
          filesSetter.call(input, transfer.files);
        } else {
          input.files = transfer.files;
        }

        // React has used both event paths on this surface. Send both.
        input.dispatchEvent(new Event('input', {
          bubbles: true,
          composed: true,
        }));
        input.dispatchEvent(new Event('change', {
          bubbles: true,
          composed: true,
        }));

        if (await waitForAttachment(file.name, baseline, CONFIG.attachmentDetectionMs)) {
          return true;
        }
      } catch (error) {
        log('Upload-input candidate failed.', error);
      }
    }

    return false;
  }

  function dropTargets() {
    const prompt = getPrompt();
    const root = composerRoot();

    const candidates = [
      prompt,
      root,
      prompt?.parentElement,
      document.querySelector('main'),
      document.body,
    ].filter((node) => node instanceof HTMLElement);

    return [...new Set(candidates)];
  }

  async function trySyntheticDrop(file) {
    for (const target of dropTargets()) {
      const baseline = captureAttachmentState();

      try {
        const transfer = makeDataTransfer(file);

        for (const type of ['dragenter', 'dragover', 'drop']) {
          target.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              dataTransfer: transfer,
            }),
          );
        }

        if (await waitForAttachment(file.name, baseline, CONFIG.attachmentDetectionMs)) {
          return true;
        }
      } catch (error) {
        log('Synthetic-drop candidate failed.', error);
      }
    }

    return false;
  }

  function toast(message, error = false) {
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
      background: error ? 'rgba(155, 28, 28, 0.96)' : 'rgba(25, 25, 25, 0.96)',
      boxShadow: '0 4px 18px rgba(0, 0, 0, 0.28)',
      pointerEvents: 'none',
    });

    document.body.appendChild(element);
    setTimeout(() => element.remove(), 2600);
  }

  async function readClipboardText() {
    if (!navigator.clipboard?.readText) {
      throw new Error('Clipboard API is unavailable.');
    }

    return navigator.clipboard.readText();
  }

  async function attachClipboardText(text) {
    if (!text) {
      toast('Clipboard has no plain text to attach.', true);
      return;
    }

    const file = makeClipboardFile(text);
    log(`Attaching ${text.length} characters as ${file.name}`);

    if (await tryUploadInputs(file)) {
      toast(`Attached ${file.name}`);
      return;
    }

    if (await trySyntheticDrop(file)) {
      toast(`Attached ${file.name}`);
      return;
    }

    toast('Attachment failed; nothing was pasted.', true);
    console.error(
      '[chatgpt-force-text-attachment] Could not hand the generated file to ChatGPT. ' +
      'No compatible upload input acknowledged the file.',
    );
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (!isExactForceAttachHotkey(event) || !isComposerTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (attaching) {
        return;
      }

      attaching = true;

      void (async () => {
        try {
          const text = await readClipboardText();
          await attachClipboardText(text);
        } catch (error) {
          toast('Could not read clipboard text.', true);
          console.error('[chatgpt-force-text-attachment] Clipboard read failed.', error);
        } finally {
          attaching = false;
        }
      })();
    },
    true,
  );

  log('Loaded. Alt+V forces clipboard text to a .txt attachment.');
})();
