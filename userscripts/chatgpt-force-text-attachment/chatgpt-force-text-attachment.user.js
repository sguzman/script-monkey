// ==UserScript==
// @name         ChatGPT - Force Text Attachment
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.1.0
// @description  Ctrl+Shift+V forces clipboard text into a .txt attachment instead of the ChatGPT composer.
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    armWindowMs: 1500,
    attachmentDetectionMs: 1500,
    debug: false,
  });

  let forceAttachUntil = 0;

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
      if (
        event.code === 'KeyV' &&
        event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.repeat &&
        isComposerTarget(event.target)
      ) {
        // Do not prevent the keydown. Chromium still needs to emit the real paste
        // event so clipboardData is available without clipboard permissions.
        forceAttachUntil = performance.now() + CONFIG.armWindowMs;
        log('Force-attachment paste armed.');
      }
    },
    true,
  );

  document.addEventListener(
    'paste',
    (event) => {
      if (performance.now() > forceAttachUntil) return;
      if (!isComposerTarget(event.target)) return;

      forceAttachUntil = 0;

      const text = event.clipboardData?.getData('text/plain') || '';

      // Capture before ChatGPT's own paste handler gets a chance to choose
      // whether the text is inline or an attachment.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      void attachClipboardText(text);
    },
    true,
  );

  log('Loaded. Ctrl+Shift+V forces clipboard text to a .txt attachment.');
})();
