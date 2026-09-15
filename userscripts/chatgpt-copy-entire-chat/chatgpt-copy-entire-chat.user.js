// ==UserScript==
// @name         ChatGPT Copy Entire Chat
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.3.0
// @description  Copy the full current ChatGPT conversation. API-first, DOM-enriched, scroll fallback.
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
    apiPageSize: 100,
    apiPageDelayMs: 200,
    apiMaxPages: 1000,
    apiRetries: 3,
    apiRetryBaseMs: 900,
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

  const UUID_RE =
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

  const HIDDEN_CONTENT_TYPES = new Set([
    'thoughts',
    'reasoning',
    'reasoning_recap',
    'model_editable_context',
    'user_editable_context',
    'tether_browsing_display',
    'tether_quote',
  ]);

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

  function cleanRenderedTurnText(text) {
    return text
      .replace(/^You said:\s*/i, '')
      .replace(/^ChatGPT said:\s*/i, '')
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

  function getConversationId() {
    const cMatch = location.pathname.match(/\/c\/([0-9a-fA-F-]{36})(?:\/|$)/);
    if (cMatch && UUID_RE.test(cMatch[1])) return cMatch[1];
    const anyMatch = location.pathname.match(UUID_RE);
    return anyMatch ? anyMatch[0] : null;
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
      element.getAttribute?.('data-testid')
      || element.closest?.('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid')
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

  function messageIdsInTurn(element) {
    const ids = new Set();
    const ownId = element.getAttribute?.('data-message-id');
    if (ownId) ids.add(ownId);
    for (const node of element.querySelectorAll?.('[data-message-id]') || []) {
      const id = node.getAttribute('data-message-id');
      if (id) ids.add(id);
    }
    return [...ids];
  }

  function captureMountedByMessageId() {
    const byId = new Map();
    for (const turn of getTurnElements()) {
      const role = roleOf(turn);
      if (role !== 'USER' && role !== 'ASSISTANT') continue;
      const text = cleanRenderedTurnText(textOf(contentElement(turn)));
      if (!text) continue;
      for (const id of messageIdsInTurn(turn)) {
        const existing = byId.get(id);
        if (!existing || text.length > existing.text.length) {
          byId.set(id, {
            id,
            role,
            text,
            turnIndex: parseTurnIndex(turn),
          });
        }
      }
    }
    return byId;
  }

  function findScrollContainer() {
    const firstTurn = getTurnElements()[0];
    let node = firstTurn || document.querySelector('main') || document.body;
    for (let element = node; element && element !== document.documentElement; element = element.parentElement) {
      const style = getComputedStyle(element);
      const overflowY = style.overflowY;
      const canScroll = (
        ['auto', 'scroll', 'overlay'].includes(overflowY)
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
      return (
        window.scrollY
        || document.documentElement.scrollTop
        || document.body.scrollTop
        || 0
      );
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
      element.getAttribute?.('data-message-id')
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
      if (role !== 'USER' && role !== 'ASSISTANT') continue;
      const body = contentElement(element);
      const text = cleanRenderedTurnText(textOf(body));
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

  function retryAfterMs(response) {
    const raw = response.headers.get('retry-after');
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
  }

  async function fetchWithRetry(url, options, status, label, allow404 = false) {
    let lastError = null;
    for (let attempt = 0; attempt <= CONFIG.apiRetries; attempt += 1) {
      let response;
      try {
        response = await fetch(url, options);
      } catch (error) {
        lastError = error;
        if (attempt >= CONFIG.apiRetries) break;
        const delay = CONFIG.apiRetryBaseMs * (2 ** attempt);
        status.textContent = (
          `${label}: network error\n`
          + `Retrying in ${(delay / 1000).toFixed(1)}s…`
        );
        await sleep(delay);
        continue;
      }

      if (allow404 && response.status === 404) return response;
      if (response.ok) return response;

      const retryable = response.status === 408
        || response.status === 425
        || response.status === 429
        || response.status >= 500;

      if (!retryable || attempt >= CONFIG.apiRetries) {
        throw new Error(`${label}: HTTP ${response.status}`);
      }

      const explicitDelay = retryAfterMs(response);
      const delay = explicitDelay ?? (CONFIG.apiRetryBaseMs * (2 ** attempt));
      status.textContent = (
        `${label}: HTTP ${response.status}\n`
        + `Retrying in ${(delay / 1000).toFixed(1)}s…`
      );
      await sleep(delay);
    }
    throw lastError || new Error(`${label}: request failed`);
  }

  async function getApiAuthHeaders(status) {
    status.textContent = 'Reading ChatGPT history from server…\nAuthenticating current tab session…';
    const response = await fetchWithRetry(
      '/api/auth/session',
      { credentials: 'include', headers: { Accept: 'application/json' } },
      status,
      'ChatGPT session',
    );
    const session = await response.json();
    const token = session?.accessToken || session?.access_token;
    if (!token) throw new Error('ChatGPT session did not expose an access token');
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  function extractPartText(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    const contentType = part.content_type || part.type || '';
    if (contentType === 'image_asset_pointer') return '[Image]';
    if (contentType === 'file_asset_pointer' || contentType === 'file') {
      const name = part.name || part.file_name || part.filename || 'file';
      return `[File: ${name}]`;
    }
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    return '';
  }

  function attachmentLines(message) {
    const attachments = message?.metadata?.attachments;
    if (!Array.isArray(attachments)) return [];
    const lines = [];
    for (const attachment of attachments) {
      if (!attachment || typeof attachment !== 'object') continue;
      const name = (
        attachment.name
        || attachment.file_name
        || attachment.filename
        || attachment.display_name
      );
      if (name) lines.push(`[Attachment: ${name}]`);
    }
    return [...new Set(lines)];
  }

  function apiMessageText(message) {
    const content = message?.content || {};
    const contentType = content.content_type || content.type || '';
    if (HIDDEN_CONTENT_TYPES.has(contentType)) return '';

    const pieces = [];
    if (Array.isArray(content.parts)) {
      for (const part of content.parts) {
        const text = extractPartText(part).trim();
        if (text) pieces.push(text);
      }
    } else if (typeof content.text === 'string') {
      pieces.push(content.text.trim());
    }

    const attachments = attachmentLines(message);
    const attachmentPrefix = attachments.filter((line) => (
      !pieces.some((piece) => piece.includes(line.slice(13, -1)))
    ));

    return [...attachmentPrefix, ...pieces]
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  function normalizeApiMessage(message) {
    if (!message || typeof message !== 'object') return null;
    const role = message.author?.role;
    if (role !== 'user' && role !== 'assistant') return null;
    if (message.weight === 0) return null;
    if (message.metadata?.is_visually_hidden_from_conversation) return null;
    if (message.metadata?.is_visually_hidden) return null;
    if (
      role === 'assistant'
      && message.recipient
      && message.recipient !== 'all'
      && message.recipient !== 'assistant'
    ) {
      return null;
    }
    const text = apiMessageText(message);
    if (!text) return null;
    return {
      id: message.id || null,
      role: role === 'user' ? 'USER' : 'ASSISTANT',
      text,
      createTime: message.create_time ?? null,
    };
  }

  function linearizeLegacyConversation(conversation) {
    const mapping = conversation?.mapping;
    const currentNode = conversation?.current_node;
    if (!mapping || typeof mapping !== 'object' || !currentNode) {
      throw new Error('legacy conversation response has no complete mapping/current_node');
    }

    const nodes = [];
    const seen = new Set();
    let nodeId = currentNode;
    let reachedRoot = false;
    while (nodeId) {
      if (seen.has(nodeId)) throw new Error('legacy conversation mapping contains a cycle');
      seen.add(nodeId);
      const node = mapping[nodeId];
      if (!node) throw new Error('legacy conversation mapping is truncated');
      if (node.message) nodes.push(node.message);
      if (node.parent == null) {
        reachedRoot = true;
        break;
      }
      nodeId = node.parent;
    }
    if (!reachedRoot) throw new Error('legacy conversation mapping did not reach its root');
    return nodes.reverse();
  }

  function coalesceAssistantEntries(entries) {
    const out = [];
    for (const entry of entries) {
      if (
        entry.role === 'ASSISTANT'
        && out.length
        && out[out.length - 1].role === 'ASSISTANT'
      ) {
        const previous = out[out.length - 1];
        previous.text = `${previous.text}\n\n${entry.text}`.trim();
        if (!previous.id) previous.id = entry.id;
        continue;
      }
      out.push({ ...entry });
    }
    return out;
  }

  function enrichApiEntriesFromMountedDom(entries) {
    const mounted = captureMountedByMessageId();
    let enriched = 0;
    for (const entry of entries) {
      if (!entry.id) continue;
      const dom = mounted.get(entry.id);
      if (!dom || dom.role !== entry.role || !dom.text) continue;
      entry.text = dom.text;
      enriched += 1;
    }
    return enriched;
  }

  async function fetchConversationFromApi(status) {
    const conversationId = getConversationId();
    if (!conversationId) throw new Error('current URL does not contain a conversation UUID');

    const headers = await getApiAuthHeaders(status);
    const base = (
      `/backend-api/conversations/${encodeURIComponent(conversationId)}`
      + `?include_has_versions=true&num_turns=${CONFIG.apiPageSize}`
    );

    status.textContent = 'Reading ChatGPT history from server…\nLoading newest history page…';
    let response = await fetchWithRetry(
      base,
      { credentials: 'include', headers },
      status,
      'Conversation API',
      true,
    );

    if (response.status === 404) {
      status.textContent = (
        'Current conversation endpoint unavailable.\n'
        + 'Trying legacy ChatGPT conversation endpoint…'
      );
      response = await fetchWithRetry(
        `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
        { credentials: 'include', headers },
        status,
        'Legacy conversation API',
      );
      const conversation = await response.json();
      const messages = linearizeLegacyConversation(conversation);
      const entries = coalesceAssistantEntries(
        messages.map(normalizeApiMessage).filter(Boolean),
      );
      if (!entries.length) throw new Error('legacy API returned no visible conversation messages');
      const enriched = enrichApiEntriesFromMountedDom(entries);
      return {
        entries,
        title: conversation.title || '',
        mode: 'legacy-api',
        pages: 1,
        rawMessageCount: messages.length,
        enriched,
      };
    }

    const firstPage = await response.json();
    if (!Array.isArray(firstPage.messages)) {
      if (firstPage.mapping && typeof firstPage.mapping === 'object') {
        const messages = linearizeLegacyConversation(firstPage);
        const entries = coalesceAssistantEntries(
          messages.map(normalizeApiMessage).filter(Boolean),
        );
        if (!entries.length) throw new Error('API mapping returned no visible messages');
        const enriched = enrichApiEntriesFromMountedDom(entries);
        return {
          entries,
          title: firstPage.title || '',
          mode: 'api-mapping',
          pages: 1,
          rawMessageCount: messages.length,
          enriched,
        };
      }
      throw new Error('conversation API response has neither messages nor mapping');
    }

    if (
      !firstPage.page_info
      || typeof firstPage.page_info.has_previous_page !== 'boolean'
    ) {
      throw new Error('conversation API did not provide usable pagination metadata');
    }

    let page = firstPage;
    let messages = firstPage.messages.slice();
    let pages = 1;
    const seenIds = new Set(
      messages.map((message) => message?.id).filter(Boolean),
    );

    while (page.page_info?.has_previous_page) {
      if (pages >= CONFIG.apiMaxPages) {
        throw new Error(`conversation API exceeded ${CONFIG.apiMaxPages} pages`);
      }
      const before = page.page_info.start_cursor;
      if (!before) throw new Error('conversation API says older history exists but has no start cursor');

      status.textContent = (
        'Reading ChatGPT history from server…\n'
        + `Loaded ${messages.length} messages across ${pages} page${pages === 1 ? '' : 's'}.\n`
        + 'Requesting older history…'
      );
      if (CONFIG.apiPageDelayMs) await sleep(CONFIG.apiPageDelayMs);

      const olderResponse = await fetchWithRetry(
        `${base}&before=${encodeURIComponent(before)}`,
        { credentials: 'include', headers },
        status,
        `Conversation page ${pages + 1}`,
      );
      const older = await olderResponse.json();

      if (
        !older.page_info
        || typeof older.page_info.has_previous_page !== 'boolean'
      ) {
        throw new Error(`conversation API page ${pages + 1} has invalid pagination metadata`);
      }
      if (!Array.isArray(older.messages) || !older.messages.length) {
        throw new Error(`conversation API page ${pages + 1} contains no messages`);
      }

      const additions = [];
      for (const message of older.messages) {
        const id = message?.id;
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);
        additions.push(message);
      }
      if (!additions.length) {
        throw new Error('conversation API pagination made no progress');
      }

      messages = additions.concat(messages);
      page = older;
      pages += 1;
    }

    if (page.page_info?.has_previous_page === true) {
      throw new Error('conversation API pagination ended without proving the oldest page');
    }

    const entries = coalesceAssistantEntries(
      messages.map(normalizeApiMessage).filter(Boolean),
    );
    if (!entries.length) throw new Error('conversation API returned no visible user/assistant messages');
    const enriched = enrichApiEntriesFromMountedDom(entries);

    return {
      entries,
      title: firstPage.title || '',
      mode: 'api',
      pages,
      rawMessageCount: messages.length,
      enriched,
    };
  }

  async function settleAtTrueTop(scroller, store, status) {
    const startedAt = Date.now();
    let lastProgressAt = Date.now();
    let lastNudgeAt = 0;
    let previousMin = minCapturedIndex(store);
    let previousSize = store.size;

    while (Date.now() - startedAt < CONFIG.topUnprovenTimeoutMs) {
      setScrollTop(scroller, 0);
      await nextPaint();
      await sleep(CONFIG.topPollMs);
      captureMounted(store, scroller);

      const minIndex = minCapturedIndex(store);
      const progressed = (
        store.size > previousSize
        || (
          Number.isFinite(minIndex)
          && (!Number.isFinite(previousMin) || minIndex < previousMin)
        )
      );

      if (progressed) {
        lastProgressAt = Date.now();
        previousMin = minIndex;
        previousSize = store.size;
      }

      const atKnownBeginning = Number.isFinite(minIndex) && minIndex <= 1;
      const quietFor = Date.now() - lastProgressAt;
      status.textContent = (
        'API unavailable — scrolling fallback.\n'
        + 'Waiting for earlier turns…\n'
        + `Captured: ${store.size}`
        + (minIndex !== null ? `  earliest turn: ${minIndex}` : '')
        + (atKnownBeginning ? '\nBeginning found; verifying…' : '')
      );

      if (atKnownBeginning && quietFor >= CONFIG.topBoundaryQuietMs) return;

      if (
        !atKnownBeginning
        && quietFor >= CONFIG.topNudgeAfterMs
        && Date.now() - lastNudgeAt >= CONFIG.topNudgeAfterMs
      ) {
        const nudge = Math.min(CONFIG.topNudgePx, Math.max(0, maxScrollTop(scroller)));
        if (nudge > 0) {
          setScrollTop(scroller, nudge);
          await nextPaint();
          await sleep(CONFIG.topNudgePauseMs);
          setScrollTop(scroller, 0);
        }
        lastNudgeAt = Date.now();
      }
    }

    throw new Error(
      'Scrolling fallback could not prove it reached the beginning of the conversation. '
      + 'Nothing was copied.',
    );
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
        'API unavailable — scrolling fallback.\n'
        + `Walking conversation… Captured: ${store.size}`
        + (maxCapturedIndex(store) !== null
          ? `  latest turn: ${maxCapturedIndex(store)}`
          : '')
      );

      if (maxY - y < 4) {
        await sleep(500);
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

  function orderedScrollEntries(store) {
    const entries = [...store.values()];
    const indexed = entries.filter((entry) => Number.isFinite(entry.index));
    const unindexed = entries.filter((entry) => !Number.isFinite(entry.index));
    indexed.sort((a, b) => a.index - b.index);
    unindexed.sort((a, b) => a.seenOrder - b.seenOrder);
    return [...indexed, ...unindexed];
  }

  async function fetchConversationByScrolling(status) {
    if (!getTurnElements().length) {
      throw new Error('No ChatGPT conversation turns were found on this page.');
    }

    const store = new Map();
    const scroller = findScrollContainer();
    const originalY = currentScrollTop(scroller);
    const originalMax = Math.max(1, maxScrollTop(scroller));
    const originalRatio = originalY / originalMax;
    const startedNearBottom = (
      originalMax - originalY
      < Math.max(500, viewportHeight(scroller) * 1.2)
    );

    captureMounted(store, scroller);
    await settleAtTrueTop(scroller, store, status);
    setScrollTop(scroller, 0);
    await nextPaint();
    await sleep(CONFIG.stepSettleMs);
    await walkToBottom(scroller, store, status);

    const entries = orderedScrollEntries(store);
    if (!entries.length) {
      throw new Error('Scrolling fallback found turns but extracted no transcript text.');
    }

    const finalMax = maxScrollTop(scroller);
    if (startedNearBottom) setScrollTop(scroller, finalMax);
    else setScrollTop(scroller, Math.round(finalMax * originalRatio));

    return {
      entries,
      title: '',
      mode: 'scroll-fallback',
      pages: null,
      rawMessageCount: entries.length,
      enriched: 0,
    };
  }

  function buildTranscript(entries, titleOverride = '') {
    const pageTitle = document.title
      .replace(/\s*[-–—]\s*ChatGPT\s*$/i, '')
      .trim();
    const title = titleOverride || pageTitle || 'ChatGPT Conversation';
    const header = [
      `# ${title}`,
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

    try {
      let result;
      let apiError = null;
      try {
        result = await fetchConversationFromApi(status);
      } catch (error) {
        apiError = error;
        log('API path failed; using scroll fallback', error);
        status.textContent = (
          'Server-history path failed after retries.\n'
          + `${error?.message || String(error)}\n`
          + 'Falling back to rendered-history scrolling…'
        );
        await sleep(900);
        result = await fetchConversationByScrolling(status);
      }

      const transcript = buildTranscript(result.entries, result.title);
      GM_setClipboard(transcript, 'text');

      const sourceLabel = result.mode === 'api'
        ? `server API (${result.pages} page${result.pages === 1 ? '' : 's'})`
        : result.mode === 'legacy-api' || result.mode === 'api-mapping'
          ? 'server API (legacy mapping)'
          : 'scroll fallback';

      status.textContent = (
        'Copied entire chat.\n'
        + `${result.entries.length} transcript turns • ${transcript.length.toLocaleString()} characters\n`
        + `Source: ${sourceLabel}`
        + (result.enriched ? ` • ${result.enriched} mounted messages DOM-enriched` : '')
        + (apiError && result.mode === 'scroll-fallback' ? '\n(API path failed; fallback was used.)' : '')
      );

      log('Copied transcript', {
        mode: result.mode,
        transcriptTurns: result.entries.length,
        rawMessages: result.rawMessageCount,
        pages: result.pages,
        characters: transcript.length,
        domEnriched: result.enriched,
      });

      setTimeout(() => status.remove(), 5500);
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
