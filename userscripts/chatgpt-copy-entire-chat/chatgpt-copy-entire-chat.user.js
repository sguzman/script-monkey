// ==UserScript==
// @name         ChatGPT Copy Entire Chat
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.2.0
// @description  Copy the full current ChatGPT conversation, including turns that ChatGPT virtualizes out of the DOM.
// @author       Salvador Guzman
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    stepSettleMs: 90,
    topPollMs: 500,
    topBoundaryQuietMs: 2500,
    topUnprovenTimeoutMs: 120000,
    topNudgeAfterMs: 2500,
    topNudgePx: 320,
    topNudgePauseMs: 120,
    maxWalkSteps: 10000,
    debug: false,
  };

  const TURN_SELECTORS = [
    '[data-testid^="conversation-turn-"]',
    'article[data-testid^="conversation-turn-"]',
    '[data-message-author-role]',
  ];

  let running = false;

  const log = (...args) => {
    if (CONFIG.debug) console.debug('[chatgpt-copy-entire-chat]', ...args);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextPaint = () => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  function textOf(element) {
    return (element?.innerText || element?.textContent || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function getTurnElements() {
    for (const selector of TURN_SELECTORS) {
      const elements = [...document.querySelectorAll(selector)];
      if (!elements.length) continue;
      if (selector === '[data-message-author-role]') {
        return elements.filter((element) => (
          !element.parentElement?.closest('[data-message-author-role]')
        ));
      }
      return elements;
    }
    return [];
  }

  function parseTurnIndex(element) {
    const testId = (
      element.getAttribute('data-testid')
      || element.closest('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid')
    );
    const match = testId?.match(/conversation-turn-(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function roleOf(element) {
    const roleElement = element.matches?.('[data-message-author-role]')
      ? element
      : element.querySelector?.('[data-message-author-role]');
    const rawRole = (
      roleElement?.getAttribute('data-message-author-role')
      || element.getAttribute?.('data-message-author-role')
      || ''
    );
    if (rawRole === 'user') return 'USER';
    if (rawRole === 'assistant') return 'ASSISTANT';
    if (rawRole === 'system') return 'SYSTEM';
    if (rawRole === 'tool') return 'TOOL';
    const prefix = textOf(element).slice(0, 100).toLowerCase();
    if (prefix.startsWith('you said:')) return 'USER';
    if (prefix.startsWith('chatgpt said:')) return 'ASSISTANT';
    return 'UNKNOWN';
  }

  function contentElement(element) {
    const roleElement = element.matches?.('[data-message-author-role]')
      ? element
      : element.querySelector?.('[data-message-author-role]');
    if (roleElement) {
      const candidates = [
        roleElement.querySelector('[data-message-content]'),
        roleElement.querySelector('.markdown'),
        roleElement.querySelector('[class*="markdown"]'),
        roleElement,
      ].filter(Boolean);
      for (const candidate of candidates) {
        if (textOf(candidate)) return candidate;
      }
    }
    return element;
  }

  function findScrollContainer() {
    const firstTurn = getTurnElements()[0];
    let node = firstTurn || document.querySelector('main') || document.body;
    for (let element = node; element && element !== document.documentElement; element = element.parentElement) {
      const style = getComputedStyle(element);
      const canScroll = (
        ['auto', 'scroll', 'overlay'].includes(style.overflowY)
        && element.scrollHeight > element.clientHeight + 50
      );
      if (canScroll) return element;
    }
    return document.scrollingElement || document.documentElement;
  }

  function isDocumentScroller(scroller) {
    return (
      scroller === document.scrollingElement
      || scroller === document.documentElement
      || scroller === document.body
    );
  }

  function currentScrollTop(scroller) {
    if (isDocumentScroller(scroller)) {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
    return scroller.scrollTop;
  }

  function maxScrollTop(scroller) {
    if (isDocumentScroller(scroller)) {
      const root = document.scrollingElement || document.documentElement;
      return Math.max(0, root.scrollHeight - window.innerHeight);
    }
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  function viewportHeight(scroller) {
    return isDocumentScroller(scroller) ? window.innerHeight : scroller.clientHeight;
  }

  function setScrollTop(scroller, y) {
    if (isDocumentScroller(scroller)) {
      window.scrollTo({ top: y, behavior: 'instant' });
      return;
    }
    scroller.scrollTop = y;
  }

  function stableIdFor(element, role, text, scroller) {
    const turnIndex = parseTurnIndex(element);
    if (turnIndex !== null) return `turn:${turnIndex}`;
    const messageId = (
      element.getAttribute('data-message-id')
      || element.querySelector?.('[data-message-id]')?.getAttribute('data-message-id')
    );
    if (messageId) return `message:${messageId}`;
    const rect = element.getBoundingClientRect();
    const approximateY = Math.round(rect.top + currentScrollTop(scroller));
    return `fallback:${role}:${hashString(text)}:${approximateY}`;
  }

  function captureMounted(store, scroller) {
    const elements = getTurnElements();
    for (const element of elements) {
      const role = roleOf(element);
      const text = textOf(contentElement(element))
        .replace(/^You said:\s*/i, '')
        .replace(/^ChatGPT said:\s*/i, '')
        .trim();
      if (!text) continue;
      const turnIndex = parseTurnIndex(element);
      const id = stableIdFor(element, role, text, scroller);
      const existing = store.get(id);
      if (!existing || text.length > existing.text.length) {
        store.set(id, {
          id,
          index: turnIndex,
          role,
          text,
          seenOrder: existing?.seenOrder ?? store.size,
        });
      }
    }
    return elements.length;
  }

  function minCapturedIndex(store) {
    const indexes = [...store.values()]
      .map((entry) => entry.index)
      .filter(Number.isFinite);
    return indexes.length ? Math.min(...indexes) : null;
  }

  function maxCapturedIndex(store) {
    const indexes = [...store.values()]
      .map((entry) => entry.index)
      .filter(Number.isFinite);
    return indexes.length ? Math.max(...indexes) : null;
  }

  function oldestBoundaryProven(store) {
    const first = minCapturedIndex(store);
    return first !== null && first <= 1;
  }

  function makeStatus() {
    const element = document.createElement('div');
    Object.assign(element.style, {
      position: 'fixed',
      right: '18px',
      bottom: '18px',
      zIndex: '2147483647',
      maxWidth: '390px',
      padding: '10px 12px',
      borderRadius: '10px',
      background: 'rgba(20,20,20,.92)',
      color: 'white',
      font: '13px/1.35 system-ui, sans-serif',
      boxShadow: '0 4px 20px rgba(0,0,0,.35)',
      whiteSpace: 'pre-wrap',
      pointerEvents: 'none',
    });
    element.textContent = 'Preparing transcript…';
    document.documentElement.appendChild(element);
    return element;
  }

  async function nudgeTopBoundary(scroller, store) {
    const nudge = Math.min(CONFIG.topNudgePx, Math.max(0, maxScrollTop(scroller)));
    if (nudge <= 0) return;
    setScrollTop(scroller, nudge);
    await nextPaint();
    await sleep(CONFIG.topNudgePauseMs);
    captureMounted(store, scroller);
    setScrollTop(scroller, 0);
    await nextPaint();
  }

  async function loadOldestHistory(scroller, store, status) {
    const startedAt = performance.now();
    let lastProgressAt = startedAt;
    let lastNudgeAt = startedAt;
    let previousMin = minCapturedIndex(store);
    let previousSize = store.size;

    setScrollTop(scroller, 0);
    await nextPaint();

    while (true) {
      await sleep(CONFIG.topPollMs);
      setScrollTop(scroller, 0);
      await nextPaint();
      captureMounted(store, scroller);

      const now = performance.now();
      const currentMin = minCapturedIndex(store);
      const progressed = currentMin !== previousMin || store.size !== previousSize;

      if (progressed) {
        lastProgressAt = now;
        previousMin = currentMin;
        previousSize = store.size;
        log('Older-history progress', { currentMin, captured: store.size });
      }

      const proven = oldestBoundaryProven(store);
      const quietMs = now - lastProgressAt;
      const elapsedMs = now - startedAt;

      status.textContent = (
        `Loading oldest history…\nCaptured: ${store.size}`
        + (currentMin !== null ? `  first index: ${currentMin}` : '')
        + (proven ? '\nBeginning found; confirming stability…' : '\nWaiting for earlier turns…')
      );

      if (proven && quietMs >= CONFIG.topBoundaryQuietMs) {
        return;
      }

      if (!proven && now - lastNudgeAt >= CONFIG.topNudgeAfterMs) {
        await nudgeTopBoundary(scroller, store);
        lastNudgeAt = performance.now();
      }

      if (!proven && elapsedMs >= CONFIG.topUnprovenTimeoutMs) {
        throw new Error(
          `Could not prove the beginning of the conversation was loaded. `
          + `Earliest captured turn index: ${currentMin ?? 'unknown'}. `
          + 'Nothing was copied because the transcript may be incomplete.'
        );
      }
    }
  }

  async function walkToBottom(scroller, store, status) {
    let steps = 0;
    let noProgress = 0;
    let previousY = -1;

    while (steps < CONFIG.maxWalkSteps) {
      steps += 1;
      captureMounted(store, scroller);

      const y = currentScrollTop(scroller);
      const maxY = maxScrollTop(scroller);
      const viewHeight = Math.max(250, viewportHeight(scroller));
      const target = Math.min(maxY, y + Math.max(200, viewHeight * 0.78));

      status.textContent = (
        `Walking through conversation…\nCaptured: ${store.size}`
        + (maxCapturedIndex(store) !== null
          ? `  last index: ${maxCapturedIndex(store)}`
          : '')
      );

      if (maxY - y < 4) {
        await sleep(250);
        captureMounted(store, scroller);
        const newMax = maxScrollTop(scroller);
        if (newMax - currentScrollTop(scroller) < 4) break;
      }

      setScrollTop(scroller, target);
      await nextPaint();
      await sleep(CONFIG.stepSettleMs);

      const newY = currentScrollTop(scroller);
      if (Math.abs(newY - previousY) < 1) noProgress += 1;
      else noProgress = 0;
      previousY = newY;
      if (noProgress > 10) break;
    }

    captureMounted(store, scroller);
  }

  function orderedEntries(store) {
    const entries = [...store.values()];
    const indexed = entries.filter((entry) => Number.isFinite(entry.index));
    const unindexed = entries.filter((entry) => !Number.isFinite(entry.index));
    indexed.sort((a, b) => a.index - b.index);
    unindexed.sort((a, b) => a.seenOrder - b.seenOrder);
    return [...indexed, ...unindexed];
  }

  function buildTranscript(entries) {
    const title = document.title.replace(/\s*[-–—]\s*ChatGPT\s*$/i, '').trim();
    const header = [
      title ? `# ${title}` : '# ChatGPT Conversation',
      '',
      `Source: ${location.href}`,
      `Copied: ${new Date().toLocaleString()}`,
      '',
    ].join('\n');
    const body = entries.map((entry) => (
      `## ${entry.role}\n\n${entry.text}`
    )).join('\n\n---\n\n');
    return `${header}${body}\n`;
  }

  async function copyEntireChat() {
    if (running) return;
    running = true;

    const status = makeStatus();
    const store = new Map();

    try {
      if (!getTurnElements().length) {
        throw new Error('No ChatGPT conversation turns were found on this page.');
      }

      const scroller = findScrollContainer();
      const originalY = currentScrollTop(scroller);
      const originalMax = Math.max(1, maxScrollTop(scroller));
      const originalRatio = originalY / originalMax;
      const startedNearBottom = (
        originalMax - originalY
        < Math.max(500, viewportHeight(scroller) * 1.2)
      );

      captureMounted(store, scroller);
      await loadOldestHistory(scroller, store, status);

      setScrollTop(scroller, 0);
      await nextPaint();
      await sleep(CONFIG.stepSettleMs);
      await walkToBottom(scroller, store, status);

      if (!oldestBoundaryProven(store)) {
        throw new Error('The beginning of the conversation was lost before copy; refusing incomplete output.');
      }

      const entries = orderedEntries(store);
      if (!entries.length) {
        throw new Error('Turns were found, but no transcript text could be extracted.');
      }

      const transcript = buildTranscript(entries);
      GM_setClipboard(transcript, 'text');

      const finalMax = maxScrollTop(scroller);
      if (startedNearBottom) setScrollTop(scroller, finalMax);
      else setScrollTop(scroller, Math.round(finalMax * originalRatio));

      status.textContent = (
        `Copied entire chat.\n${entries.length} turns • `
        + `${transcript.length.toLocaleString()} characters`
      );
      log('Copied transcript', { entries: entries.length, characters: transcript.length });
      setTimeout(() => status.remove(), 3200);
    } catch (error) {
      console.error('[chatgpt-copy-entire-chat]', error);
      status.textContent = `Copy failed:\n${error?.message || String(error)}`;
      setTimeout(() => status.remove(), 9000);
    } finally {
      running = false;
    }
  }

  GM_registerMenuCommand('Copy entire current ChatGPT chat', copyEntireChat);

  Object.defineProperty(window, 'copyEntireChatGPTChat', {
    value: copyEntireChat,
    configurable: true,
  });
})();
