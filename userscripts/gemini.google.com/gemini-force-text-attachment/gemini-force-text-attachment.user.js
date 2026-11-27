// ==UserScript==
// @name         Gemini Force Text Attachment
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.1.0
// @description  Attach native clipboard text as a .txt file using Ctrl+Shift+V.
// @match        https://gemini.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';
  const KEY = '__scriptMonkeyGeminiTextAttachment';
  if (window[KEY] || window.top !== window) return;
  window[KEY] = true;
  const EDITOR = 'rich-textarea [contenteditable="true"],div.ql-editor[contenteditable="true"]';
  const LIMIT = 4 * 1024 * 1024;
  let armed = null, busy = false;
  function notify(message) {
    const id = 'sm-gemini-attachment-status';
    document.getElementById(id)?.remove();
    const el = document.createElement('div');
    el.id = id;
    el.setAttribute('role', 'status');
    el.textContent = message;
    Object.assign(el.style, {position:'fixed',bottom:'20px',left:'50%',
      transform:'translateX(-50%)',zIndex:'2147483000',background:'#202124',
      color:'#fff',padding:'10px 14px',borderRadius:'8px',font:'14px system-ui',
      maxWidth:'min(480px,90vw)',pointerEvents:'none'});
    document.body.append(el);
    setTimeout(() => el.remove(), 5000);
  }
  function editor() {
    const items = [...document.querySelectorAll(EDITOR)].filter(el =>
      el.isConnected && el.getBoundingClientRect().width > 0 &&
      el.getBoundingClientRect().height > 0 && !el.closest('[inert]'));
    return items.length === 1 ? items[0] : null;
  }
  function eligible(input) {
    if (!input.isConnected || input.disabled || input.files?.length ||
        input.hasAttribute('webkitdirectory')) return false;
    const accept = (input.accept || '').toLowerCase().split(',').map(x => x.trim());
    return accept.some(x => ['', '*/*', '.txt', 'text/plain', 'text/*'].includes(x));
  }
  function chooseInput(prompt) {
    const root = prompt.closest('input-area, input-container, .input-area-container, form');
    const all = [...document.querySelectorAll('input[type="file"]')].filter(eligible);
    const scoped = root ? all.filter(el => root.contains(el)) : [];
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1) return null;
    return all.length === 1 ? all[0] : null;
  }
  function finish() {
    const a = armed;
    if (!a) return null;
    armed = null;
    clearTimeout(a.timer);
    a.sink.remove();
    if (a.prompt.isConnected && location.href === a.url) {
      a.prompt.focus({preventScroll:true});
      if (a.range?.startContainer.isConnected && a.range?.endContainer.isConnected) {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(a.range);
      }
    }
    return a;
  }
  function keydown(e) {
    if (!e.isTrusted || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey ||
        e.key.toLowerCase() !== 'v' || e.repeat || busy || armed) return;
    const prompt = editor();
    if (!prompt || !prompt.contains(document.activeElement)) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const sink = document.createElement('textarea');
    sink.tabIndex = -1;
    sink.setAttribute('aria-hidden','true');
    Object.assign(sink.style,{position:'fixed',left:'-10000px',top:'0',
      width:'1px',height:'1px',opacity:'0',pointerEvents:'none'});
    document.body.append(sink);
    sink.focus({preventScroll:true});
    if (document.activeElement !== sink) {
      sink.remove(); notify('Could not prepare attachment; shortcut unchanged.'); return;
    }
    armed = {prompt,range,sink,url:location.href,timer:setTimeout(() => {
      finish(); notify('No native paste received; nothing attached.');
    },1500)};
    // Keep the real browser paste default action. No Clipboard API permission.
    e.stopImmediatePropagation();
  }
  function paste(e) {
    if (!armed || !e.isTrusted || e.target !== armed.sink) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const text = e.clipboardData?.getData('text/plain') || '';
    const a = finish();
    if (!a || !text || new TextEncoder().encode(text).byteLength > LIMIT) {
      notify('Clipboard is empty or exceeds 4 MiB; nothing attached.'); return;
    }
    if (location.href !== a.url || editor() !== a.prompt || busy) {
      notify('Composer changed; nothing attached.'); return;
    }
    const input = chooseInput(a.prompt);
    if (!input) {
      notify('No unambiguous text-file upload input. Open Gemini’s upload control and retry.'); return;
    }
    busy = true;
    try {
      const name = 'clipboard-' + new Date().toISOString().replace(/[:.]/g,'-') + '.txt';
      const transfer = new DataTransfer();
      transfer.items.add(new File([text],name,{type:'text/plain'}));
      input.files = transfer.files;
      if (input.files.length !== 1 || input.files[0].name !== name)
        throw new Error('File assignment was rejected');
      input.dispatchEvent(new Event('change',{bubbles:true}));
      // Do not retry or claim upload success without a visible attachment chip.
      notify('File offered to Gemini: '+name+' — verify the attachment before sending.');
    } catch {
      notify('Attachment attempt failed or is uncertain; check composer before retrying.');
    } finally {
      setTimeout(() => {busy=false;},1000);
    }
  }
  window.addEventListener('keydown',keydown,true);
  window.addEventListener('paste',paste,true);
  window.addEventListener('pagehide',finish);
})();
