// ==UserScript==
// @name         ChatGPT Sticky Copy Probe
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.1.0
// @description  One-shot structural probe for ChatGPT writing blocks. Diagnostic companion to ChatGPT Sticky Copy Button.
// @author       Salvador Guzman
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const PREFIX = '[sticky-copy-probe]';
  let armed = false;
  let veil = null;
  let banner = null;

  function clean(value, max = 240) {
    if (value == null) return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function rectOf(el) {
    if (!(el instanceof Element)) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      left: Math.round(r.left),
    };
  }

  function attrsOf(el) {
    if (!(el instanceof Element)) return {};
    const names = [
      'id', 'class', 'role', 'aria-label', 'title', 'name', 'type', 'src',
      'data-testid', 'data-component', 'data-state', 'data-slot',
      'data-writing-block-id', 'data-artifact-id', 'contenteditable',
    ];
    const out = {};
    for (const name of names) {
      const value = el.getAttribute(name);
      if (value) out[name] = clean(value, 400);
    }
    return out;
  }

  function nodeInfo(el) {
    if (!(el instanceof Element)) return null;
    const root = el.getRootNode?.();
    return {
      tag: el.tagName.toLowerCase(),
      attrs: attrsOf(el),
      rect: rectOf(el),
      text: clean(el.innerText || el.textContent || '', 220),
      childCount: el.childElementCount,
      shadowRoot: el.shadowRoot ? 'open' : null,
      rootType: root instanceof ShadowRoot ? 'shadow-root' : root instanceof Document ? 'document' : root?.constructor?.name || null,
    };
  }

  function parentAcrossShadow(el) {
    if (!(el instanceof Element)) return null;
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode?.();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function ancestorChain(el, limit = 14) {
    const out = [];
    let current = el;
    while (current instanceof Element && out.length < limit) {
      out.push(nodeInfo(current));
      current = parentAcrossShadow(current);
    }
    return out;
  }

  function controlInfo(control) {
    return {
      ...nodeInfo(control),
      label: clean([
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
        control.getAttribute('data-tooltip-content'),
        control.getAttribute('data-testid'),
        control.innerText,
        control.textContent,
      ].filter(Boolean).join(' '), 300),
    };
  }

  function nearbyControls(el) {
    const seen = new Set();
    const controls = [];
    let current = el;

    for (let depth = 0; current instanceof Element && depth < 8; depth += 1) {
      const candidates = current.querySelectorAll?.('button,[role="button"],[aria-label],[title],[data-testid]') || [];
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement) || seen.has(candidate)) continue;
        const label = clean([
          candidate.getAttribute('aria-label'),
          candidate.getAttribute('title'),
          candidate.getAttribute('data-tooltip-content'),
          candidate.getAttribute('data-testid'),
          candidate.innerText,
          candidate.textContent,
        ].filter(Boolean).join(' '), 300);
        if (!/copy|edit|download|open|writing|artifact|canvas/i.test(label)) continue;
        seen.add(candidate);
        controls.push(controlInfo(candidate));
        if (controls.length >= 30) return controls;
      }
      current = parentAcrossShadow(current);
    }

    return controls;
  }

  function shadowSummary(el) {
    const out = [];
    let current = el;
    for (let depth = 0; current instanceof Element && depth < 10; depth += 1) {
      if (current.shadowRoot) {
        out.push({
          host: nodeInfo(current),
          descendants: Array.from(current.shadowRoot.querySelectorAll('*')).slice(0, 80).map(nodeInfo),
        });
      }
      current = parentAcrossShadow(current);
    }
    return out;
  }

  function iframeProbe(frame, viewportX, viewportY) {
    if (!(frame instanceof HTMLIFrameElement)) return null;
    const info = { frame: nodeInfo(frame) };
    try {
      const doc = frame.contentDocument;
      if (!doc) {
        info.access = 'no-content-document';
        return info;
      }
      const rect = frame.getBoundingClientRect();
      const x = viewportX - rect.left;
      const y = viewportY - rect.top;
      const inner = doc.elementFromPoint(x, y);
      info.access = 'same-origin';
      info.innerPoint = { x: Math.round(x), y: Math.round(y) };
      info.innerTarget = nodeInfo(inner);
      info.innerAncestors = ancestorChain(inner, 12);
      return info;
    } catch (error) {
      info.access = 'cross-origin-or-blocked';
      info.error = clean(error?.message || error, 300);
      return info;
    }
  }

  function makeReport(x, y) {
    const stack = document.elementsFromPoint(x, y).filter((el) => el !== banner && el !== veil);
    const target = stack[0] || null;
    const iframe = stack.find((el) => el instanceof HTMLIFrameElement) || (target instanceof HTMLIFrameElement ? target : null);

    return {
      probeVersion: '0.1.0',
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      point: { x: Math.round(x), y: Math.round(y) },
      target: nodeInfo(target),
      stack: stack.slice(0, 12).map(nodeInfo),
      ancestors: ancestorChain(target, 16),
      nearbyControls: nearbyControls(target),
      shadowSummary: shadowSummary(target),
      iframe: iframeProbe(iframe, x, y),
    };
  }

  function copyReport(report) {
    const text = `${PREFIX} ${JSON.stringify(report, null, 2)}`;
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return;
    }
    void navigator.clipboard.writeText(text);
  }

  function cleanup() {
    armed = false;
    veil?.remove();
    banner?.remove();
    veil = null;
    banner = null;
  }

  function showResult(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      left: '50%',
      top: '18px',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      padding: '9px 14px',
      borderRadius: '9px',
      background: 'rgba(20,20,20,.96)',
      color: '#fff',
      font: '600 13px system-ui,sans-serif',
      boxShadow: '0 3px 14px rgba(0,0,0,.25)',
      pointerEvents: 'none',
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  }

  function arm() {
    if (armed) return;
    armed = true;

    banner = document.createElement('div');
    banner.textContent = 'Sticky Copy Probe armed — click anywhere inside the NEW writing block';
    Object.assign(banner.style, {
      position: 'fixed',
      left: '50%',
      top: '18px',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      padding: '9px 14px',
      borderRadius: '9px',
      background: 'rgba(20,20,20,.96)',
      color: '#fff',
      font: '600 13px system-ui,sans-serif',
      boxShadow: '0 3px 14px rgba(0,0,0,.25)',
      pointerEvents: 'none',
    });

    veil = document.createElement('div');
    Object.assign(veil.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      cursor: 'crosshair',
      background: 'transparent',
    });

    veil.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const x = event.clientX;
      const y = event.clientY;
      cleanup();
      requestAnimationFrame(() => {
        const report = makeReport(x, y);
        copyReport(report);
        console.info(PREFIX, report);
        showResult('Writing-block probe copied to clipboard');
      });
    }, { once: true, capture: true });

    document.body.append(veil, banner);
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Arm writing-block probe', arm);
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && armed) cleanup();
  }, true);
})();
