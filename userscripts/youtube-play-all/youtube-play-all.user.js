// ==UserScript==
// @name         YouTube Play All Channel Videos (v2.0.0 - Virtual Queue)
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Builds a local virtual queue from a YouTube channel, with a selectable newest-video count, optional Shorts/Live/members content, and deterministic next/previous playback without temporary 50-video playlists.
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const QUEUE_KEY = 'yt-play-all-virtual-queue-v2';
  const QUEUE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const ORIGIN = 'https://www.youtube.com';
  const QUEUE_MARKER = 'ytpa';
  const COUNT_OPTIONS = [25, 50, 100, 250, 500, 1000, Infinity];
  const DEFAULT_COUNT_INDEX = 3;

  const IDS = {
    menu: 'yt-play-all-menu',
    header: 'yt-play-all-header',
    body: 'yt-play-all-body',
    play: 'yt-play-all-btn',
    shorts: 'yt-play-all-toggle-shorts',
    live: 'yt-play-all-toggle-live',
    members: 'yt-play-all-include-members',
    minimize: 'yt-play-all-minimize',
    countLabel: 'yt-play-all-count-label',
    countSlider: 'yt-play-all-count-slider',
    queueMenu: 'yt-play-all-queue-menu',
    queueHeader: 'yt-play-all-queue-header',
    queueBody: 'yt-play-all-queue-body',
    queueStatus: 'yt-play-all-queue-status',
    queuePrev: 'yt-play-all-queue-prev',
    queueNext: 'yt-play-all-queue-next',
    queueStop: 'yt-play-all-queue-stop',
    queueMinimize: 'yt-play-all-queue-minimize'
  };

  const KEYS = {
    shorts: 'yt-play-all-include-shorts',
    live: 'yt-play-all-include-live',
    members: 'yt-play-all-include-members',
    minimized: 'yt-play-all-ui-minimized',
    position: 'yt-play-all-ui-position-v1',
    countIndex: 'yt-play-all-count-index-v1',
    queueMinimized: 'yt-play-all-queue-minimized-v1',
    queuePosition: 'yt-play-all-queue-position-v1'
  };

  const CHANNEL_ROOT_KINDS = new Set(['channel', 'c', 'user']);
  const CHANNEL_TABS = new Set([
    'featured', 'videos', 'shorts', 'streams', 'live', 'playlists',
    'community', 'posts', 'podcasts', 'releases', 'about', 'search', 'courses'
  ]);

  const VIDEO_RENDERERS = new Set([
    'videoRenderer',
    'gridVideoRenderer',
    'playlistVideoRenderer',
    'playlistPanelVideoRenderer',
    'compactVideoRenderer',
    'reelItemRenderer',
    'channelVideoPlayerRenderer'
  ]);

  let channelId = null;
  let channelBaseUrl = null;
  let channelRouteKey = null;
  let building = false;
  let buildingCount = 0;
  let includeShorts = loadBool(KEYS.shorts, false);
  let includeLive = loadBool(KEYS.live, false);
  let includeMembers = loadBool(KEYS.members, false);
  let minimized = loadBool(KEYS.minimized, false);
  let queueMinimized = loadBool(KEYS.queueMinimized, false);
  let countIndex = loadInt(KEYS.countIndex, DEFAULT_COUNT_INDEX, 0, COUNT_OPTIONS.length - 1);
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
  window.addEventListener('resize', keepAllMenusOnscreen);

  handleNavigation();

  function handleNavigation() {
    scheduleChannelMenuRefresh();
    setupVirtualQueuePlayback();
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
      injectChannelMenu();
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

  function injectChannelMenu() {
    document.getElementById(IDS.menu)?.remove();

    const menu = createPanel(IDS.menu, '184px');
    const header = createPanelHeader(IDS.header, '▶ Play All', IDS.minimize, () => {
      minimized = !minimized;
      save(KEYS.minimized, minimized);
      syncChannelMenu();
    });
    menu.appendChild(header);

    const body = document.createElement('div');
    body.id = IDS.body;
    Object.assign(body.style, panelBodyStyle());

    const countWrap = document.createElement('div');
    Object.assign(countWrap.style, {
      padding: '3px 5px 1px',
      backgroundColor: 'rgba(255,255,255,.06)',
      borderRadius: '6px'
    });

    const countLabel = document.createElement('div');
    countLabel.id = IDS.countLabel;
    Object.assign(countLabel.style, {
      marginBottom: '3px',
      fontSize: '11px',
      fontWeight: '600'
    });

    const countSlider = document.createElement('input');
    countSlider.id = IDS.countSlider;
    countSlider.type = 'range';
    countSlider.min = '0';
    countSlider.max = String(COUNT_OPTIONS.length - 1);
    countSlider.step = '1';
    countSlider.value = String(countIndex);
    countSlider.title = 'How many newest regular videos to put in the virtual queue';
    Object.assign(countSlider.style, {
      width: '100%',
      margin: '0',
      cursor: 'pointer'
    });
    countSlider.addEventListener('input', () => {
      countIndex = Number(countSlider.value);
      save(KEYS.countIndex, countIndex);
      syncChannelMenu();
    });

    countWrap.append(countLabel, countSlider);
    body.appendChild(countWrap);

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

    restorePanelPosition(menu, KEYS.position, { top: 96, right: 16 });
    makeDraggable(menu, header, KEYS.position);
    syncChannelMenu();
  }

  function toggle(id, getValue, setValue) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    Object.assign(button.style, buttonStyle('#3f3f3f'));
    button.addEventListener('click', () => {
      setValue(!getValue());
      syncChannelMenu();
    });
    return button;
  }

  function syncChannelMenu() {
    syncToggle(IDS.shorts, `Shorts: ${includeShorts ? 'On' : 'Off'}`, includeShorts);
    syncToggle(IDS.live, `Live: ${includeLive ? 'On' : 'Off'}`, includeLive);
    syncToggle(IDS.members, `Members: ${includeMembers ? 'On' : 'Off'}`, includeMembers);

    const selectedCount = COUNT_OPTIONS[countIndex];
    const countLabel = document.getElementById(IDS.countLabel);
    if (countLabel) {
      const scope = includeShorts || includeLive ? 'Newest / type' : 'Newest videos';
      countLabel.textContent = `${scope}: ${formatCount(selectedCount)}`;
    }

    const body = document.getElementById(IDS.body);
    if (body) body.style.display = minimized ? 'none' : 'flex';

    const minimizeButton = document.getElementById(IDS.minimize);
    if (minimizeButton) {
      minimizeButton.textContent = minimized ? '+' : '−';
      minimizeButton.title = minimized ? 'Expand Play All controls' : 'Minimize Play All controls';
    }

    const menu = document.getElementById(IDS.menu);
    if (menu) menu.style.width = minimized ? '118px' : '184px';

    const slider = document.getElementById(IDS.countSlider);
    if (slider) slider.disabled = building;

    const play = document.getElementById(IDS.play);
    if (play) {
      play.disabled = building;
      play.textContent = building ? `Building… ${buildingCount}` : '▶ Start Queue';
      play.style.backgroundColor = building ? '#777' : '#ff0000';
      play.style.cursor = building ? 'wait' : 'pointer';
    }

    keepPanelOnscreen(menu, KEYS.position);
  }

  function syncToggle(id, text, enabled) {
    const button = document.getElementById(id);
    if (!button) return;
    button.textContent = text;
    button.style.backgroundColor = enabled ? '#2e7d32' : '#3f3f3f';
    button.disabled = building;
  }

  async function playAll() {
    if (building || !channelBaseUrl) return;

    building = true;
    buildingCount = 0;
    syncChannelMenu();

    try {
      clearQueue();

      const ids = [];
      const seen = new Set();
      const perFeedLimit = COUNT_OPTIONS[countIndex];

      await appendChannelTab(ids, seen, 'videos', 'videos', false, perFeedLimit);

      if (includeShorts) {
        const target = addLimit(ids.length, perFeedLimit);
        await appendChannelTab(ids, seen, 'shorts', 'shorts', true, target);
      }

      if (includeLive) {
        const target = addLimit(ids.length, perFeedLimit);
        await appendChannelTab(ids, seen, 'streams', 'live', true, target);
      }

      if (!ids.length) throw new Error('No videos were found for the selected filters.');

      const queue = {
        ids,
        index: 0,
        createdAt: Date.now(),
        source: channelBaseUrl,
        regularLimit: Number.isFinite(perFeedLimit) ? perFeedLimit : null,
        includes: {
          shorts: includeShorts,
          live: includeLive,
          members: includeMembers
        }
      };

      saveQueue(queue);
      console.log(`[PlayAll] Built local virtual queue with ${ids.length} items. No temporary playlist batching is used.`);
      openQueueItem(queue, 0);
    } catch (error) {
      console.error('[PlayAll]', error);
      alert(`[PlayAll] ${error?.message || String(error)}`);
    } finally {
      building = false;
      buildingCount = 0;
      syncChannelMenu();
    }
  }

  function addLimit(currentLength, perFeedLimit) {
    return Number.isFinite(perFeedLimit) ? currentLength + perFeedLimit : Infinity;
  }

  async function appendChannelTab(ids, seen, tabPath, label, optional = false, maxTotal = Infinity) {
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

    let candidates = collectIds(data, ids, seen, maxTotal);
    buildingCount = ids.length;
    syncChannelMenu();

    const seenTokens = new Set();
    let token = ids.length < maxTotal ? continuation(data, seenTokens) : null;

    while (token && ids.length < maxTotal) {
      const next = await postBrowse({ continuation: token });
      candidates += collectIds(next, ids, seen, maxTotal);
      buildingCount = ids.length;
      syncChannelMenu();
      token = ids.length < maxTotal ? continuation(next, seenTokens) : null;
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

  function collectIds(node, ids, seen, maxTotal = Infinity) {
    let candidates = 0;

    walkEntries(node, (key, value) => {
      if (ids.length >= maxTotal) return false;
      if (!value || typeof value !== 'object') return true;

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

      if (!isVideoId(id)) return true;

      candidates++;
      if (!includeMembers && isMembersOnly(value)) return true;
      push(id, ids, seen);
      return ids.length < maxTotal;
    });

    return candidates;
  }

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

  function saveQueue(queue) {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function readQueue() {
    try {
      const value = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || 'null');
      if (!value || !Array.isArray(value.ids) || !value.ids.length) return null;
      if (!Number.isInteger(value.index) || value.index < 0 || value.index >= value.ids.length) return null;

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

  function clearQueue() {
    sessionStorage.removeItem(QUEUE_KEY);
    unbindVirtualQueue();
    document.getElementById(IDS.queueMenu)?.remove();

    if (queueBindTimer) {
      clearTimeout(queueBindTimer);
      queueBindTimer = null;
    }
  }

  function openQueueItem(queue, index) {
    if (!queue || index < 0 || index >= queue.ids.length) return;

    queue.index = index;
    saveQueue(queue);

    const id = queue.ids[index];
    const url = new URL('/watch', ORIGIN);
    url.searchParams.set('v', id);
    url.searchParams.set(QUEUE_MARKER, '1');

    console.log(`[PlayAll] Opening ${index + 1}/${queue.ids.length}: ${id}`);
    location.href = url.toString();
  }

  function setupVirtualQueuePlayback() {
    const queue = readQueue();
    const isWatch = location.pathname === '/watch';
    const marker = new URLSearchParams(location.search).get(QUEUE_MARKER) === '1';

    if (!queue || !isWatch || !marker) {
      unbindVirtualQueue();
      document.getElementById(IDS.queueMenu)?.remove();
      return;
    }

    const currentId = new URLSearchParams(location.search).get('v');
    if (!isVideoId(currentId)) return;

    if (queue.ids[queue.index] !== currentId) {
      const actualIndex = queue.ids.indexOf(currentId);
      if (actualIndex < 0) {
        console.warn('[PlayAll] Current video is outside the active virtual queue; leaving it alone.');
        unbindVirtualQueue();
        document.getElementById(IDS.queueMenu)?.remove();
        return;
      }
      queue.index = actualIndex;
      saveQueue(queue);
    }

    ensureQueueMenu(queue);
    bindVirtualQueue(queue);
  }

  function ensureQueueMenu(queue) {
    let menu = document.getElementById(IDS.queueMenu);
    if (!menu) {
      menu = createPanel(IDS.queueMenu, '178px');
      const header = createPanelHeader(IDS.queueHeader, '▶ Virtual Queue', IDS.queueMinimize, () => {
        queueMinimized = !queueMinimized;
        save(KEYS.queueMinimized, queueMinimized);
        syncQueueMenu(readQueue());
      });
      menu.appendChild(header);

      const body = document.createElement('div');
      body.id = IDS.queueBody;
      Object.assign(body.style, panelBodyStyle());

      const status = document.createElement('div');
      status.id = IDS.queueStatus;
      Object.assign(status.style, {
        padding: '7px 8px',
        backgroundColor: 'rgba(255,255,255,.08)',
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: '700',
        textAlign: 'center'
      });
      body.appendChild(status);

      const nav = document.createElement('div');
      Object.assign(nav.style, {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '5px'
      });

      const prev = document.createElement('button');
      prev.id = IDS.queuePrev;
      prev.type = 'button';
      prev.textContent = '◀ Prev';
      Object.assign(prev.style, buttonStyle('#3f3f3f'), { textAlign: 'center' });
      prev.addEventListener('click', () => moveQueue(-1));

      const next = document.createElement('button');
      next.id = IDS.queueNext;
      next.type = 'button';
      next.textContent = 'Next ▶';
      Object.assign(next.style, buttonStyle('#3f3f3f'), { textAlign: 'center' });
      next.addEventListener('click', () => moveQueue(1));

      nav.append(prev, next);
      body.appendChild(nav);

      const stop = document.createElement('button');
      stop.id = IDS.queueStop;
      stop.type = 'button';
      stop.textContent = '■ Stop Queue';
      Object.assign(stop.style, buttonStyle('#5a2a2a'), { textAlign: 'center' });
      stop.addEventListener('click', stopQueue);
      body.appendChild(stop);

      menu.appendChild(body);
      document.body.appendChild(menu);

      restorePanelPosition(menu, KEYS.queuePosition, { top: 96, right: 16 });
      makeDraggable(menu, header, KEYS.queuePosition);
    }

    syncQueueMenu(queue);
  }

  function syncQueueMenu(queue) {
    const menu = document.getElementById(IDS.queueMenu);
    if (!menu || !queue) return;

    const body = document.getElementById(IDS.queueBody);
    if (body) body.style.display = queueMinimized ? 'none' : 'flex';

    const minimizeButton = document.getElementById(IDS.queueMinimize);
    if (minimizeButton) {
      minimizeButton.textContent = queueMinimized ? '+' : '−';
      minimizeButton.title = queueMinimized ? 'Expand virtual queue controls' : 'Minimize virtual queue controls';
    }

    menu.style.width = queueMinimized ? '126px' : '178px';

    const status = document.getElementById(IDS.queueStatus);
    if (status) status.textContent = `${queue.index + 1} / ${queue.ids.length}`;

    const prev = document.getElementById(IDS.queuePrev);
    if (prev) {
      prev.disabled = queue.index <= 0;
      prev.style.opacity = prev.disabled ? '.45' : '1';
    }

    const next = document.getElementById(IDS.queueNext);
    if (next) {
      next.disabled = queue.index >= queue.ids.length - 1;
      next.style.opacity = next.disabled ? '.45' : '1';
    }

    keepPanelOnscreen(menu, KEYS.queuePosition);
  }

  function moveQueue(delta) {
    const queue = readQueue();
    if (!queue) return;

    const nextIndex = queue.index + delta;
    if (nextIndex < 0 || nextIndex >= queue.ids.length) return;
    openQueueItem(queue, nextIndex);
  }

  function stopQueue() {
    clearQueue();

    const url = new URL(location.href);
    url.searchParams.delete(QUEUE_MARKER);
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function bindVirtualQueue(queue) {
    const video = document.querySelector('video');

    if (!video) {
      if (queueBindTimer) clearTimeout(queueBindTimer);
      queueBindTimer = setTimeout(() => {
        const fresh = readQueue();
        if (fresh) bindVirtualQueue(fresh);
      }, 300);
      return;
    }

    queueBindTimer = null;
    unbindVirtualQueue();

    boundVideo = video;
    boundEndedHandler = event => {
      const fresh = readQueue();
      if (!fresh) return;

      event.stopImmediatePropagation?.();
      event.preventDefault?.();
      video.pause();

      if (fresh.index >= fresh.ids.length - 1) {
        console.log('[PlayAll] Virtual queue completed.');
        clearQueue();
        return;
      }

      openQueueItem(fresh, fresh.index + 1);
    };

    video.addEventListener('ended', boundEndedHandler, { capture: true });
  }

  function unbindVirtualQueue() {
    if (boundVideo && boundEndedHandler) {
      boundVideo.removeEventListener('ended', boundEndedHandler, { capture: true });
    }
    boundVideo = null;
    boundEndedHandler = null;
  }

  function createPanel(id, width) {
    const panel = document.createElement('div');
    panel.id = id;
    Object.assign(panel.style, {
      position: 'fixed',
      zIndex: 9999,
      width,
      padding: '6px',
      backgroundColor: 'rgba(15,15,15,.94)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,.14)',
      borderRadius: '9px',
      boxShadow: '0 6px 18px rgba(0,0,0,.34)',
      fontFamily: 'Roboto, Arial, sans-serif',
      userSelect: 'none'
    });
    return panel;
  }

  function createPanelHeader(id, titleText, minimizeId, onMinimize) {
    const header = document.createElement('div');
    header.id = id;
    Object.assign(header.style, {
      height: '26px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '0 2px 4px 4px',
      cursor: 'grab'
    });

    const title = document.createElement('div');
    title.textContent = titleText;
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
    minimizeButton.id = minimizeId;
    minimizeButton.type = 'button';
    Object.assign(minimizeButton.style, iconButtonStyle());
    minimizeButton.addEventListener('click', event => {
      event.stopPropagation();
      onMinimize();
    });

    header.append(title, minimizeButton);
    return header;
  }

  function panelBodyStyle() {
    return {
      display: 'flex',
      flexDirection: 'column',
      gap: '5px'
    };
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

  function restorePanelPosition(panel, key, fallback) {
    const saved = loadJson(key);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const point = clampPoint(saved.x, saved.y, panel.offsetWidth, panel.offsetHeight);
      panel.style.left = `${point.x}px`;
      panel.style.top = `${point.y}px`;
      panel.style.right = 'auto';
      return;
    }

    panel.style.top = `${fallback.top}px`;
    panel.style.right = `${fallback.right}px`;
  }

  function makeDraggable(panel, handle, positionKey) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;

      const rect = panel.getBoundingClientRect();
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
        panel.offsetWidth,
        panel.offsetHeight
      );
      panel.style.left = `${point.x}px`;
      panel.style.top = `${point.y}px`;
      panel.style.right = 'auto';
    });

    const finish = event => {
      if (!dragging) return;
      dragging = false;
      handle.style.cursor = 'grab';
      handle.releasePointerCapture?.(event.pointerId);
      const rect = panel.getBoundingClientRect();
      saveJson(positionKey, { x: Math.round(rect.left), y: Math.round(rect.top) });
    };

    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function keepAllMenusOnscreen() {
    keepPanelOnscreen(document.getElementById(IDS.menu), KEYS.position);
    keepPanelOnscreen(document.getElementById(IDS.queueMenu), KEYS.queuePosition);
  }

  function keepPanelOnscreen(panel, positionKey) {
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    const point = clampPoint(rect.left, rect.top, rect.width, rect.height);

    if (Math.abs(point.x - rect.left) > 0.5 || Math.abs(point.y - rect.top) > 0.5) {
      panel.style.left = `${point.x}px`;
      panel.style.top = `${point.y}px`;
      panel.style.right = 'auto';
      saveJson(positionKey, { x: Math.round(point.x), y: Math.round(point.y) });
    }
  }

  function clampPoint(x, y, width, height) {
    const margin = 8;
    return {
      x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - height - margin))
    };
  }

  function formatCount(value) {
    return Number.isFinite(value) ? String(value) : 'All';
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
    if (!node || typeof node !== 'object') return true;

    if (Array.isArray(node)) {
      for (const value of node) {
        if (walkEntries(value, fn) === false) return false;
      }
      return true;
    }

    for (const [key, value] of Object.entries(node)) {
      if (fn(key, value) === false) return false;
      if (walkEntries(value, fn) === false) return false;
    }

    return true;
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

  function loadInt(key, fallback, min, max) {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) return fallback;
    return value;
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