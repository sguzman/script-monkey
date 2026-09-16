// ==UserScript==
// @name         YouTube Play All Channel Videos (v1.10.1 - Reliable Batch Handoff)
// @namespace    http://tampermonkey.net/
// @version      1.10.1
// @description  Plays all videos from a YouTube channel with optional Shorts, Live, and members-only inclusion. Uses resilient channel-tab discovery, modern InnerTube continuation requests, and reliable chained 50-video temporary playlists.
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const BATCH_SIZE = 50;
  const QUEUE_KEY = 'yt-play-all-full-queue-v1';
  const ACTIVE_BATCH_KEY = 'yt-play-all-active-batch-v1';
  const HANDOFF_KEY = 'yt-play-all-handoff-v1';
  const QUEUE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const HANDOFF_MAX_AGE_MS = 15 * 1000;
  const ORIGIN = 'https://www.youtube.com';

  const IDS = {
    menu: 'yt-play-all-menu',
    header: 'yt-play-all-header',
    body: 'yt-play-all-body',
    play: 'yt-play-all-btn',
    shorts: 'yt-play-all-toggle-shorts',
    live: 'yt-play-all-toggle-live',
    members: 'yt-play-all-include-members',
    minimize: 'yt-play-all-minimize'
  };

  const KEYS = {
    shorts: 'yt-play-all-include-shorts',
    live: 'yt-play-all-include-live',
    members: 'yt-play-all-include-members',
    minimized: 'yt-play-all-ui-minimized',
    position: 'yt-play-all-ui-position-v1'
  };

  const CHANNEL_ROOT_KINDS = new Set(['channel', 'c', 'user']);
  const CHANNEL_TABS = new Set([
    'featured', 'videos', 'shorts', 'streams', 'live', 'playlists',
    'community', 'posts', 'podcasts', 'releases', 'about', 'search', 'courses'
  ]);

  let channelId = null;
  let channelBaseUrl = null;
  let channelRouteKey = null;
  let building = false;
  let includeShorts = loadBool(KEYS.shorts, false);
  let includeLive = loadBool(KEYS.live, false);
  let includeMembers = loadBool(KEYS.members, false);
  let minimized = loadBool(KEYS.minimized, false);
  let queueBindTimer = null;
  let refreshTimers = [];
  let boundVideo = null;
  let boundEndedHandler = null;

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
  }

  window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
  window.addEventListener('locationchange', handleNavigation);
  window.addEventListener('yt-navigate-finish', handleNavigation);
  window.addEventListener('resize', keepMenuOnscreen);

  handleNavigation();

  function handleNavigation() {
    scheduleChannelMenuRefresh();
    if (!recoverPendingHandoff()) setupQueuePlayback();
  }

  function scheduleChannelMenuRefresh() {
    for (const timer of refreshTimers) clearTimeout(timer);
    refreshTimers = [];

    initChannelMenu();
    refreshTimers.push(setTimeout(initChannelMenu, 250));
    refreshTimers.push(setTimeout(initChannelMenu, 900));
  }

  function initChannelMenu() {
    const route = parseChannelRoute();

    if (!route) {
      channelId = null;
      channelBaseUrl = null;
      channelRouteKey = null;
      document.getElementById(IDS.menu)?.remove();
      return;
    }

    const id = getChannelId();
    const nextRouteKey = `${route.baseUrl}|${id || ''}`;

    channelBaseUrl = route.baseUrl;
    channelId = id;

    if (nextRouteKey !== channelRouteKey || !document.getElementById(IDS.menu)) {
      channelRouteKey = nextRouteKey;
      injectMenu();
    }
  }

  function parseChannelRoute() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;

    let baseParts;
    let tabIndex;

    if (parts[0].startsWith('@')) {
      baseParts = [parts[0]];
      tabIndex = 1;
    } else if (CHANNEL_ROOT_KINDS.has(parts[0]) && parts[1]) {
      baseParts = [parts[0], parts[1]];
      tabIndex = 2;
    } else {
      return null;
    }

    if (parts.length > tabIndex + 1) return null;
    if (parts.length === tabIndex + 1 && !CHANNEL_TABS.has(parts[tabIndex])) return null;

    return {
      baseUrl: `/${baseParts.join('/')}`,
      tab: parts[tabIndex] || null
    };
  }

  function getChannelId() {
    const meta = document.querySelector('meta[itemprop="channelId"]')?.content;
    if (isChannelId(meta)) return meta;

    const metadata = window.ytInitialData?.metadata?.channelMetadataRenderer;
    if (isChannelId(metadata?.externalId)) return metadata.externalId;
    if (isChannelId(metadata?.externalChannelId)) return metadata.externalChannelId;

    const header = window.ytInitialData?.header?.c4TabbedHeaderRenderer?.channelId;
    if (isChannelId(header)) return header;

    let fromData = null;
    walk(window.ytInitialData, value => {
      if (fromData || !value || typeof value !== 'object') return;
      const browseId = value.browseEndpoint?.browseId;
      if (isChannelId(browseId)) fromData = browseId;
    });
    if (fromData) return fromData;

    const cfg = getYtConfig('CHANNEL_ID');
    if (isChannelId(cfg)) return cfg;

    const direct = location.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]+)/)?.[1];
    return isChannelId(direct) ? direct : null;
  }

  function isChannelId(value) {
    return typeof value === 'string' && /^UC[A-Za-z0-9_-]{20,}$/.test(value);
  }

  function injectMenu() {
    document.getElementById(IDS.menu)?.remove();

    const menu = document.createElement('div');
    menu.id = IDS.menu;
    Object.assign(menu.style, {
      position: 'fixed',
      zIndex: 9999,
      width: '164px',
      padding: '6px',
      backgroundColor: 'rgba(15,15,15,.94)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,.14)',
      borderRadius: '9px',
      boxShadow: '0 6px 18px rgba(0,0,0,.34)',
      fontFamily: 'Roboto, Arial, sans-serif',
      userSelect: 'none'
    });

    const header = document.createElement('div');
    header.id = IDS.header;
    Object.assign(header.style, {
      height: '26px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '0 2px 4px 4px',
      cursor: 'grab'
    });

    const title = document.createElement('div');
    title.textContent = '▶ Play All';
    Object.assign(title.style, {
      flex: '1',
      minWidth: '0',
      fontSize: '12px',
      fontWeight: '700',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    });

    const minimizeButton = document.createElement('button');
    minimizeButton.id = IDS.minimize;
    minimizeButton.type = 'button';
    minimizeButton.title = 'Minimize Play All controls';
    Object.assign(minimizeButton.style, iconButtonStyle());
    minimizeButton.addEventListener('click', event => {
      event.stopPropagation();
      minimized = !minimized;
      save(KEYS.minimized, minimized);
      syncMenu();
    });

    header.append(title, minimizeButton);
    menu.appendChild(header);

    const body = document.createElement('div');
    body.id = IDS.body;
    Object.assign(body.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '5px'
    });

    body.appendChild(toggle(IDS.shorts, () => includeShorts, value => {
      includeShorts = value;
      save(KEYS.shorts, value);
    }));

    body.appendChild(toggle(IDS.live, () => includeLive, value => {
      includeLive = value;
      save(KEYS.live, value);
    }));

    body.appendChild(toggle(IDS.members, () => includeMembers, value => {
      includeMembers = value;
      save(KEYS.members, value);
    }));

    const play = document.createElement('button');
    play.id = IDS.play;
    Object.assign(play.style, buttonStyle('#ff0000'));
    play.addEventListener('click', playAll);
    body.appendChild(play);

    menu.appendChild(body);
    document.body.appendChild(menu);

    restoreMenuPosition(menu);
    makeDraggable(menu, header);
    syncMenu();
  }

  function toggle(id, getValue, setValue) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    Object.assign(button.style, buttonStyle('#3f3f3f'));
    button.addEventListener('click', () => {
      setValue(!getValue());
      syncMenu();
    });
    return button;
  }

  function buttonStyle(backgroundColor) {
    return {
      width: '100%',
      minHeight: '30px',
      padding: '6px 8px',
      backgroundColor,
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      fontSize: '12px',
      lineHeight: '16px',
      fontWeight: '600',
      cursor: 'pointer',
      textAlign: 'left'
    };
  }

  function iconButtonStyle() {
    return {
      width: '24px',
      height: '24px',
      padding: '0',
      border: 'none',
      borderRadius: '5px',
      backgroundColor: 'rgba(255,255,255,.10)',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '16px',
      fontWeight: '700',
      lineHeight: '24px',
      textAlign: 'center'
    };
  }

  function syncMenu() {
    syncToggle(IDS.shorts, `Shorts: ${includeShorts ? 'On' : 'Off'}`, includeShorts);
    syncToggle(IDS.live, `Live: ${includeLive ? 'On' : 'Off'}`, includeLive);
    syncToggle(IDS.members, `Members: ${includeMembers ? 'On' : 'Off'}`, includeMembers);

    const body = document.getElementById(IDS.body);
    if (body) body.style.display = minimized ? 'none' : 'flex';

    const minimizeButton = document.getElementById(IDS.minimize);
    if (minimizeButton) {
      minimizeButton.textContent = minimized ? '+' : '−';
      minimizeButton.title = minimized ? 'Expand Play All controls' : 'Minimize Play All controls';
    }

    const menu = document.getElementById(IDS.menu);
    if (menu) menu.style.width = minimized ? '118px' : '164px';

    const play = document.getElementById(IDS.play);
    if (play) {
      play.disabled = building;
      play.textContent = building ? 'Building…' : '▶ Play All';
      play.style.backgroundColor = building ? '#777' : '#ff0000';
      play.style.cursor = building ? 'wait' : 'pointer';
    }

    keepMenuOnscreen();
  }

  function syncToggle(id, text, enabled) {
    const button = document.getElementById(id);
    if (!button) return;
    button.textContent = text;
    button.style.backgroundColor = enabled ? '#2e7d32' : '#3f3f3f';
  }

  function restoreMenuPosition(menu) {
    const saved = loadJson(KEYS.position);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const point = clampPoint(saved.x, saved.y, menu.offsetWidth, menu.offsetHeight);
      menu.style.left = `${point.x}px`;
      menu.style.top = `${point.y}px`;
      menu.style.right = 'auto';
      return;
    }

    menu.style.top = '96px';
    menu.style.right = '16px';
  }

  function makeDraggable(menu, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;

      const rect = menu.getBoundingClientRect();
      dragging = true;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      handle.style.cursor = 'grabbing';
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', event => {
      if (!dragging) return;
      const point = clampPoint(
        event.clientX - offsetX,
        event.clientY - offsetY,
        menu.offsetWidth,
        menu.offsetHeight
      );
      menu.style.left = `${point.x}px`;
      menu.style.top = `${point.y}px`;
      menu.style.right = 'auto';
    });

    const finish = event => {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = 'grab';
      handle.releasePointerCapture?.(event.pointerId);
      const rect = menu.getBoundingClientRect();
      saveJson(KEYS.position, { x: Math.round(rect.left), y: Math.round(rect.top) });
    };

    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function keepMenuOnscreen() {
    const menu = document.getElementById(IDS.menu);
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const point = clampPoint(rect.left, rect.top, rect.width, rect.height);

    if (Math.abs(point.x - rect.left) > 0.5 || Math.abs(point.y - rect.top) > 0.5) {
      menu.style.left = `${point.x}px`;
      menu.style.top = `${point.y}px`;
      menu.style.right = 'auto';
      saveJson(KEYS.position, { x: Math.round(point.x), y: Math.round(point.y) });
    }
  }

  function clampPoint(x, y, width, height) {
    const margin = 8;
    return {
      x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - height - margin))
    };
  }

  async function playAll() {
    if (building || !channelBaseUrl) return;

    building = true;
    syncMenu();

    try {
      clearQueue();

      const ids = [];
      const seen = new Set();

      await appendChannelTab(ids, seen, 'videos', 'videos');

      if (includeShorts) {
        await appendChannelTab(ids, seen, 'shorts', 'shorts', true);
      }

      if (includeLive) {
        await appendChannelTab(ids, seen, 'streams', 'live', true);
      }

      if (!ids.length) throw new Error('No videos were found for the selected filters.');

      console.log(`[PlayAll] Collected ${ids.length} videos. Temporary playlists are chained in ${BATCH_SIZE}-item batches.`);

      saveQueue(ids);
      openBatch(ids, 0);
    } catch (error) {
      console.error('[PlayAll]', error);
      alert(`[PlayAll] ${error?.message || String(error)}`);
    } finally {
      building = false;
      syncMenu();
    }
  }

  async function appendChannelTab(ids, seen, tabPath, label, optional = false) {
    const before = ids.length;
    const url = `${channelBaseUrl}/${tabPath}`;

    let data;
    try {
      data = await fetchTabInitialData(url);
    } catch (error) {
      if (optional && isMissingTabError(error)) {
        console.warn(`[PlayAll] ${label}: tab unavailable; skipping.`);
        return;
      }
      throw error;
    }

    let candidates = collectIds(data, ids, seen);
    const seenTokens = new Set();
    let token = continuation(data, seenTokens);

    while (token) {
      const next = await postBrowse({ continuation: token });
      candidates += collectIds(next, ids, seen);
      token = continuation(next, seenTokens);
    }

    if (!candidates && optional) {
      console.warn(`[PlayAll] ${label}: no video entries found; skipping.`);
    }

    console.log(`[PlayAll] ${label}: added ${ids.length - before}, total ${ids.length}`);
  }

  async function fetchTabInitialData(path) {
    const response = await fetch(absUrl(path), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });

    if (!response.ok) {
      const error = new Error(`Channel tab request failed with status ${response.status}.`);
      error.status = response.status;
      throw error;
    }

    const html = await response.text();
    const data = extractInitialData(html);

    if (!data) throw new Error('Could not read YouTube channel data from the tab page.');
    return data;
  }

  function isMissingTabError(error) {
    return error?.status === 404 || error?.status === 410;
  }

  async function postBrowse(payload) {
    const config = getInnertubeConfig();
    const headers = {
      'content-type': 'application/json',
      'x-youtube-client-name': String(config.clientNameNumber),
      'x-youtube-client-version': config.clientVersion,
      'x-origin': ORIGIN
    };

    if (config.visitorData) headers['x-goog-visitor-id'] = config.visitorData;
    if (config.sessionIndex != null) headers['x-goog-authuser'] = String(config.sessionIndex);
    if (config.delegatedSessionId) headers['x-goog-pageid'] = String(config.delegatedSessionId);
    if (config.loggedIn) headers['x-youtube-bootstrap-logged-in'] = 'true';

    const authorization = await buildAuthorizationHeader();
    if (authorization) headers.authorization = authorization;

    const query = new URLSearchParams({ prettyPrint: 'false' });
    if (config.apiKey) query.set('key', config.apiKey);

    const response = await fetch(`/youtubei/v1/browse?${query}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ context: config.context, ...payload })
    });

    if (!response.ok) {
      const detail = await readApiError(response);
      throw new Error(`YouTube browse request failed with status ${response.status}${detail ? `: ${detail}` : ''}.`);
    }

    return response.json();
  }

  function getInnertubeConfig() {
    const rawContext = clone(getYtConfig('INNERTUBE_CONTEXT')) || {};
    const currentClient = rawContext.client || {};

    const clientVersion = getYtConfig('INNERTUBE_CONTEXT_CLIENT_VERSION')
      || getYtConfig('INNERTUBE_CLIENT_VERSION')
      || currentClient.clientVersion;

    if (!clientVersion) {
      throw new Error('YouTube client version is not available. Reload the page and try again.');
    }

    const clientNameText = currentClient.clientName || 'WEB';
    const clientNameNumber = normalizeClientNameNumber(
      getYtConfig('INNERTUBE_CONTEXT_CLIENT_NAME')
      ?? getYtConfig('INNERTUBE_CLIENT_NAME'),
      clientNameText
    );

    const context = {
      ...rawContext,
      client: {
        ...currentClient,
        clientName: clientNameText,
        clientVersion
      }
    };

    const visitorData = getYtConfig('VISITOR_DATA') || currentClient.visitorData || null;
    if (visitorData && !context.client.visitorData) context.client.visitorData = visitorData;

    return {
      apiKey: getYtConfig('INNERTUBE_API_KEY') || null,
      clientNameNumber,
      clientVersion,
      visitorData,
      sessionIndex: getYtConfig('SESSION_INDEX'),
      delegatedSessionId: getYtConfig('DELEGATED_SESSION_ID') || null,
      loggedIn: Boolean(getYtConfig('LOGGED_IN')),
      context
    };
  }

  function normalizeClientNameNumber(value, clientNameText) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);

    const known = {
      WEB: 1,
      MWEB: 2,
      WEB_EMBEDDED_PLAYER: 56,
      WEB_REMIX: 67
    };

    return known[clientNameText] || 1;
  }

  async function buildAuthorizationHeader() {
    const sapisid = readCookie('SAPISID')
      || readCookie('__Secure-3PAPISID')
      || readCookie('__Secure-1PAPISID');

    if (!sapisid || !window.crypto?.subtle) return null;

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const input = `${timestamp} ${sapisid} ${ORIGIN}`;
      const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      return `SAPISIDHASH ${timestamp}_${hash}`;
    } catch (error) {
      console.warn('[PlayAll] Could not build optional YouTube auth header.', error);
      return null;
    }
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const cookie = part.trim();
      if (cookie.startsWith(prefix)) return decodeURIComponent(cookie.slice(prefix.length));
    }
    return null;
  }

  async function readApiError(response) {
    try {
      const text = await response.text();
      if (!text) return '';
      const parsed = JSON.parse(text);
      return parsed?.error?.message || text.slice(0, 180);
    } catch {
      return '';
    }
  }

  function collectIds(node, ids, seen) {
    let candidates = 0;

    walkEntries(node, (key, value) => {
      if (!value || typeof value !== 'object') return;

      let id = null;

      if (VIDEO_RENDERERS.has(key) && typeof value.videoId === 'string') {
        id = value.videoId;
      } else if (key === 'shortsLockupViewModel') {
        id = value.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
          || value.inlinePlayerData?.onVisible?.innertubeCommand?.reelWatchEndpoint?.videoId
          || null;
      } else if (key === 'lockupViewModel' && value.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
        id = value.contentId || null;
      }

      if (!isVideoId(id)) return;

      candidates++;

      if (!includeMembers && isMembersOnly(value)) return;
      push(id, ids, seen);
    });

    return candidates;
  }

  const VIDEO_RENDERERS = new Set([
    'videoRenderer',
    'gridVideoRenderer',
    'playlistVideoRenderer',
    'playlistPanelVideoRenderer',
    'compactVideoRenderer',
    'reelItemRenderer',
    'channelVideoPlayerRenderer'
  ]);

  function isVideoId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
  }

  function isMembersOnly(renderer) {
    let found = false;

    walk(renderer, value => {
      if (found || value == null) return;

      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'members only' || normalized === 'members-only') found = true;
        return;
      }

      if (typeof value !== 'object') return;

      const style = value.style || value.badgeStyle;
      found = style === 'BADGE_STYLE_TYPE_MEMBERS_ONLY'
        || style === 'BADGE_MEMBERS_ONLY'
        || style === 'THUMBNAIL_OVERLAY_BADGE_STYLE_MEMBERS_ONLY';
    });

    return found;
  }

  function continuation(node, seen) {
    let token = null;

    walk(node, value => {
      if (token || !value || typeof value !== 'object') return;

      const next = value.continuationEndpoint?.continuationCommand?.token
        || value.nextContinuationData?.continuation
        || value.continuationCommand?.token;

      if (typeof next === 'string' && next && !seen.has(next)) {
        seen.add(next);
        token = next;
      }
    });

    return token;
  }

  function saveQueue(ids) {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify({
      ids,
      createdAt: Date.now()
    }));
    sessionStorage.removeItem(HANDOFF_KEY);
  }

  function readQueue() {
    try {
      const value = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || 'null');
      if (!value || !Array.isArray(value.ids) || !value.ids.length) return null;

      if (!Number.isFinite(value.createdAt) || Date.now() - value.createdAt > QUEUE_MAX_AGE_MS) {
        clearQueue();
        return null;
      }

      return value;
    } catch {
      clearQueue();
      return null;
    }
  }

  function saveActiveBatch(startIndex) {
    sessionStorage.setItem(ACTIVE_BATCH_KEY, JSON.stringify({
      startIndex,
      createdAt: Date.now()
    }));
  }

  function readActiveBatch() {
    try {
      const value = JSON.parse(sessionStorage.getItem(ACTIVE_BATCH_KEY) || 'null');
      if (!value || !Number.isInteger(value.startIndex) || value.startIndex < 0) return null;
      return value;
    } catch {
      return null;
    }
  }

  function savePendingHandoff(batchStart, endedId) {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
      batchStart,
      endedId,
      listId: new URLSearchParams(location.search).get('list'),
      createdAt: Date.now()
    }));
  }

  function readPendingHandoff() {
    try {
      const value = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null');
      if (!value || !Number.isInteger(value.batchStart) || !isVideoId(value.endedId)) return null;
      if (!Number.isFinite(value.createdAt) || Date.now() - value.createdAt > HANDOFF_MAX_AGE_MS) {
        sessionStorage.removeItem(HANDOFF_KEY);
        return null;
      }
      return value;
    } catch {
      sessionStorage.removeItem(HANDOFF_KEY);
      return null;
    }
  }

  function clearQueue() {
    sessionStorage.removeItem(QUEUE_KEY);
    sessionStorage.removeItem(ACTIVE_BATCH_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    unbindQueueBoundary();

    if (queueBindTimer) {
      clearTimeout(queueBindTimer);
      queueBindTimer = null;
    }
  }

  function openBatch(ids, startIndex) {
    const batch = ids.slice(startIndex, startIndex + BATCH_SIZE);
    if (!batch.length) {
      clearQueue();
      return;
    }

    saveActiveBatch(startIndex);
    sessionStorage.removeItem(HANDOFF_KEY);

    console.log(`[PlayAll] Opening batch ${Math.floor(startIndex / BATCH_SIZE) + 1}/${Math.ceil(ids.length / BATCH_SIZE)} (${startIndex + 1}-${startIndex + batch.length} of ${ids.length})`);
    location.href = `https://www.youtube.com/watch_videos?video_ids=${batch.join(',')}`;
  }

  function recoverPendingHandoff() {
    const pending = readPendingHandoff();
    if (!pending || location.pathname !== '/watch') return false;

    const queue = readQueue();
    if (!queue) return false;

    const currentId = new URLSearchParams(location.search).get('v');
    if (!isVideoId(currentId)) return false;

    const batchIds = queue.ids.slice(pending.batchStart, pending.batchStart + BATCH_SIZE);
    const nextStart = pending.batchStart + BATCH_SIZE;

    if (batchIds.includes(currentId)) {
      // Normal YouTube autoplay inside the current temporary playlist.
      sessionStorage.removeItem(HANDOFF_KEY);
      return false;
    }

    if (nextStart < queue.ids.length) {
      console.log(`[PlayAll] YouTube fell out of batch ${Math.floor(pending.batchStart / BATCH_SIZE) + 1}; forcing batch ${Math.floor(nextStart / BATCH_SIZE) + 1}.`);
      openBatch(queue.ids, nextStart);
      return true;
    }

    sessionStorage.removeItem(HANDOFF_KEY);
    return false;
  }

  function setupQueuePlayback() {
    const queue = readQueue();
    if (!queue || location.pathname !== '/watch') {
      unbindQueueBoundary();
      return;
    }

    const currentId = new URLSearchParams(location.search).get('v');
    if (!isVideoId(currentId)) return;

    let active = readActiveBatch();
    if (!active) {
      const index = queue.ids.indexOf(currentId);
      if (index < 0) return;
      active = { startIndex: Math.floor(index / BATCH_SIZE) * BATCH_SIZE };
      saveActiveBatch(active.startIndex);
    }

    const batchIds = queue.ids.slice(active.startIndex, active.startIndex + BATCH_SIZE);
    if (!batchIds.includes(currentId)) return;

    bindQueueBoundary(currentId, active.startIndex, queue.ids);
  }

  function bindQueueBoundary(currentId, batchStart, ids) {
    const video = document.querySelector('video');

    if (!video) {
      queueBindTimer = setTimeout(() => bindQueueBoundary(currentId, batchStart, ids), 300);
      return;
    }

    queueBindTimer = null;
    unbindQueueBoundary();

    const nextStart = batchStart + BATCH_SIZE;
    const batchIds = ids.slice(batchStart, batchStart + BATCH_SIZE);
    const finalExpectedId = batchIds.at(-1);

    boundVideo = video;
    boundEndedHandler = event => {
      if (nextStart >= ids.length) {
        if (currentId === ids.at(-1)) {
          console.log('[PlayAll] Full queue completed.');
          clearQueue();
        }
        return;
      }

      savePendingHandoff(batchStart, currentId);

      const nativeEnd = isSelectedPlaylistItemLast();
      const expectedEnd = currentId === finalExpectedId;

      if (nativeEnd || expectedEnd) {
        console.log(`[PlayAll] Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} complete; opening batch ${Math.floor(nextStart / BATCH_SIZE) + 1}.`);
        event.stopImmediatePropagation?.();
        event.preventDefault?.();
        video.pause();
        openBatch(ids, nextStart);
      }
      // Otherwise let YouTube perform its normal playlist navigation. If it
      // unexpectedly falls out of the temporary playlist, recoverPendingHandoff()
      // will detect the destination video is outside this batch and take over.
    };

    video.addEventListener('ended', boundEndedHandler, { capture: true });
  }

  function unbindQueueBoundary() {
    if (boundVideo && boundEndedHandler) {
      boundVideo.removeEventListener('ended', boundEndedHandler, { capture: true });
    }
    boundVideo = null;
    boundEndedHandler = null;
  }

  function isSelectedPlaylistItemLast() {
    const items = Array.from(document.querySelectorAll('ytd-playlist-panel-video-renderer'))
      .filter(item => item.offsetParent !== null);

    if (!items.length) return false;

    const selected = items.find(item =>
      item.hasAttribute('selected')
      || item.getAttribute('aria-selected') === 'true'
      || item.matches('[active]')
    );

    return Boolean(selected && selected === items.at(-1));
  }

  function extractInitialData(html) {
    for (const marker of [
      'var ytInitialData = ',
      'window["ytInitialData"] = ',
      "window['ytInitialData'] = ",
      'ytInitialData = '
    ]) {
      const at = html.indexOf(marker);
      if (at < 0) continue;

      const start = html.indexOf('{', at + marker.length);
      if (start < 0) continue;

      const text = balancedObject(html, start);
      if (!text) continue;

      try {
        return JSON.parse(text);
      } catch {
        // Try the next known marker.
      }
    }

    return null;
  }

  function balancedObject(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }

      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) return text.slice(start, i + 1);
    }

    return null;
  }

  function walk(node, fn) {
    if (!node || typeof node !== 'object') return;

    fn(node);

    for (const value of Array.isArray(node) ? node : Object.values(node)) {
      walk(value, fn);
    }
  }

  function walkEntries(node, fn) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const value of node) walkEntries(value, fn);
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      fn(key, value);
      walkEntries(value, fn);
    }
  }

  function push(id, ids, seen) {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  }

  function getYtConfig(key) {
    const fromYtcfg = window.ytcfg?.get?.(key);
    if (fromYtcfg !== undefined && fromYtcfg !== null) return fromYtcfg;
    return window.yt?.config_?.[key];
  }

  function loadBool(key, fallback) {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === 'true';
  }

  function save(key, value) {
    localStorage.setItem(key, String(value));
  }

  function loadJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function absUrl(url) {
    return url.startsWith('http') ? url : `${ORIGIN}${url}`;
  }
})();