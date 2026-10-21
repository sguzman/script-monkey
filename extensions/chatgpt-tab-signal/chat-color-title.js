'use strict';

// One owner for the tab's visible identity: a stable color favicon and a
// temporary status emoji in <title>. No head/page-wide observers or polling.
(() => {
  if (globalThis.__chatgptConversationTitleColorInstalled) return;
  globalThis.__chatgptConversationTitleColorInstalled = true;

  const STATUS = Object.freeze({
    idle: '', generating: '⏳', unread: '🔔', finished: '✅',
    error: '⚠️', limit: '🛑'
  });
  const PREFIX = /^(?:(?:⏳|🔔|✅|⚠️|🛑|🟥|🟧|🟨|🟩|🟦|🟪|🔴|🟠|🟡|🟢|🔵|🟣) )+/u;
  const MAX_WRITES_PER_MINUTE = 24;
  const MAX_ICON_WRITES_PER_MINUTE = 48;
  const ALERT_SELECTOR = [
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
  let started = Date.now(), titleWrites = 0, iconWrites = 0;
  let titleObserver = null;

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
    if (iconKey !== color.key) {
      restoreIcon();
      iconUrl = coloredPng(color);
      iconKey = color.key;
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

  function syncTab() {
    const api = globalThis.ChatGPTConversationColor;
    const color = api?.fromUrl(location.href) || null;
    if (lastChatKey && color?.key !== lastChatKey) status = 'idle';
    lastChatKey = color?.key || null;
    updateFavicon(color);

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
    // This selector runs only at activation, focus, response completion, or
    // error. It never scans transcripts or runs once per streamed token.
    const matches = document.querySelectorAll(ALERT_SELECTOR);
    let checked = 0;
    for (const element of matches) {
      if (++checked > 36) break;
      if (element.closest?.(
        '[data-message-author-role], [data-testid^="conversation-turn"], article, pre, code'
      )) continue;
      const message = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!message || message.length > 320) continue;
      if (/you.ve reached the maximum length for this conversation|maximum conversation length|conversation (?:has )?(?:reached|exceeded) (?:its |the )?(?:length |message )?limit/i.test(message)) {
        return 'limit';
      }
      if (/message delivery timed out|network error|network connection|something went wrong|please try again|failed to (?:send|load|generate)|unable to (?:send|load)|request failed|error generating/i.test(message)) {
        return 'error';
      }
    }
    return null;
  }

  // Only installed in the extension's isolated world, not exposed as a
  // privileged control in the page's main JavaScript environment.
  globalThis.__chatgptTabSignalSetStatus = setStatus;
  globalThis.__chatgptTabSignalDetectError = detectVisibleError;
  globalThis.__chatgptTabSignalStripTitle = stripPrefix;

  function activate() {
    syncTab();
    const found = detectVisibleError();
    if (found) setStatus(found);
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
    syncTab();
    if (status !== 'generating') {
      const found = detectVisibleError();
      if (found) setStatus(found);
    }
  }
  window.addEventListener('focus', onFocusOrNavigation);
  window.addEventListener('pageshow', onFocusOrNavigation);
  window.addEventListener('popstate', onFocusOrNavigation);
  document.addEventListener('visibilitychange', onFocusOrNavigation);
  if (window.navigation?.addEventListener) {
    window.navigation.addEventListener('currententrychange', onFocusOrNavigation);
  }
})();
