'use strict';

// Lightweight chat-only decoration: no transcript reads, favicon changes,
// polling, networking, storage, or access to the response-status lifecycle.
// This runs on chat routes even when the conversation is idle.
(() => {
  if (globalThis.__chatgptConversationTitleColorInstalled) return;
  globalThis.__chatgptConversationTitleColorInstalled = true;

  const palette = new Set([
    '🟥', '🟧', '🟨', '🟩', '🟦', '🟪',
    '🔴', '🟠', '🟡', '🟢', '🔵', '🟣'
  ]);
  const MAX_WRITES_PER_MINUTE = 24;
  let started = Date.now();
  let writes = 0;
  let lastMarker = null;
  let titleObserver = null;

  function stripMarker(value) {
    const separator = value.indexOf(' ');
    const marker = separator < 0 ? '' : value.slice(0, separator);
    return palette.has(marker) ? value.slice(separator + 1) : value;
  }

  function applyTitleColor() {
    const api = globalThis.ChatGPTConversationColor;
    if (!api) return;
    const color = api.fromUrl(location.href);
    const current = document.title;
    if (!current) return;
    const original = stripMarker(current);
    const desired = color ? color.emoji + ' ' + original : original;
    if (desired === current) {
      lastMarker = color?.emoji || null;
      return;
    }
    // A route transition out of a chat removes only the prefix this
    // script previously wrote; never decorate the ChatGPT homepage.
    if (!color && !lastMarker) return;

    const now = Date.now();
    if (now - started >= 60000) {
      started = now;
      writes = 0;
    }
    if (++writes > MAX_WRITES_PER_MINUTE) {
      // Bound pathological page-title churn; no retry timer.
      titleObserver?.disconnect();
      titleObserver = null;
      return;
    }
    document.title = desired;
    lastMarker = color?.emoji || null;
  }

  function start() {
    applyTitleColor();
    // Observe ONLY the page's <title> element, not <head> or the page DOM.
    // React can replace document.title after document_idle; observing this
    // one tiny node keeps the visible marker while remaining bounded.
    const element = document.head?.querySelector('title');
    if (element && typeof MutationObserver === 'function') {
      titleObserver = new MutationObserver(applyTitleColor);
      titleObserver.observe(element, {
        childList: true, characterData: true, subtree: true
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
  window.addEventListener('focus', applyTitleColor);
  window.addEventListener('pageshow', applyTitleColor);
  window.addEventListener('popstate', applyTitleColor);
  document.addEventListener('visibilitychange', applyTitleColor);
  // Handles ChatGPT's History API SPA URL promotion without intercepting
  // or monkey-patching History.pushState / replaceState.
  if (window.navigation?.addEventListener) {
    window.navigation.addEventListener('currententrychange', applyTitleColor);
  }
})();
