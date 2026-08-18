// ==UserScript==
// @name         YouTube Play All Channel Videos (v1.7 - Menu Filters)
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Adds a floating menu on YouTube channel pages to play channel videos with optional Shorts and Live filtering.
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  const MENU_ID = 'yt-play-all-menu';
  const PLAY_BUTTON_ID = 'yt-play-all-btn';
  const SHORTS_TOGGLE_ID = 'yt-play-all-toggle-shorts';
  const LIVE_TOGGLE_ID = 'yt-play-all-toggle-live';
  const STORAGE_KEYS = {
    includeShorts: 'yt-play-all-include-shorts',
    includeLive: 'yt-play-all-include-live'
  };

  console.log('[PlayAll] Script start on', location.href);

  let currentChannelId = null;
  let menu = null;
  let isBuildingPlaylist = false;
  let includeShorts = loadBoolean(STORAGE_KEYS.includeShorts, false);
  let includeLive = loadBoolean(STORAGE_KEYS.includeLive, false);

  ['pushState', 'replaceState'].forEach(fn => {
    const original = history[fn];
    history[fn] = function() {
      const result = original.apply(this, arguments);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
  });

  window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
  window.addEventListener('locationchange', init);

  init();

  function init() {
    console.log('[PlayAll] Running init()');
    const channelId = getChannelId();
    const isChannelPage = hasChannelTabs() || isLikelyChannelPath();

    if (!channelId || !isChannelPage) {
      console.log('[PlayAll] ❌ Channel context unavailable; removing menu if present.');
      currentChannelId = null;
      removeMenu();
      return;
    }

    if (channelId !== currentChannelId || !document.getElementById(MENU_ID)) {
      console.log('[PlayAll] ✅ Channel menu ready for:', channelId);
      currentChannelId = channelId;
      injectMenu();
    } else {
      syncMenuState();
    }
  }

  function getChannelId() {
    console.log('[PlayAll] → Checking <meta itemprop="channelId">');
    const meta = document.querySelector('meta[itemprop="channelId"]');
    if (meta?.content) {
      console.log('[PlayAll]    • meta channelId =', meta.content);
      return meta.content;
    }
    console.log('[PlayAll]    • not found');

    console.log('[PlayAll] → Checking ytcfg.get("CHANNEL_ID")');
    if (window.ytcfg?.get) {
      const cfg = window.ytcfg.get('CHANNEL_ID');
      console.log('[PlayAll]    • ytcfg CHANNEL_ID =', cfg);
      if (cfg) return cfg;
    } else {
      console.log('[PlayAll]    • ytcfg not available');
    }

    console.log('[PlayAll] → Checking ytInitialData.metadata.channelMetadataRenderer.externalId');
    const metadata = window.ytInitialData?.metadata?.channelMetadataRenderer;
    if (metadata?.externalId) {
      console.log('[PlayAll]    • externalId =', metadata.externalId);
      return metadata.externalId;
    }
    console.log('[PlayAll]    • externalId not present');

    console.log('[PlayAll] → Checking ytInitialData.metadata.channelMetadataRenderer.externalChannelId');
    if (metadata?.externalChannelId) {
      console.log('[PlayAll]    • externalChannelId =', metadata.externalChannelId);
      return metadata.externalChannelId;
    }
    console.log('[PlayAll]    • externalChannelId not present');

    console.log('[PlayAll] → Checking ytInitialData.header.c4TabbedHeaderRenderer.channelId');
    const header = window.ytInitialData?.header?.c4TabbedHeaderRenderer;
    if (header?.channelId) {
      console.log('[PlayAll]    • header channelId =', header.channelId);
      return header.channelId;
    }
    console.log('[PlayAll]    • not present');

    console.log('[PlayAll] → Scanning JSON-LD <script> tags');
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const json = JSON.parse(script.textContent);
        if (json['@type'] === 'Person' && json.mainEntityOfPage?.['@id']) {
          const match = json.mainEntityOfPage['@id'].match(/channel\/([A-Za-z0-9_-]+)/);
          if (match) {
            console.log('[PlayAll]    • JSON-LD channel ID =', match[1]);
            return match[1];
          }
        }
      } catch (error) {
        console.log('[PlayAll]    • JSON-LD parse error', error);
      }
    }
    console.log('[PlayAll]    • no JSON-LD match');

    console.log('[PlayAll] → Scanning <a> for "/channel/"');
    const anchor = document.querySelector('a[href*="/channel/"]');
    if (anchor?.href) {
      const match = anchor.href.match(/\/channel\/([A-Za-z0-9_-]+)/);
      if (match) {
        console.log('[PlayAll]    • anchor href channel ID =', match[1]);
        return match[1];
      }
    }
    console.log('[PlayAll]    • no anchor match');

    console.log('[PlayAll] → Fallback: URL path /channel/ID');
    const parts = location.pathname.split('/');
    const index = parts.indexOf('channel');
    if (index !== -1 && parts[index + 1]) {
      console.log('[PlayAll]    • URL path channelId =', parts[index + 1]);
      return parts[index + 1];
    }
    console.log('[PlayAll]    • URL fallback not applicable');

    return null;
  }

  function injectMenu() {
    removeMenu();

    menu = document.createElement('div');
    menu.id = MENU_ID;
    Object.assign(menu.style, {
      position: 'fixed',
      top: '120px',
      right: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      width: '190px',
      padding: '12px',
      backgroundColor: 'rgba(15, 15, 15, 0.92)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '10px',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
      zIndex: 9999
    });

    const shortsToggle = buildToggleButton(SHORTS_TOGGLE_ID, 'Shorts', includeShorts, () => {
      includeShorts = !includeShorts;
      localStorage.setItem(STORAGE_KEYS.includeShorts, String(includeShorts));
      syncMenuState();
    });

    const liveToggle = buildToggleButton(LIVE_TOGGLE_ID, 'Live', includeLive, () => {
      includeLive = !includeLive;
      localStorage.setItem(STORAGE_KEYS.includeLive, String(includeLive));
      syncMenuState();
    });

    const playButton = document.createElement('button');
    playButton.id = PLAY_BUTTON_ID;
    playButton.addEventListener('click', handlePlayAll);

    Object.assign(playButton.style, buttonStyle('#ff0000'));
    menu.appendChild(shortsToggle);
    menu.appendChild(liveToggle);
    menu.appendChild(playButton);

    document.body.appendChild(menu);
    syncMenuState();
    console.log('[PlayAll] ✅ Menu injected');
  }

  function buildToggleButton(id, label, enabled, onClick) {
    const button = document.createElement('button');
    button.id = id;
    button.dataset.label = label;
    button.addEventListener('click', onClick);
    Object.assign(button.style, buttonStyle(enabled ? '#2e7d32' : '#444'));
    return button;
  }

  function buttonStyle(backgroundColor) {
    return {
      width: '100%',
      padding: '10px 12px',
      backgroundColor,
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      textAlign: 'left'
    };
  }

  function syncMenuState() {
    const shortsToggle = document.getElementById(SHORTS_TOGGLE_ID);
    const liveToggle = document.getElementById(LIVE_TOGGLE_ID);
    const playButton = document.getElementById(PLAY_BUTTON_ID);

    if (shortsToggle) {
      shortsToggle.textContent = `Include Shorts: ${includeShorts ? 'On' : 'Off'}`;
      shortsToggle.style.backgroundColor = includeShorts ? '#2e7d32' : '#444';
    }

    if (liveToggle) {
      liveToggle.textContent = `Include Live: ${includeLive ? 'On' : 'Off'}`;
      liveToggle.style.backgroundColor = includeLive ? '#2e7d32' : '#444';
    }

    if (playButton) {
      playButton.disabled = isBuildingPlaylist;
      playButton.textContent = isBuildingPlaylist ? 'Building playlist...' : '▶ Play All';
      playButton.style.backgroundColor = isBuildingPlaylist ? '#9e9e9e' : '#ff0000';
      playButton.style.cursor = isBuildingPlaylist ? 'wait' : 'pointer';
    }
  }

  async function handlePlayAll() {
    if (isBuildingPlaylist || !currentChannelId) {
      return;
    }

    isBuildingPlaylist = true;
    syncMenuState();

    try {
      console.log('[PlayAll] ▶ Play All clicked', { includeShorts, includeLive });

      if (includeShorts && includeLive && currentChannelId.startsWith('UC')) {
        const uploads = currentChannelId.replace(/^UC/, 'UU');
        const url = `https://www.youtube.com/playlist?list=${uploads}`;
        console.log('[PlayAll] ↗ Redirecting to uploads playlist:', url);
        window.location.href = url;
        return;
      }

      const endpoints = getChannelTabEndpoints();
      if (!endpoints.videos) {
        throw new Error('Could not find the channel Videos tab endpoint.');
      }

      const ids = [];
      const seenIds = new Set();

      await appendTabVideos(ids, seenIds, endpoints.videos, 'videos');

      if (includeShorts) {
        if (!endpoints.shorts) {
          console.warn('[PlayAll] Shorts toggle enabled but Shorts tab was not found.');
        } else {
          await appendTabVideos(ids, seenIds, endpoints.shorts, 'shorts');
        }
      }

      if (includeLive) {
        if (!endpoints.live) {
          console.warn('[PlayAll] Live toggle enabled but Live tab was not found.');
        } else {
          await appendTabVideos(ids, seenIds, endpoints.live, 'live');
        }
      }

      if (!ids.length) {
        throw new Error('No videos were found for the selected filters.');
      }

      const url = `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}`;
      console.log('[PlayAll] ↗ Redirecting to custom playlist with', ids.length, 'videos');
      window.location.href = url;
    } catch (error) {
      console.error('[PlayAll] Failed to build playlist', error);
      alert(`[PlayAll] ${error.message}`);
    } finally {
      isBuildingPlaylist = false;
      syncMenuState();
    }
  }

  async function appendTabVideos(ids, seenIds, endpointInfo, label) {
    console.log(`[PlayAll] → Fetching ${label} tab`);
    const startCount = ids.length;
    let response = await browseEndpoint(endpointInfo.browseEndpoint);
    collectPlayableIds(response, ids, seenIds);

    const seenTokens = new Set();
    let continuation = findContinuationToken(response, seenTokens);

    while (continuation) {
      console.log(`[PlayAll] → Continuing ${label} tab`);
      response = await browseContinuation(continuation);
      collectPlayableIds(response, ids, seenIds);
      continuation = findContinuationToken(response, seenTokens);
    }

    if (ids.length === startCount && endpointInfo.url) {
      console.log(`[PlayAll] → Falling back to HTML scan for ${label} tab`);
      await appendVideosFromTabHtml(ids, seenIds, endpointInfo.url);
    }

    console.log(`[PlayAll]    • ${label} videos collected:`, ids.length);
  }

  function getChannelTabEndpoints() {
    const tabs = window.ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const endpoints = {};

    for (const item of tabs) {
      const renderer = item.tabRenderer || item.expandableTabRenderer;
      const browseEndpoint = renderer?.endpoint?.browseEndpoint;
      const url = renderer?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';

      if (!browseEndpoint || !url) {
        continue;
      }

      if (/\/videos(?:[/?]|$)/.test(url)) {
        endpoints.videos = { browseEndpoint, url };
      } else if (/\/shorts(?:[/?]|$)/.test(url)) {
        endpoints.shorts = { browseEndpoint, url };
      } else if (/\/(?:streams|live)(?:[/?]|$)/.test(url)) {
        endpoints.live = { browseEndpoint, url };
      }
    }

    return endpoints;
  }

  async function browseEndpoint(endpoint) {
    return postBrowse({
      browseId: endpoint.browseId,
      params: endpoint.params,
      canonicalBaseUrl: endpoint.canonicalBaseUrl
    });
  }

  async function browseContinuation(continuation) {
    return postBrowse({ continuation });
  }

  async function postBrowse(payload) {
    const apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY');
    const clientName = window.ytcfg?.get?.('INNERTUBE_CLIENT_NAME');
    const clientVersion = window.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION');
    const context = clone(window.ytcfg?.get?.('INNERTUBE_CONTEXT'));

    if (!apiKey || !clientName || !clientVersion || !context) {
      throw new Error('YouTube API context is not available on this page.');
    }

    const response = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-youtube-client-name': String(clientName),
        'x-youtube-client-version': String(clientVersion)
      },
      body: JSON.stringify({
        context,
        ...payload
      })
    });

    if (!response.ok) {
      throw new Error(`YouTube browse request failed with status ${response.status}.`);
    }

    return response.json();
  }

  async function appendVideosFromTabHtml(ids, seenIds, url) {
    const response = await fetch(toAbsoluteYouTubeUrl(url), {
      credentials: 'same-origin'
    });

    if (!response.ok) {
      throw new Error(`Fallback tab request failed with status ${response.status}.`);
    }

    const html = await response.text();
    const matches = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/g) || [];

    for (const match of matches) {
      const videoId = match.slice(11, -1);
      pushVideoId(videoId, ids, seenIds);
    }
  }

  function collectPlayableIds(node, ids, seenIds) {
    walkEntries(node, (key, value) => {
      if (!value || typeof value !== 'object') {
        return;
      }

      if (isVideoRendererKey(key) && typeof value.videoId === 'string') {
        pushVideoId(value.videoId, ids, seenIds);
      }

      const nestedVideoId = value.videoRenderer?.videoId || value.gridVideoRenderer?.videoId || value.playlistVideoRenderer?.videoId;
      if (typeof nestedVideoId === 'string') {
        pushVideoId(nestedVideoId, ids, seenIds);
      }

      const shortsId = value.shortsLockupViewModel?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
      if (typeof shortsId === 'string') {
        pushVideoId(shortsId, ids, seenIds);
      }

      const reelId = value.reelItemRenderer?.videoId;
      if (typeof reelId === 'string') {
        pushVideoId(reelId, ids, seenIds);
      }
    });
  }

  function isVideoRendererKey(key) {
    return [
      'videoRenderer',
      'gridVideoRenderer',
      'playlistVideoRenderer',
      'compactVideoRenderer',
      'reelItemRenderer',
      'channelVideoPlayerRenderer'
    ].includes(key);
  }

  function pushVideoId(videoId, ids, seenIds) {
    if (!seenIds.has(videoId)) {
      seenIds.add(videoId);
      ids.push(videoId);
    }
  }

  function findContinuationToken(node, seenTokens) {
    let nextToken = null;

    walk(node, value => {
      if (nextToken || !value || typeof value !== 'object') {
        return;
      }

      const continuationToken =
        value.continuationEndpoint?.continuationCommand?.token ||
        value.nextContinuationData?.continuation;

      if (continuationToken && !seenTokens.has(continuationToken)) {
        seenTokens.add(continuationToken);
        nextToken = continuationToken;
      }
    });

    return nextToken;
  }

  function walk(node, visitor) {
    if (!node || typeof node !== 'object') {
      return;
    }

    visitor(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, visitor);
      }
      return;
    }

    for (const value of Object.values(node)) {
      walk(value, visitor);
    }
  }

  function walkEntries(node, visitor) {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walkEntries(item, visitor);
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      visitor(key, value, node);
      walkEntries(value, visitor);
    }
  }

  function hasChannelTabs() {
    return Array.isArray(window.ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs);
  }

  function isLikelyChannelPath() {
    return /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/|$)/.test(location.pathname);
  }

  function loadBoolean(key, fallback) {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === 'true';
  }

  function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function toAbsoluteYouTubeUrl(url) {
    return url.startsWith('http') ? url : `https://www.youtube.com${url}`;
  }

  function removeMenu() {
    const element = document.getElementById(MENU_ID);
    if (element) {
      element.remove();
      console.log('[PlayAll] 🗑️ Menu removed');
    }
    menu = null;
  }
})();
