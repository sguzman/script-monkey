// ==UserScript==
// @name         ChatGPT - Force Text Attachment
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.4.0
// @description  Alt+V or Alt+B forces clipboard text into a .txt attachment instead of the ChatGPT composer.
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    attachmentDetectionMs: 2600,
    uploadInputWakeMs: 900,
    debug: true,
  });

  let attaching = false;

  function log(...args) {
    if (CONFIG.debug) {
      console.debug('[chatgpt-force-text-attachment]', ...args);
    }
  }

  function getPrompt() {
    return (
      document.querySelector('#prompt-textarea') ||
      document.querySelector('[contenteditable="true"][data-placeholder]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]')
    );
  }

  function nodeBelongsToPrompt(node, prompt) {
    if (!(node instanceof Element) || !prompt) return false;

    return (
      node === prompt ||
      prompt.contains(node) ||
      node.closest('#prompt-textarea') === prompt ||
      node.closest('[contenteditable="true"]') === prompt
    );
  }

  function isComposerTarget(target) {
    const prompt = getPrompt();
    if (!prompt) return false;

    return nodeBelongsToPrompt(target, prompt) || nodeBelongsToPrompt(document.activeElement, prompt);
  }

  function isExactForceAttachHotkey(event) {
    return (
      (event.code === 'KeyV' || event.code === 'KeyB') &&
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

  function uniqueElements(elements) {
    return [...new Set(elements.filter(Boolean))];
  }

  function inputAcceptsTextFile(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.id === 'upload-files') return true;

    const accept = (input.getAttribute('accept') || '').toLowerCase().trim();
    if (!accept) return true;

    return (
      accept.includes('*/*') ||
      accept.includes('text/plain') ||
      accept.includes('text/') ||
      accept.includes('.txt')
    );
  }

  function findUploadInputs() {
    const preferred = [
      document.querySelector('#upload-files[type="file"]'),
      ...document.querySelectorAll('input[type="file"][multiple]'),
      ...document.querySelectorAll('input[type="file"]'),
    ];

    return uniqueElements(preferred).filter(inputAcceptsTextFile);
  }

  function findComposerPlusButton() {
    const selectors = [
      '[data-testid="composer-plus-btn"]',
      'button[aria-label="Add files and more"]',
      'button[aria-label*="Add files"]',
      'button[aria-label*="Attach"]',
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button instanceof HTMLElement) return button;
    }

    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function wakeUploadInputs() {
    let inputs = findUploadInputs();
    if (inputs.length) return inputs;

    const plusButton = findComposerPlusButton();
    if (!plusButton) {
      log('No composer plus button found while trying to wake upload inputs.');
      return [];
    }

    log('No compatible upload input found; opening composer attachment menu.');
    plusButton.click();

    const deadline = performance.now() + CONFIG.uploadInputWakeMs;
    while (performance.now() < deadline) {
      await sleep(75);
      inputs = findUploadInputs();
      if (inputs.length) return inputs;
    }

    return [];
  }

  function composerScope() {
    const prompt = getPrompt();
    return (
      prompt?.closest('form') ||
      prompt?.closest('[data-testid*="composer"]') ||
      prompt?.parentElement ||
      document.body
    );
  }

  function attachmentVisible(filename) {
    const scopes = uniqueElements([composerScope(), document.body]);
    return scopes.some((scope) => scope?.textContent?.includes(filename));
  }

  function waitForAttachment(filename, timeoutMs) {
    return new Promise((resolve) => {
      if (attachmentVisible(filename)) {
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
        if (attachmentVisible(filename)) finish(true);
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const timer = setTimeout(() => finish(attachmentVisible(filename)), timeoutMs);
    });
  }

  async function tryUploadInputs(file) {
    const inputs = await wakeUploadInputs();

    if (!inputs.length) {
      log('No compatible file input found after waking attachment UI.');
      return false;
    }

    log(`Trying ${inputs.length} compatible upload input(s).`);

    for (const input of inputs) {
      try {
        const transfer = makeDataTransfer(file);
        const filesSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;

        if (filesSetter) {
          filesSetter.call(input, transfer.files);
        } else {
          input.files = transfer.files;
        }

        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        if (await waitForAttachment(file.name, CONFIG.attachmentDetectionMs)) {
          log('Direct file-input injection succeeded.', input);
          return true;
        }

        log('File-input candidate did not produce a visible attachment.', input);
      } catch (error) {
        console.error('[chatgpt-force-text-attachment] Upload-input candidate failed.', input, error);
      }
    }

    return false;
  }

  async function trySyntheticPaste(file) {
    const prompt = getPrompt();
    if (!prompt) return false;

    try {
      const transfer = makeDataTransfer(file);
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: transfer,
      });

      prompt.dispatchEvent(event);

      if (await waitForAttachment(file.name, CONFIG.attachmentDetectionMs)) {
        log('Synthetic file paste succeeded.');
        return true;
      }
    } catch (error) {
      console.error('[chatgpt-force-text-attachment] Synthetic file paste failed.', error);
    }

    return false;
  }

  function dropTargets() {
    const prompt = getPrompt();
    if (!prompt) return [];

    const candidates = [
      prompt,
      prompt.closest('form'),
      prompt.closest('[data-testid*="composer"]'),
      document.querySelector('[data-testid="composer"]'),
      document.querySelector('main'),
      document.body,
    ];

    return uniqueElements(candidates);
  }

  async function trySyntheticDrop(file) {
    for (const target of dropTargets()) {
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

        if (await waitForAttachment(file.name, CONFIG.attachmentDetectionMs)) {
          log('Synthetic drop succeeded.', target);
          return true;
        }
      } catch (error) {
        console.error('[chatgpt-force-text-attachment] Synthetic-drop candidate failed.', target, error);
      }
    }

    return false;
  }

  function toast(message, error = false, durationMs = 2800) {
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
      maxWidth: 'min(760px, calc(100vw - 32px))',
      whiteSpace: 'pre-wrap',
    });

    document.body.appendChild(element);
    setTimeout(() => element.remove(), durationMs);
  }

  async function clipboardPermissionState() {
    try {
      if (!navigator.permissions?.query) return 'unknown';
      const status = await navigator.permissions.query({ name: 'clipboard-read' });
      return status.state || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async function readClipboardText() {
    if (!window.isSecureContext) {
      throw new Error('Clipboard API requires a secure context.');
    }

    if (!navigator.clipboard?.readText) {
      throw new Error('navigator.clipboard.readText is unavailable.');
    }

    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      const permission = await clipboardPermissionState();
      const name = error?.name || 'Error';
      const message = error?.message || String(error);
      throw new Error(`${name}: ${message} (clipboard-read permission: ${permission})`);
    }
  }

  async function attachClipboardText(text) {
    if (!text) {
      toast('Force attach: clipboard has no plain text.', true);
      return;
    }

    const file = makeClipboardFile(text);
    log(`Attaching ${text.length} characters as ${file.name}`);
    toast(`Force attach: read ${text.length} chars; attaching...`);

    if (await tryUploadInputs(file)) {
      toast(`Attached ${file.name}`);
      return;
    }

    log('Direct input path failed; trying synthetic file paste.');
    if (await trySyntheticPaste(file)) {
      toast(`Attached ${file.name}`);
      return;
    }

    log('Synthetic paste failed; trying synthetic drag/drop.');
    if (await trySyntheticDrop(file)) {
      toast(`Attached ${file.name}`);
      return;
    }

    toast('Force attach failed after input, paste, and drop paths. Nothing was pasted.', true, 4200);
    console.error(
      '[chatgpt-force-text-attachment] Could not hand the generated file to ChatGPT after all attachment paths.',
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
        toast('Force attach is already running.', true);
        return;
      }

      attaching = true;
      log(`Hotkey received: ${event.code === 'KeyB' ? 'Alt+B' : 'Alt+V'}.`);
      toast(`Force attach hotkey received (${event.code === 'KeyB' ? 'Alt+B' : 'Alt+V'}); reading clipboard...`);

      void (async () => {
        try {
          const text = await readClipboardText();
          await attachClipboardText(text);
        } catch (error) {
          const message = error?.message || String(error);
          toast(`Force attach clipboard read failed: ${message}`, true, 5200);
          console.error('[chatgpt-force-text-attachment] Clipboard read failed.', error);
        } finally {
          attaching = false;
        }
      })();
    },
    true,
  );

  log('Loaded. Alt+V and Alt+B force clipboard text to a .txt attachment.');
})();
