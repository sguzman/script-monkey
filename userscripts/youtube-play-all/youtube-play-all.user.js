// ==UserScript==
// @name         YouTube Play All Channel Videos (v2.1.0 - Managed Scratch Playlist)
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  Builds a reusable private YouTube scratch playlist from a channel, with selectable newest-video count, optional Shorts/Live/members inclusion, and no 50-item temporary-playlist ceiling.
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ORIGIN = 'https://www.youtube.com';
  const PLAYLIST_TITLE = 'Script Monkey — Play All Scratch';
  const PLAYLIST_DESCRIPTION = 'Managed by script-monkey/youtube-play-all. This playlist is reused and overwritten whenever Play All builds a new channel playlist.';
  const ACTION_CHUNK_SIZE = 50;
  const ACTION_DELAY_MS = 450;
  const COUNT_OPTIONS = [25, 50, 100, 250, 500, 1000, 2500, 5000];
  const DEFAULT_COUNT_INDEX = 3;

  const IDS = {
    menu: 'yt-play-all-menu',
    header: 'yt-play-all-header',
    body: 'yt-play-all-body',
    play: 'yt-play-all-btn',
    openLast: 'yt-play-all-open-last',
    shorts: 'yt-play-all-toggle-shorts',
    live: 'yt-play-all-toggle-live',
    members: 'yt-play-all-include-members',
    minimize: 'yt-play-all-minimize',
    countLabel: 'yt-play-all-count-label',
    countSlider: 'yt-play-all-count-slider'
  };

  const KEYS = {
    shorts: 'yt-play-all-include-shorts',
    live: 'yt-play-all-include-live',
    members: 'yt-play-all-include-members',
    minimized: 'yt-play-all-ui-minimized',
    position: 'yt-play-all-ui-position-v1',
    countIndex: 'yt-play-all-count-index-v2',
    playlistId: 'yt-play-all-managed-playlist-id-v1',
    lastBuild: 'yt-play-all-last-build-v1'
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

  let channelBaseUrl = null;
  let channelRouteKey = null;
  let building = false;
  let buildingStatus = '';
  let includeShorts = loadBool(KEYS.shorts, false);
  let includeLive = loadBool(KEYS.live, false);
  let includeMembers = loadBool(KEYS.members, false);
  let minimized = loadBool(KEYS.minimized, false);
  let countIndex = loadInt(KEYS.countIndex, DEFAULT_COUNT_INDEX, 0, COUNT_OPTIONS.length - 1);
  let refreshTimers = [];

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
      channelBaseUrl = null;
      channelRouteKey = null;
      document.getElementById(IDS.menu)?.remove();
      return;
    }

    channelBaseUrl = route.baseUrl;
    const nextRouteKey = route.baseUrl;

    if (nextRouteKey !== channelRouteKey || !document.getElementById(IDS.menu)) {
      channelRouteKey = nextRouteKey;
      injectMenu();
    } else {
      syncMenu();
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

  function injectMenu() {
    document.getElementById(IDS.menu)?.remove();

    const menu = document.createElement('div');
    menu.id = IDS.menu;
    Object.assign(menu.style, {
      position: 'fixed',
      zIndex: 9999,
      width: '190px',
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

    const countBox = document.createElement('div');
    Object.assign(countBox.style, {
      padding: '7px 8px 5px',
      backgroundColor: 'rgba(255,255,255,.07)',
      borderRadius: '6px'
    });

    const countLabel = document.createElement('div');
    countLabel.id = IDS.countLabel;
    Object.assign(countLabel.style, {
      marginBottom: '4px',
      fontSize: '12px',
      fontWeight: '700'
    });

    const slider = document.createElement('input');
    slider.id = IDS.countSlider;
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(COUNT_OPTIONS.length - 1);
    slider.step = '1';
    slider.value = String(countIndex);
    Object.assign(slider.style, {
      width: '100%',
      margin: '0',
      cursor: 'pointer'
    });
    slider.addEventListener('input', () => {
      countIndex = Number(slider.value);
      save(KEYS.countIndex, countIndex);
      syncMenu();
    });

    countBox.append(countLabel, slider);
    body.appendChild(countBox);

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
    play.addEventListener('click', buildPlaylist);
    body.appendChild(play);

    const openLast = document.createElement('button');
    openLast.id = IDS.openLast;
    openLast.type = 'button';
    openLast.textContent = '↗ Open Last Playlist';
    Object.assign(openLast.style, buttonStyle('#3f3f3f'));
    openLast.addEventListener('click', openLastPlaylist);
    body.appendChild(openLast);

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

    const selectedCount = COUNT_OPTIONS[countIndex];
    const countLabel = document.getElementById(IDS.countLabel);
    if (countLabel) {
      const scope = includeShorts || includeLive ? 'Newest / type' : 'Newest videos';
      countLabel.textContent = `${scope}: ${selectedCount}`;
    }

    const body = document.getElementById(IDS.body);
    if (body) body.style.display = minimized ? 'none' : 'flex';

    const minimizeButton = document.getElementById(IDS.minimize);
    if (minimizeButton) {
      minimizeButton.textContent = minimized ? '+' : '−';
      minimizeButton.title = minimized ? 'Expand Play All controls' : 'Minimize Play All controls';
    }

    const menu = document.getElementById(IDS.menu);
    if (menu) menu.style.width = minimized ? '118px' : '190px';

    const slider = document.getElementById(IDS.countSlider);
    if (slider) slider.disabled = building;

    for (const id of [IDS.shorts, IDS.live, IDS.members]) {
      const button = document.getElementById(id);
      if (button) button.disabled = building;
    }

    const play = document.getElementById(IDS.play);
    if (play) {
      play.disabled = building;
      play.textContent = building ? buildingStatus || 'Building…' : '▶ Build Playlist';
      play.style.backgroundColor = building ? '#777' : '#ff0000';
      play.style.cursor = building ? 'wait' : 'pointer';
    }

    const openLast = document.getElementById(IDS.openLast);
    if (openLast) {
      const hasPlaylist = Boolean(localStorage.getItem(KEYS.playlistId) || loadJson(KEYS.lastBuild)?.playlistId);
      openLast.disabled = building || !hasPlaylist;
      openLast.style.opacity = openLast.disabled ? '.45' : '1';
      openLast.style.cursor = openLast.disabled ? 'default' : 'pointer';
    }

    keepMenuOnscreen();
  }

  function syncToggle(id, text, enabled) {
    const button = document.getElementById(id);
    if (!button) return;
    button.textContent = text;
    button.style.backgroundColor = enabled ? '#2e7d32' : '#3f3f3f';
  }

  function setBuildStatus(text) {
    buildingStatus = text;
    syncMenu();
  }

  async function buildPlaylist() {
    if (building || !channelBaseUrl) return;

    building = true;
    buildingStatus = 'Collecting…';
    syncMenu();

    try {
      const ids = [];
      const seen = new Set();
      const perFeedLimit = COUNT_OPTIONS[countIndex];

      await appendChannelTab(ids, seen, 'videos', 'videos', false, perFeedLimit);

      if (includeShorts) {
        await appendChannelTab(ids, seen, 'shorts', 'shorts', true, ids.length + perFeedLimit);
      }

      if (includeLive) {
        await appendChannelTab(ids, seen, 'streams', 'live', true, ids.length + perFeedLimit);
      }

      if (!ids.length) throw new Error('No videos were found for the selected filters.');

      setBuildStatus('Finding playlist…');
      let playlistId = await ensureManagedPlaylist();

      try {
        await overwritePlaylist(playlistId, ids);
      } catch (error) {
        if (!isPlaylistOwnershipOrMissingError(error)) throw error;

        console.warn('[PlayAll] Stored scratch playlist is unavailable for this account; rediscovering it.', error);
        localStorage.removeItem(KEYS.playlistId);
        setBuildStatus('Recovering playlist…');
        playlistId = await ensureManagedPlaylist(true);
        await overwritePlaylist(playlistId, ids);
      }

      const lastBuild = {
        playlistId,
        count: ids.length,
        source: channelBaseUrl,
        builtAt: Date.now(),
        includes: {
          shorts: includeShorts,
          live: includeLive,
          members: includeMembers
        },
        perFeedLimit
      };

      localStorage.setItem(KEYS.playlistId, playlistId);
      saveJson(KEYS.lastBuild, lastBuild);

      console.log(`[PlayAll] Rebuilt ${PLAYLIST_TITLE} with ${ids.length} items: ${playlistId}`);

      setBuildStatus('Opening…');
      const url = new URL('/watch', ORIGIN);
      url.searchParams.set('v', ids[0]);
      url.searchParams.set('list', playlistId);
      url.searchParams.set('index', '1');
      location.href = url.toString();
    } catch (error) {
      console.error('[PlayAll]', error);
      alert(`[PlayAll] ${error?.message || String(error)}`);
    } finally {
      building = false;
      buildingStatus = '';
      syncMenu();
    }
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
    setBuildStatus(`Collecting… ${ids.length}`);

    const seenTokens = new Set();
    let token = ids.length < maxTotal ? continuation(data, seenTokens) : null;

    while (token && ids.length < maxTotal) {
      const next = await postBrowse({ continuation: token });
      candidates += collectIds(next, ids, seen, maxTotal);
      setBuildStatus(`Collecting… ${ids.length}`);
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

  function collectIds(node, ids, seen, maxTotal = Infinity) {
    let candidates = 0;

    walkEntries(node, (key, value) => {
      if (ids.length >= maxTotal) return false;
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

      if (ids.length >= maxTotal) return false;
    });

    return candidates;
  }

  async function ensureManagedPlaylist(forceRediscover = false) {
    const config = getInnertubeConfig();
    if (!config.loggedIn && !hasReadableAuthCookie()) {
      throw new Error('YouTube playlist editing requires you to be signed in.');
    }

    const savedId = forceRediscover ? null : localStorage.getItem(KEYS.playlistId);
    const playlists = await listOwnedPlaylists();

    if (savedId && playlists.some(item => item.playlistId === savedId)) {
      return savedId;
    }

    const matches = playlists.filter(item => item.title === PLAYLIST_TITLE);
    if (matches.length) {
      if (matches.length > 1) {
        console.warn(`[PlayAll] Found ${matches.length} playlists named "${PLAYLIST_TITLE}". Reusing the first instead of creating another.`);
      }
      const adoptedId = matches[0].playlistId;
      localStorage.setItem(KEYS.playlistId, adoptedId);
      return adoptedId;
    }

    setBuildStatus('Creating playlist…');
    const result = await postInnertube('playlist/create', {
      title: PLAYLIST_TITLE,
      description: PLAYLIST_DESCRIPTION,
      privacyStatus: 'PRIVATE',
      videoIds: []
    }, true);

    const playlistId = result?.playlistId;
    if (!playlistId || typeof playlistId !== 'string') {
      throw new Error('YouTube did not return a playlist ID after creating the scratch playlist.');
    }

    localStorage.setItem(KEYS.playlistId, playlistId);
    console.log(`[PlayAll] Created managed scratch playlist ${playlistId}.`);
    return playlistId;
  }

  async function listOwnedPlaylists() {
    const playlists = [];
    const seenIds = new Set();
    const seenTokens = new Set();

    let data = await postBrowse({ browseId: 'FEplaylist_aggregation' }, true);

    while (data) {
      collectPlaylistRefs(data, playlists, seenIds);
      const token = continuation(data, seenTokens);
      if (!token) break;
      data = await postBrowse({ continuation: token }, true);
    }

    return playlists;
  }

  function collectPlaylistRefs(node, out, seenIds) {
    walkEntries(node, (key, value) => {
      if (!value || typeof value !== 'object') return;

      let playlistId = null;
      let title = null;

      if (key === 'gridPlaylistRenderer' || key === 'playlistRenderer') {
        playlistId = value.playlistId || null;
        title = extractText(value.title);
      } else if (key === 'lockupViewModel') {
        const contentId = value.contentId;
        const looksLikePlaylist = value.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST'
          || (typeof contentId === 'string' && !isVideoId(contentId) && /^(PL|LL|UU|OLAK5uy_|RD)/.test(contentId));

        if (looksLikePlaylist) {
          playlistId = contentId || null;
          title = value.metadata?.lockupMetadataViewModel?.title?.content
            || extractText(value.metadata?.lockupMetadataViewModel?.title)
            || null;
        }
      }

      if (!playlistId || !title || seenIds.has(playlistId)) return;
      seenIds.add(playlistId);
      out.push({ playlistId, title });
    });
  }

  async function overwritePlaylist(playlistId, ids) {
    setBuildStatus('Reading playlist…');
    const existing = await fetchPlaylistEntries(playlistId);

    if (existing.length) {
      for (let offset = 0; offset < existing.length; offset += ACTION_CHUNK_SIZE) {
        const chunk = existing.slice(offset, offset + ACTION_CHUNK_SIZE);
        const actions = chunk.map(item => item.setVideoId
          ? {
              action: 'ACTION_REMOVE_VIDEO',
              removedVideoId: item.videoId,
              setVideoId: item.setVideoId
            }
          : {
              action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID',
              removedVideoId: item.videoId
            }
        );

        setBuildStatus(`Clearing… ${Math.min(offset + chunk.length, existing.length)}/${existing.length}`);
        await editPlaylist(playlistId, actions);

        if (offset + ACTION_CHUNK_SIZE < existing.length) {
          await sleep(ACTION_DELAY_MS);
        }
      }
    }

    for (let offset = 0; offset < ids.length; offset += ACTION_CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + ACTION_CHUNK_SIZE);
      const actions = chunk.map(videoId => ({
        action: 'ACTION_ADD_VIDEO',
        addedVideoId: videoId
      }));

      setBuildStatus(`Adding… ${Math.min(offset + chunk.length, ids.length)}/${ids.length}`);
      await editPlaylist(playlistId, actions);

      if (offset + ACTION_CHUNK_SIZE < ids.length) {
        await sleep(ACTION_DELAY_MS);
      }
    }
  }

  async function fetchPlaylistEntries(playlistId) {
    const entries = [];
    const seenSetIds = new Set();
    const seenFallback = new Set();
    const seenTokens = new Set();

    let data = await postBrowse({ browseId: `VL${stripVlPrefix(playlistId)}` }, true);

    while (data) {
      collectPlaylistEntries(data, entries, seenSetIds, seenFallback);
      const token = continuation(data, seenTokens);
      if (!token) break;
      data = await postBrowse({ continuation: token }, true);
    }

    return entries;
  }

  function collectPlaylistEntries(node, out, seenSetIds, seenFallback) {
    walkEntries(node, (key, value) => {
      if (!value || typeof value !== 'object') return;

      let videoId = null;
      let setVideoId = null;

      if (key === 'playlistVideoRenderer') {
        videoId = value.videoId || null;
        setVideoId = value.setVideoId || null;
      } else if (key === 'lockupViewModel' && isVideoId(value.contentId)) {
        videoId = value.contentId;
        setVideoId = value.setVideoId || value.playlistSetVideoId || null;
      }

      if (!isVideoId(videoId)) return;

      if (setVideoId) {
        if (seenSetIds.has(setVideoId)) return;
        seenSetIds.add(setVideoId);
      } else {
        if (seenFallback.has(videoId)) return;
        seenFallback.add(videoId);
      }

      out.push({ videoId, setVideoId });
    });
  }

  function editPlaylist(playlistId, actions) {
    return postInnertube('browse/edit_playlist', {
      playlistId: stripVlPrefix(playlistId),
      actions
    }, true);
  }

  async function postBrowse(payload, requireAuth = false) {
    return postInnertube('browse', payload, requireAuth);
  }

  async function postInnertube(endpoint, payload, requireAuth = false, attempt = 0) {
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

    if (requireAuth && !authorization && !config.loggedIn) {
      throw new Error('YouTube playlist editing requires you to be signed in.');
    }

    const query = new URLSearchParams({ prettyPrint: 'false' });
    if (config.apiKey) query.set('key', config.apiKey);

    const response = await fetch(`/youtubei/v1/${endpoint}?${query}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ context: config.context, ...payload })
    });

    if (response.status === 429 && attempt < 3) {
      await sleep(1000 * (2 ** attempt));
      return postInnertube(endpoint, payload, requireAuth, attempt + 1);
    }

    if (!response.ok) {
      const detail = await readApiError(response);
      const error = new Error(`YouTube ${endpoint} request failed with status ${response.status}${detail ? `: ${detail}` : ''}.`);
      error.status = response.status;
      throw error;
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
      console.warn('[PlayAll] Could not build YouTube auth header.', error);
      return null;
    }
  }

  function hasReadableAuthCookie() {
    return Boolean(
      readCookie('SAPISID')
      || readCookie('__Secure-3PAPISID')
      || readCookie('__Secure-1PAPISID')
    );
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

  function isPlaylistOwnershipOrMissingError(error) {
    return error?.status === 400
      || error?.status === 401
      || error?.status === 403
      || error?.status === 404
      || error?.status === 410;
  }

  function openLastPlaylist() {
    const lastBuild = loadJson(KEYS.lastBuild);
    const playlistId = lastBuild?.playlistId || localStorage.getItem(KEYS.playlistId);

    if (!playlistId) {
      alert('[PlayAll] No managed playlist has been created yet.');
      return;
    }

    location.href = `${ORIGIN}/playlist?list=${encodeURIComponent(playlistId)}`;
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

  function extractText(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value.simpleText === 'string') return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map(run => run?.text || '').join('');
    if (typeof value.content === 'string') return value.content;
    return null;
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

  function isVideoId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
  }

  function stripVlPrefix(value) {
    return String(value || '').replace(/^VL/, '');
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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function absUrl(url) {
    return url.startsWith('http') ? url : `${ORIGIN}${url}`;
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
})();