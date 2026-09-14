// ==UserScript==
// @name         ChatGPT - Force Text Attachment
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.2.0
// @description  Ctrl+Shift+V forces clipboard text into a .txt attachment instead of the ChatGPT composer.
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    attachmentDetectionMs: 1500,
    debug: false,
  });

  // One-shot state: Ctrl+Shift+V arms exactly the next paste.
  //
  // IMPORTANT: Do not put a short time limit on this state. Chromium may delay
  // delivery of the paste event while materializing a very large clipboard
  // payload. A previous 1.5-second timeout let that delayed paste escape into
  // ChatGPT's composer, which is the exact failure this script exists to prevent.
  let forceAttachPending = false;

  function log(...args) {
    if (CONFIG.debug) {
      console.debug('[chatgpt-force-text-attachment]', ...args);
    }
  }

  function getPrompt() {
    return (
      document.querySelector('#prompt-textarea') ||
      document.querySelector('[contenteditable="true"][data-placeholder]')
    );
  }

  function isComposerTarget(target) {
    if (!(target instanceof Element)) return false;

    const prompt = getPrompt();
    if (!prompt) return false;

    return target === prompt || prompt.contains(target) || target.closest('#prompt-textarea') === prompt;
  }

  function clearPending(reason) {
    if (!forceAttachPending) return;
    forceAttachPending = false;
    log(`Force-attachment paste disarmed: ${reason}`);
  }

  function isExactForceAttachHotkey(event) {
    return (
      event.code === 'KeyV' &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.repeat
    );
  }

  function isModifierKey(event) {
    return ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key);
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

  function findUploadInput() {
    return (
      document.querySelector('#upload-files[type="file"]') ||
      document.querySelector('input[type="file"][multiple]') ||
      document.querySelector('input[type="file"]')
    );
  }

  function attachmentVisible(filename) {
    const composer = getPrompt()?.closest('form') || getPrompt()?.parentElement;
    const scope = composer || document.body;
    return Boolean(scope?.textContent?.includes(filename));
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

  async function tryUploadInput(file) {
    const input = findUploadInput();
    if (!input) {
      log('No file input found.');
      return false;
    }

    try {
      const transfer = makeDataTransfer(file);
      const filesSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;

      if (filesSetter) {
        filesSetter.call(input, transfer.files);
      } else {
        input.files = transfer.files;
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      return await waitForAttachment(file.name, CONFIG.attachmentDetectionMs);
    } catch (error) {
      console.error('[chatgpt-force-text-attachment] Upload-input injection failed.', error);
      return false;
    }
  }

  async function trySyntheticDrop(file) {
    const prompt = getPrompt();
    if (!prompt) return false;

    const target = prompt.closest('form') || prompt;

    try {
      const transfer = makeDataTransfer(file);

      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }),
        );
      }

      return await waitForAttachment(file.name, CONFIG.attachmentDetectionMs);
    } catch (error) {
      console.error('[chatgpt-force-text-attachment] Synthetic-drop fallback failed.', error);
      return false;
    }
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
    setTimeout(() => element.remove(), 2400);
  }

  async function attachClipboardText(text) {
    if (!text) {
      toast('Clipboard has no plain text to attach.', true);
      return;
    }

    const file = makeClipboardFile(text);
    log(`Attaching ${text.length} characters as ${file.name}`);

    if (await tryUploadInput(file)) {
      toast(`Attached ${file.name}`);
      return;
    }

    if (await trySyntheticDrop(file)) {
      toast(`Attached ${file.name}`);
      return;
    }

    // Deliberately do not fall back to inserting the text into the composer.
    // Ctrl+Shift+V means attachment-or-failure, never "paste a giant wall of text".
    toast('Attachment failed; nothing was pasted.', true);
    console.error(
      '[chatgpt-force-text-attachment] Could not hand the generated file to ChatGPT. ' +
        'The site may have changed its upload UI.',
    );
  }

  document.addEventListener(
    'keydown',
    (event) => {
      if (isExactForceAttachHotkey(event) && isComposerTarget(event.target)) {
        // Do not prevent the keydown. Chromium still needs to emit the real paste
        // event so clipboardData is available without clipboard permissions.
        forceAttachPending = true;
        log('Force-attachment paste armed.');
        return;
      }

      // If the browser somehow never produces the paste event, do not leave a
      // stale one-shot armed forever. The next deliberate non-modifier keypress
      // cancels it; in particular, a later ordinary Ctrl+V remains ordinary.
      if (forceAttachPending && !isModifierKey(event)) {
        clearPending('another key was pressed before paste');
      }
    },
    true,
  );

  document.addEventListener(
    'paste',
    (event) => {
      if (!forceAttachPending) return;

      // Consume the one-shot before doing any further work. Most importantly,
      // cancel the browser's default paste *before* reading or processing the
      // potentially gigantic clipboard payload, so it can never fall through
      // into ChatGPT's contenteditable if our attachment handoff later fails.
      forceAttachPending = false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!isComposerTarget(event.target)) {
        toast('Attachment paste lost composer focus; nothing was pasted.', true);
        log('Forced paste was captured outside the composer.');
        return;
      }

      const text = event.clipboardData?.getData('text/plain') || '';
      void attachClipboardText(text);
    },
    true,
  );

  document.addEventListener(
    'pointerdown',
    () => {
      clearPending('pointer interaction before paste');
    },
    true,
  );

  window.addEventListener('blur', () => clearPending('window lost focus'), true);
  window.addEventListener('pagehide', () => clearPending('page hidden'), true);

  log('Loaded. Ctrl+Shift+V forces clipboard text to a .txt attachment.');
})();
