'use strict';

// One owner for the tab's visible identity: a stable color favicon and a
// temporary status emoji in <title>. No head/page-wide observers or polling.
(() => {
  if (globalThis.__chatgptConversationTitleColorInstalled) return;
  globalThis.__chatgptConversationTitleColorInstalled = true;

  const STATUS = Object.freeze({
    idle: '', generating: '⏳', unread: '🔔', finished: '✅',
    interrupted: '🔌', error: '⚠️', limit: '🛑',
    response_load_failed: '❌', conversation_load_failed: '🚫'
  });
  const PREFIX = /^(?:(?:⏳|🔔|✅|⚠️|🛑|🔌|❌|🚫|🟥|🟧|🟨|🟩|🟦|🟪|🔴|🟠|🟡|🟢|🔵|🟣) )+/u;
  const MAX_WRITES_PER_MINUTE = 24;
  const MAX_ICON_WRITES_PER_MINUTE = 48;
  const ALERT_SELECTOR = [
    '[role="status"]', '[data-testid*="connection"]',
    '[data-testid*="interrupt"]', '[data-testid*="status"]',
    '[role="alert"]', '[data-testid*="error"]', '[data-testid*="toast"]',
    '[class*="text-red"]', '[class*="border-red"]',
    '[class*="bg-red"]', '[class*="text-danger"]'
  ].join(',');
  const originals = new Map();
  let fallbackIcon = null;
  let status = 'idle';
  let iconKey = '';
  let iconUrl = '';
  let lastChatKey = null;
  let requestedKey = null;
  let resolvedColor = null;
  let started = Date.now(), titleWrites = 0, iconWrites = 0;
  let titleObserver = null;
  // Stable DOM-only read API for independent scripts, without exposing
  // privileged extension messages, browser IDs or conversation text.
  const PUBLIC_CHANGE_EVENT = 'chatgpt-tab-signal-change';
  let publishedSnapshot = '';
  const FAILURE_PROBE_DELAYS_MS = [2000, 7000];

  function stripPrefix(title) { return String(title || '').replace(PREFIX, ''); }

  function applyAttribute(node, name, value) {
    if (value === null) {
      if (node.hasAttribute(name)) node.removeAttribute(name);
    } else if (node.getAttribute(name) !== value) {
      node.setAttribute(name, value);
    }
  }

  function faviconLinks() {
    return document.head ? [...document.head.querySelectorAll('link[rel~="icon"]')] : [];
  }

  function restoreIcon() {
    for (const [link, original] of originals) {
      if (!link.isConnected || link.getAttribute('href') !== iconUrl) continue;
      applyAttribute(link, 'href', original.href);
      applyAttribute(link, 'type', original.type);
      applyAttribute(link, 'sizes', original.sizes);
    }
    originals.clear();
    if (fallbackIcon?.isConnected) fallbackIcon.remove();
    fallbackIcon = null;
    iconKey = '';
    iconUrl = '';
  }

  function coloredPng(color) {
    // PNG, not SVG: actual Chrome/Edge tab-strip rendering has been
    // tested with PNG favicons. Canvas is used once per conversation key.
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = color.hex;
    if (color.kind === 'project') {
      ctx.beginPath();
      ctx.arc(16, 16, 13, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(3, 3, 26, 26);
    }
    return canvas.toDataURL('image/png');
  }

  function updateFavicon(color) {
    if (!color) { restoreIcon(); return; }
    if (!document.head) return;
    if (iconKey !== color.key + '|' + color.hex) {
      restoreIcon();
      iconUrl = coloredPng(color);
      iconKey = color.key + '|' + color.hex;
    }
    if (!iconUrl) return;
    const now = Date.now();
    if (now - started >= 60000) {
      started = now;
      titleWrites = 0;
      iconWrites = 0;
    }
    let links = faviconLinks();
    if (links.length === 0) {
      if (!fallbackIcon) {
        fallbackIcon = document.createElement('link');
        fallbackIcon.rel = 'icon';
        fallbackIcon.dataset.chatgptTabSignal = 'true';
        document.head.appendChild(fallbackIcon);
      }
      links = [fallbackIcon];
    }
    for (const link of links) {
      if (link.getAttribute('href') === iconUrl) continue;
      if (++iconWrites > MAX_ICON_WRITES_PER_MINUTE) return;
      if (link !== fallbackIcon) {
        originals.set(link, {
          href: link.getAttribute('href'),
          type: link.getAttribute('type'),
          sizes: link.getAttribute('sizes')
        });
      }
      applyAttribute(link, 'type', 'image/png');
      applyAttribute(link, 'sizes', '32x32');
      applyAttribute(link, 'href', iconUrl);
    }
  }

  function requestDistinctColor(color) {
    if (requestedKey === color?.key) return;
    requestedKey = color?.key || null;
    resolvedColor = null;
    if (document.documentElement?.dataset) {
      delete document.documentElement.dataset.chatgptTabSignalColorResolved;
    }
    if (!color) {
      // Releasing an abandoned chat makes its swatch available for reuse.
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({type:'CHATGPT_TAB_COLOR_RELEASE'}).catch(() => {});
      }
      if (document.documentElement?.style) {
        document.documentElement.style.removeProperty('--chatgpt-tab-signal-identity-hex-v2');
      }
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({type:'CHATGPT_TAB_COLOR_REQUEST'}).then(response => {
      if (!response || response.key !== requestedKey ||
          !/^#[0-9a-f]{6}$/.test(response.hex)) return;
      resolvedColor = {key: response.key, hex: response.hex};
      if (document.documentElement?.dataset) {
        document.documentElement.dataset.chatgptTabSignalColorResolved = 'v2';
      }
      syncTab();
    }).catch(() => {
      // A worker suspension must not blank the identity or page title.
      // The independent deterministic fallback remains visible.
    });
  }

  function publishPublicState(color) {
    const root = document.documentElement;
    if (!root?.dataset) return;
    // Compare with the last published snapshot, not DOM attributes:
    // assignment may update the readiness attribute before syncTab runs.
    root.dataset.chatgptTabSignalApiVersion = '1';
    root.dataset.chatgptTabSignalState = color ? status : 'idle';
    if (color) root.dataset.chatgptTabSignalColor = color.hex;
    else delete root.dataset.chatgptTabSignalColor;
    const after = [root.dataset.chatgptTabSignalState || '',
      root.dataset.chatgptTabSignalColor || '',
      root.dataset.chatgptTabSignalColorResolved || ''].join('|');
    if (publishedSnapshot !== after) {
      publishedSnapshot = after;
      if (typeof Event === 'function') {
        // DOM events cross isolated worlds; only public attributes are read.
        root.dispatchEvent?.(new Event(PUBLIC_CHANGE_EVENT));
      }
    }
  }

  function exposePublicColor(hex) {
    // Non-privileged, read-only identity for other extensions/page scripts;
    // never expose chat IDs, callbacks, tokens, or extension storage.
    if (document.documentElement?.style) {
      const style = document.documentElement.style;
      if (style.getPropertyValue('--chatgpt-tab-signal-identity-hex-v2') !== hex) {
        style.setProperty('--chatgpt-tab-signal-identity-hex-v2', hex);
      }
    }
  }

  function syncTab() {
    const api = globalThis.ChatGPTConversationColor;
    const identity = api?.assignFromUrl(location.href, []) || api?.fromUrl(location.href) || null;
    if (lastChatKey && identity?.key !== lastChatKey) status = 'idle';
    lastChatKey = identity?.key || null;
    requestDistinctColor(identity);
    const color = identity && resolvedColor?.key === identity.key
      ? {...identity, hex: resolvedColor.hex} : identity;
    updateFavicon(color);
    if (color) exposePublicColor(color.hex);
    publishPublicState(color);

    const current = document.title;
    if (!current) return;
    const clean = stripPrefix(current);
    const desired = color && STATUS[status] ? STATUS[status] + ' ' + clean : clean;
    if (current === desired) return;
    const now = Date.now();
    if (now - started >= 60000) {
      started = now;
      titleWrites = 0;
      iconWrites = 0;
    }
    if (++titleWrites > MAX_WRITES_PER_MINUTE) {
      titleObserver?.disconnect();
      titleObserver = null;
      return;
    }
    document.title = desired;
  }

  function setStatus(next) {
    if (!Object.hasOwn(STATUS, next) || status === next) return;
    status = next;
    syncTab();
  }

  function detectVisibleError() {
    if (!document.querySelectorAll) return null;

    // Fatal page-load screen: it is sometimes a neutral heading or short
    // container rather than a red [role=alert]. Only inspect this fallback
    // when no conversation turns are mounted; never scan transcript text.
    const hasTurns = document.querySelector?.(
      '[data-message-author-role], [data-testid^="conversation-turn"]');
    if (!hasTurns) {
      const pageFailures = document.querySelectorAll([
        'main h1', 'main h2', 'main h3', 'main > div',
        '[role="main"] h1', '[role="main"] h2',
        '[role="alert"]', '[role="status"]',
        '[data-testid*="conversation-error"]'
      ].join(','));
      let inspected = 0;
      for (const node of pageFailures) {
        if (++inspected > 32) break;
        if (typeof node.getClientRects === 'function' &&
            node.getClientRects().length === 0) continue;
        const message = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (message.length <= 96 &&
            /^could not load this chatgpt conversation(?:\s+retry)?[.!]?$/i.test(message)) {
          return 'conversation_load_failed';
        }
      }
    }

    // Response placeholders appear inside assistant turns. Only inspect the
    // most recent assistant element, and only match an almost empty
    // message with exact diagnostic wording. Earlier quoted discussion and
    // user messages are not interpreted as live failures.
    const assistants = document.querySelectorAll('[data-message-author-role="assistant"]');
    for (let i = assistants.length - 1; i >= Math.max(0, assistants.length - 1); i--) {
      const node = assistants[i];
      if (typeof node.getClientRects === 'function' &&
          node.getClientRects().length === 0) continue;
      const message = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (message.length <= 128 &&
          /^this response couldn.t load(?:[.!]|\s+retry|\s+regenerate)?$/i.test(message)) {
        return 'response_load_failed';
      }
    }
    // Only explicitly recognized messages count as a page error. A CSS
    // class or color is NEVER evidence that a request failed: ChatGPT can
    // reuse red styles for benign UI, and false positives would suppress
    // the user's completion notification and chime.
    const matches = document.querySelectorAll(ALERT_SELECTOR);
    let checked = 0;
    let genericErrorSeen = false;
    let interruptionSeen = false;
    for (const element of matches) {
      if (++checked > 36) break;
      const inTranscript = element.closest?.(
        '[data-message-author-role], [data-testid^="conversation-turn"], article, pre, code'
      );
      if (inTranscript && !element.matches?.(
        '[role="status"], [data-testid*="connection"], [data-testid*="interrupt"]'
      )) continue;
      if (typeof element.getClientRects === 'function' &&
          element.getClientRects().length === 0) continue;
      const message = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!message || message.length > 320) continue;
      // Interruption signals waiting, not necessarily terminal failure.
      if (/^connection interrupted[.!]? waiting for the complete answer[.!]?$/i.test(message)) {
        interruptionSeen = true;
      }
      if (/^(?:you.ve reached the maximum length for this conversation|maximum conversation length(?: reached)?|(?:this |the )?conversation (?:has )?(?:reached|exceeded) (?:its |the )?(?:length |message )?limit)(?:\b|[,.!])/i.test(message)) {
        return 'limit';
      }
      if (/^(?:message delivery timed out|network error|network connection (?:lost|failed)|something went wrong|failed to (?:send|load|generate)(?:\b|[ .!])|unable to (?:send|load)|request failed|error generating)(?:\b|[ .!])/i.test(message)) {
        genericErrorSeen = true;
      }
    }
    return genericErrorSeen ? 'error' : interruptionSeen ? 'interrupted' : null;
  }

  // Only installed in the extension's isolated world, not exposed as a
  // privileged control in the page's main JavaScript environment.
  globalThis.__chatgptTabSignalSetStatus = setStatus;
  globalThis.__chatgptTabSignalDetectError = detectVisibleError;
  globalThis.__chatgptTabSignalStripTitle = stripPrefix;
  globalThis.__chatgptTabSignalGetIcon = () => lastChatKey ? iconUrl : '';

  const PAGE_FAILURE_STATES = new Set([
    'interrupted', 'response_load_failed', 'conversation_load_failed'
  ]);
  function reconcilePageFailure() {
    if (!lastChatKey) return;
    const found = detectVisibleError();
    // An explicit failed-load placeholder is decisive even without a POST.
    // Recovery can clear such a placeholder without becoming a success.
    if (found === 'limit' || PAGE_FAILURE_STATES.has(found)) {
      setStatus(found);
    } else if (PAGE_FAILURE_STATES.has(status)) {
      setStatus(found || 'idle');
    }
  }

  function activate() {
    syncTab();
    reconcilePageFailure();
    // Two bounded checks cover ChatGPT's delayed shell hydration. No
    // recurring poll or body-wide MutationObserver is installed.
    if (lastChatKey) {
      for (const delay of FAILURE_PROBE_DELAYS_MS) {
        setTimeout(() => {
          syncTab();
          reconcilePageFailure();
        }, delay);
      }
    }
    // The only permanent observer is on the tiny <title> node.
    const element = document.head?.querySelector('title');
    if (element && typeof MutationObserver === 'function') {
      titleObserver = new MutationObserver(syncTab);
      titleObserver.observe(element, {
        childList: true, characterData: true, subtree: true
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activate, { once: true });
  } else {
    activate();
  }
  function onFocusOrNavigation() {
    const previousKey = lastChatKey;
    syncTab();
    // Old error UI can remain momentarily mounted during SPA navigation.
    // Do not carry its status to a different chat or the homepage.
    if (!lastChatKey || previousKey !== lastChatKey) return;
    reconcilePageFailure();
  }
  window.addEventListener('focus', onFocusOrNavigation);
  window.addEventListener('pageshow', onFocusOrNavigation);
  window.addEventListener('popstate', onFocusOrNavigation);
  document.addEventListener('visibilitychange', onFocusOrNavigation);
  if (window.navigation?.addEventListener) {
    window.navigation.addEventListener('currententrychange', onFocusOrNavigation);
  }
})();
