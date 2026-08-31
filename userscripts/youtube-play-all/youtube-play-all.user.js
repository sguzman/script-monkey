// ==UserScript==
// @name         YouTube Play All Channel Videos (v1.9.1 - Unlimited Queue)
// @namespace    http://tampermonkey.net/
// @version      1.9.1
// @description  Plays all videos from a YouTube channel with optional Shorts, Live, and members-only inclusion. Chains YouTube's 50-item temporary playlists so the full queue plays.
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const BATCH_SIZE = 50;
  const QUEUE_KEY = 'yt-play-all-full-queue-v1';
  const QUEUE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

  const IDS = {
    menu: 'yt-play-all-menu',
    play: 'yt-play-all-btn',
    shorts: 'yt-play-all-toggle-shorts',
    live: 'yt-play-all-toggle-live',
    members: 'yt-play-all-include-members'
  };

  const KEYS = {
    shorts: 'yt-play-all-include-shorts',
    live: 'yt-play-all-include-live',
    members: 'yt-play-all-include-members'
  };

  let channelId = null;
  let building = false;
  let includeShorts = loadBool(KEYS.shorts, false);
  let includeLive = loadBool(KEYS.live, false);
  let includeMembers = loadBool(KEYS.members, false);
  let queueBindTimer = null;

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

  handleNavigation();

  function handleNavigation() {
    initChannelMenu();
    setupQueuePlayback();
  }

  function initChannelMenu() {
    const id = getChannelId();
    if (!id || !isChannelPage()) {
      channelId = null;
      document.getElementById(IDS.menu)?.remove();
      return;
    }

    if (id !== channelId || !document.getElementById(IDS.menu)) {
      channelId = id;
      injectMenu();
    }
  }

  function getChannelId() {
    const meta = document.querySelector('meta[itemprop="channelId"]')?.content;
    if (meta) return meta;

    const cfg = window.ytcfg?.get?.('CHANNEL_ID');
    if (cfg) return cfg;

    const metadata = window.ytInitialData?.metadata?.channelMetadataRenderer;
    if (metadata?.externalId) return metadata.externalId;
    if (metadata?.externalChannelId) return metadata.externalChannelId;

    const header = window.ytInitialData?.header?.c4TabbedHeaderRenderer?.channelId;
    if (header) return header;

    const anchor = document.querySelector('a[href*="/channel/"]')?.href?.match(/\/channel\/([A-Za-z0-9_-]+)/)?.[1];
    if (anchor) return anchor;

    return location.pathname.match(/^\/channel\/([^/]+)/)?.[1] || null;
  }

  function isChannelPage() {
    return Array.isArray(window.ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs)
      || /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/|$)/.test(location.pathname);
  }

  function injectMenu() {
    document.getElementById(IDS.menu)?.remove();

    const menu = document.createElement('div');
    menu.id = IDS.menu;
    Object.assign(menu.style, {
      position: 'fixed',
      top: '120px',
      right: '20px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      width: '190px',
      padding: '12px',
      backgroundColor: 'rgba(15,15,15,.92)',
      border: '1px solid rgba(255,255,255,.12)',
      borderRadius: '10px',
      boxShadow: '0 8px 24px rgba(0,0,0,.35)'
    });

    menu.appendChild(toggle(IDS.shorts, () => includeShorts, value => {
      includeShorts = value;
      save(KEYS.shorts, value);
    }));

    menu.appendChild(toggle(IDS.live, () => includeLive, value => {
      includeLive = value;
      save(KEYS.live, value);
    }));

    menu.appendChild(toggle(IDS.members, () => includeMembers, value => {
      includeMembers = value;
      save(KEYS.members, value);
    }));

    const play = document.createElement('button');
    play.id = IDS.play;
    Object.assign(play.style, buttonStyle('#ff0000'));
    play.addEventListener('click', playAll);

    menu.appendChild(play);
    document.body.appendChild(menu);
    syncMenu();
  }

  function toggle(id, getValue, setValue) {
    const button = document.createElement('button');
    button.id = id;
    Object.assign(button.style, buttonStyle('#444'));
    button.addEventListener('click', () => {
      setValue(!getValue());
      syncMenu();
    });
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

  function syncMenu() {
    syncToggle(IDS.shorts, `Include Shorts: ${includeShorts ? 'On' : 'Off'}`, includeShorts);
    syncToggle(IDS.live, `Include Live: ${includeLive ? 'On' : 'Off'}`, includeLive);
    syncToggle(IDS.members, `Include Members-only: ${includeMembers ? 'On' : 'Off'}`, includeMembers);

    const play = document.getElementById(IDS.play);
    if (play) {
      play.disabled = building;
      play.textContent = building ? 'Building playlist...' : '▶ Play All';
      play.style.backgroundColor = building ? '#9e9e9e' : '#ff0000';
      play.style.cursor = building ? 'wait' : 'pointer';
    }
  }

  function syncToggle(id, text, enabled) {
    const button = document.getElementById(id);
    if (!button) return;
    button.textContent = text;
    button.style.backgroundColor = enabled ? '#2e7d32' : '#444';
  }

  async function playAll() {
    if (building || !channelId) return;

    building = true;
    syncMenu();

    try {
      clearQueue();

      // If absolutely everything is included, YouTube's own uploads playlist is already unlimited.
      if (includeShorts && includeLive && includeMembers && channelId.startsWith('UC')) {
        location.href = `https://www.youtube.com/playlist?list=${channelId.replace(/^UC/, 'UU')}`;
        return;
      }

      const tabs = getTabEndpoints();
      if (!tabs.videos) throw new Error('Could not find the channel Videos tab endpoint.');

      const ids = [];
      const seen = new Set();

      await appendTab(ids, seen, tabs.videos, 'videos');

      if (includeShorts) {
        if (tabs.shorts) await appendTab(ids, seen, tabs.shorts, 'shorts');
        else console.warn('[PlayAll] Shorts enabled, but no Shorts tab endpoint was found.');
      }

      if (includeLive) {
        if (tabs.live) await appendTab(ids, seen, tabs.live, 'live');
        else console.warn('[PlayAll] Live enabled, but no Live tab endpoint was found.');
      }

      if (!ids.length) throw new Error('No videos were found for the selected filters.');

      console.log(`[PlayAll] Collected ${ids.length} videos. YouTube temporary playlists are limited to ${BATCH_SIZE}, so batches will be chained automatically.`);

      saveQueue(ids);
      openBatch(ids, 0);
    } catch (error) {
      console.error('[PlayAll]', error);
      alert(`[PlayAll] ${error.message}`);
    } finally {
      building = false;
      syncMenu();
    }
  }

  function getTabEndpoints() {
    const out = {};
    const tabs = window.ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];

    for (const item of tabs) {
      const renderer = item.tabRenderer || item.expandableTabRenderer;
      const browseEndpoint = renderer?.endpoint?.browseEndpoint;
      const url = renderer?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';

      if (!browseEndpoint || !url) continue;

      if (/\/videos(?:[/?]|$)/.test(url)) out.videos = { browseEndpoint, url };
      else if (/\/shorts(?:[/?]|$)/.test(url)) out.shorts = { browseEndpoint, url };
      else if (/\/(?:streams|live)(?:[/?]|$)/.test(url)) out.live = { browseEndpoint, url };
    }

    return out;
  }

  async function appendTab(ids, seen, endpoint, label) {
    const before = ids.length;
    let candidates = 0;

    let data = await browse(endpoint.browseEndpoint);
    candidates += collectIds(data, ids, seen);

    const seenTokens = new Set();
    let token = continuation(data, seenTokens);

    while (token) {
      data = await postBrowse({ continuation: token });
      candidates += collectIds(data, ids, seen);
      token = continuation(data, seenTokens);
    }

    if (!candidates && endpoint.url) {
      await appendHtmlFallback(ids, seen, endpoint.url);
    }

    console.log(`[PlayAll] ${label}: added ${ids.length - before}, total ${ids.length}`);
  }

  function browse(endpoint) {
    return postBrowse({
      browseId: endpoint.browseId,
      params: endpoint.params,
      canonicalBaseUrl: endpoint.canonicalBaseUrl
    });
  }

  async function postBrowse(payload) {
    const key = window.ytcfg?.get?.('INNERTUBE_API_KEY');
    const name = window.ytcfg?.get?.('INNERTUBE_CLIENT_NAME');
    const version = window.ytcfg?.get?.('INNERTUBE_CLIENT_VERSION');
    const context = clone(window.ytcfg?.get?.('INNERTUBE_CONTEXT'));

    if (!key || !name || !version || !context) {
      throw new Error('YouTube API context is not available.');
    }

    const response = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-youtube-client-name': String(name),
        'x-youtube-client-version': String(version)
      },
      body: JSON.stringify({ context, ...payload })
    });

    if (!response.ok) {
      throw new Error(`YouTube browse request failed with status ${response.status}.`);
    }

    return response.json();
  }

  async function appendHtmlFallback(ids, seen, url) {
    const response = await fetch(absUrl(url), { credentials: 'same-origin' });

    if (!response.ok) {
      throw new Error(`Fallback tab request failed with status ${response.status}.`);
    }

    const html = await response.text();
    const data = extractInitialData(html);

    if (data) {
      collectIds(data, ids, seen);
      return;
    }

    // A raw videoId regex loses members-only badge context, so only use it when members are included.
    if (!includeMembers) return;

    for (const match of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) {
      push(match[1], ids, seen);
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
        id = value.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || null;
      } else if (key === 'lockupViewModel' && value.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
        id = value.contentId || null;
      }

      if (!id) return;

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
    'compactVideoRenderer',
    'reelItemRenderer',
    'channelVideoPlayerRenderer'
  ]);

  function isMembersOnly(renderer) {
    let found = false;

    walk(renderer, value => {
      if (found || !value || typeof value !== 'object') return;

      const style = value.style || value.badgeStyle;
      found = style === 'BADGE_STYLE_TYPE_MEMBERS_ONLY'
        || style === 'BADGE_MEMBERS_ONLY'
        || (typeof value.label === 'string' && value.label.trim().toLowerCase() === 'members only');
    });

    return found;
  }

  function continuation(node, seen) {
    let token = null;

    walk(node, value => {
      if (token || !value || typeof value !== 'object') return;

      const next = value.continuationEndpoint?.continuationCommand?.token
        || value.nextContinuationData?.continuation;

      if (next && !seen.has(next)) {
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

  function clearQueue() {
    sessionStorage.removeItem(QUEUE_KEY);

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

    console.log(`[PlayAll] Opening batch ${Math.floor(startIndex / BATCH_SIZE) + 1}/${Math.ceil(ids.length / BATCH_SIZE)} (${startIndex + 1}-${startIndex + batch.length} of ${ids.length})`);
    location.href = `https://www.youtube.com/watch_videos?video_ids=${batch.join(',')}`;
  }

  function setupQueuePlayback() {
    const queue = readQueue();
    if (!queue || location.pathname !== '/watch') return;

    const currentId = new URLSearchParams(location.search).get('v');
    if (!currentId) return;

    const index = queue.ids.indexOf(currentId);
    if (index < 0) return;

    bindQueueBoundary(index, queue.ids);
  }

  function bindQueueBoundary(index, ids) {
    const video = document.querySelector('video');

    if (!video) {
      queueBindTimer = setTimeout(() => bindQueueBoundary(index, ids), 300);
      return;
    }

    queueBindTimer = null;

    const bindingKey = `${ids[index]}:${index}`;
    if (video.dataset.ytPlayAllBinding === bindingKey) return;
    video.dataset.ytPlayAllBinding = bindingKey;

    video.addEventListener('ended', () => {
      if (index === ids.length - 1) {
        console.log('[PlayAll] Full queue completed.');
        clearQueue();
        return;
      }

      const currentBatch = Math.floor(index / BATCH_SIZE);
      const nextBatch = Math.floor((index + 1) / BATCH_SIZE);

      if (nextBatch > currentBatch) {
        console.log(`[PlayAll] Batch ${currentBatch + 1} complete; opening batch ${nextBatch + 1}.`);
        video.pause();
        openBatch(ids, index + 1);
      }
    }, { capture: true, once: true });
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

  function loadBool(key, fallback) {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === 'true';
  }

  function save(key, value) {
    localStorage.setItem(key, String(value));
  }

  function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function absUrl(url) {
    return url.startsWith('http') ? url : `https://www.youtube.com${url}`;
  }
})();
