// ==UserScript==
// @name         Gemini Force Text Attachment
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.2.0
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
  const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
  function visible(el) {
    return el?.isConnected && el.getBoundingClientRect().width > 0 &&
      el.getBoundingClientRect().height > 0;
  }
  function offer(input,file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    if (input.files.length !== 1 || input.files[0].name !== file.name)
      throw new Error('File assignment was rejected');
    input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
  }
  async function uploadThroughMenu(file,prompt,url) {
    // The native upload input can be created only when the menu item is
    // clicked, or can live inside a shadow root. Intercept that single
    // picker invocation rather than requiring a pre-existing DOM input.
    const proto = HTMLInputElement.prototype;
    const oldClick = Object.getOwnPropertyDescriptor(proto,'click');
    const oldPicker = Object.getOwnPropertyDescriptor(proto,'showPicker');
    let result = null;
    function intercept(original) {
      return function(...args) {
        if (!result && location.href === url && editor() === prompt &&
            this.type === 'file' && eligible(this)) {
          result = 'attempted';
          try { offer(this,file); result = 'offered'; }
          catch { result = 'failed'; }
          return;
        }
        return original.apply(this,args);
      };
    }
    const click = intercept(proto.click);
    const picker = oldPicker?.value ? intercept(oldPicker.value) : null;
    try {
      Object.defineProperty(proto,'click',{configurable:true,writable:true,value:click});
      if (picker) Object.defineProperty(proto,'showPicker',{...oldPicker,value:picker});
      let item = null;
      for (let i=0;i<16;i++) {
        if (location.href !== url || editor() !== prompt) throw Error('Composer changed');
        const icon = document.querySelector('[data-test-id="local-images-files-uploader-icon"]');
        item = icon?.closest('button,[role="menuitem"],.mat-mdc-menu-item');
        if (!visible(item)) item = [...document.querySelectorAll('button,[role="menuitem"]')]
          .find(el => visible(el) && /^(upload files|upload file|upload from device|files)$/i.test(
            (el.textContent || '').trim().replace(/\s+/g,' ')));
        if (visible(item)) break;
        if (i===0) {
          const plus = [...document.querySelectorAll('button[aria-label="Open upload file menu"],button[aria-label="Upload & tools"],button[aria-label="Add files"]')].find(visible) ||
            [...document.querySelectorAll('mat-icon[data-mat-icon-name="add_2"],mat-icon[fonticon="add"]')].map(el=>el.closest('button')).find(visible);
          if (!plus) throw Error('Gemini upload menu button not found');
          plus.click();
        }
        await delay(100);
      }
      if (!visible(item)) throw Error('Gemini local upload menu item not found');
      item.click();
      for (let i=0;i<12 && !result;i++) await delay(100);
      if (result!=='offered') throw Error(result==='failed'?'Gemini rejected file assignment':'Gemini file picker was not intercepted');
    } finally {
      if (proto.click===click) {
        if (oldClick) Object.defineProperty(proto,'click',oldClick);
        else delete proto.click;
      }
      if (picker && proto.showPicker===picker) Object.defineProperty(proto,'showPicker',oldPicker);
    }
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
  async function paste(e) {
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
    busy = true;
    try {
      const name = 'clipboard-' + new Date().toISOString().replace(/[:.]/g,'-') + '.txt';
      const file = new File([text],name,{type:'text/plain'});
      const input = chooseInput(a.prompt);
      if (input) offer(input,file);
      else await uploadThroughMenu(file,a.prompt,a.url);
      notify('File offered to Gemini: '+name+' — verify the attachment before sending.');
    } catch (error) {
      notify((error?.message || 'Attachment failed')+'; check composer before retrying.');
    } finally {
      busy=false;
    }
  }
  window.addEventListener('keydown',keydown,true);
  window.addEventListener('paste',paste,true);
  window.addEventListener('pagehide',finish);
})();
