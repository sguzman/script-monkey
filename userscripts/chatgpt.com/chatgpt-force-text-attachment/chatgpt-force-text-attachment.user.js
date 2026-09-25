// ==UserScript==
// @name         ChatGPT - Force Text Attachment
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.3.0
// @description  Alt+V forces clipboard text into a .txt attachment instead of the ChatGPT composer.
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    attachmentDetectionMs: 1800,
    debug: false,
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

  function isComposerTarget(target) {
    if (!(target instanceof Element)) return false;

    const prompt = getPrompt();
    if (!prompt) return false;

    return (
      target === prompt ||
      prompt.contains(target) ||
      target.closest('#prompt-textarea') === prompt ||
      target.closest('[contenteditable="true"]') === prompt
    );
  }

  function isExactForceAttachHotkey(event) {
    return (
      event.code === 'KeyV' &&
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

  function findUploadInputs() {
    return Array.from(document.querySelectorAll('input[type="file"]'));
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
    const scope = composerScope();
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

  async function tryUploadInputs(file) {
    const inputs = findUploadInputs();

    if (!inputs.length) {
      log('No file input found.');
      return false;
    }

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
    if (!prompt) return [];

    const candidates = [
      prompt,
      prompt.closest('form'),
      prompt.closest('[data-testid*="composer"]'),
      document.querySelector('[data-testid="composer"]'),
      document.querySelector('main'),
      document.body,
    ].filter(Boolean);

    return [...new Set(candidates)];
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
    setTimeout(() => element.remove(), 2400);
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
        'The site may have changed its upload UI.',
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
