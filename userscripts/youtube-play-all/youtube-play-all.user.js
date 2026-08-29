// ==UserScript==
// @name         YouTube Play All Channel Videos (v1.8 - Members Filter)
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Plays all videos from a YouTube channel with optional Shorts/Live inclusion and members-only exclusion.
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const IDS = {
    menu: 'yt-play-all-menu',
    play: 'yt-play-all-btn',
    shorts: 'yt-play-all-toggle-shorts',
    live: 'yt-play-all-toggle-live',
    members: 'yt-play-all-exclude-members'
  };
  const KEYS = {
    shorts: 'yt-play-all-include-shorts',
    live: 'yt-play-all-include-live',
    members: 'yt-play-all-exclude-members'
  };

  let channelId = null;
  let building = false;
  let includeShorts = loadBool(KEYS.shorts, false);
  let includeLive = loadBool(KEYS.live, false);
  let excludeMembers = loadBool(KEYS.members, true);

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
  }
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
  window.addEventListener('locationchange', init);
  init();

  function init() {
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
      position: 'fixed', top: '120px', right: '20px', zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: '8px', width: '190px', padding: '12px',
      backgroundColor: 'rgba(15,15,15,.92)', border: '1px solid rgba(255,255,255,.12)',
      borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,.35)'
    });

    menu.appendChild(toggle(IDS.shorts, () => includeShorts, v => {
      includeShorts = v; save(KEYS.shorts, v);
    }));
    menu.appendChild(toggle(IDS.live, () => includeLive, v => {
      includeLive = v; save(KEYS.live, v);
    }));
    menu.appendChild(checkbox(IDS.members, 'Exclude members-only', excludeMembers, v => {
      excludeMembers = v; save(KEYS.members, v);
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
    const btn = document.createElement('button');
    btn.id = id;
    Object.assign(btn.style, buttonStyle('#444'));
    btn.addEventListener('click', () => { setValue(!getValue()); syncMenu(); });
    return btn;
  }

  function checkbox(id, text, checked, onChange) {
    const label = document.createElement('label');
    Object.assign(label.style, {
      display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 10px',
      backgroundColor: '#222', color: '#fff', borderRadius: '6px',
      fontSize: '14px', fontWeight: '600', cursor: 'pointer'
    });
    const input = document.createElement('input');
    input.type = 'checkbox'; input.id = id; input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input, document.createTextNode(text));
    return label;
  }

  function buttonStyle(backgroundColor) {
    return {
      width: '100%', padding: '10px 12px', backgroundColor, color: '#fff', border: 'none',
      borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', textAlign: 'left'
    };
  }

  function syncMenu() {
    const shorts = document.getElementById(IDS.shorts);
    const live = document.getElementById(IDS.live);
    const members = document.getElementById(IDS.members);
    const play = document.getElementById(IDS.play);
    if (shorts) {
      shorts.textContent = `Include Shorts: ${includeShorts ? 'On' : 'Off'}`;
      shorts.style.backgroundColor = includeShorts ? '#2e7d32' : '#444';
    }
    if (live) {
      live.textContent = `Include Live: ${includeLive ? 'On' : 'Off'}`;
      live.style.backgroundColor = includeLive ? '#2e7d32' : '#444';
    }
    if (members) members.checked = excludeMembers;
    if (play) {
      play.disabled = building;
      play.textContent = building ? 'Building playlist...' : '▶ Play All';
      play.style.backgroundColor = building ? '#9e9e9e' : '#ff0000';
      play.style.cursor = building ? 'wait' : 'pointer';
    }
  }

  async function playAll() {
    if (building || !channelId) return;
    building = true; syncMenu();
    try {
      // The uploads-playlist shortcut cannot be used while filtering members-only videos.
      if (includeShorts && includeLive && !excludeMembers && channelId.startsWith('UC')) {
        location.href = `https://www.youtube.com/playlist?list=${channelId.replace(/^UC/, 'UU')}`;
        return;
      }

      const tabs = getTabEndpoints();
      if (!tabs.videos) throw new Error('Could not find the channel Videos tab endpoint.');
      const ids = [], seen = new Set();
      await appendTab(ids, seen, tabs.videos, 'videos');
      if (includeShorts && tabs.shorts) await appendTab(ids, seen, tabs.shorts, 'shorts');
      if (includeLive && tabs.live) await appendTab(ids, seen, tabs.live, 'live');
      if (!ids.length) throw new Error('No videos were found for the selected filters.');
      location.href = `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}`;
    } catch (error) {
      console.error('[PlayAll]', error);
      alert(`[PlayAll] ${error.message}`);
    } finally {
      building = false; syncMenu();
    }
  }

  function getTabEndpoints() {
    const out = {};
    for (const item of window.ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs || []) {
      const r = item.tabRenderer || item.expandableTabRenderer;
      const browseEndpoint = r?.endpoint?.browseEndpoint;
      const url = r?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
      if (!browseEndpoint || !url) continue;
      if (/\/videos(?:[/?]|$)/.test(url)) out.videos = { browseEndpoint, url };
      else if (/\/shorts(?:[/?]|$)/.test(url)) out.shorts = { browseEndpoint, url };
      else if (/\/(?:streams|live)(?:[/?]|$)/.test(url)) out.live = { browseEndpoint, url };
    }
    return out;
  }

  async function appendTab(ids, seen, endpoint, label) {
    let candidates = 0;
    let data = await browse(endpoint.browseEndpoint);
    candidates += collectIds(data, ids, seen);
    const tokens = new Set();
    let token = continuation(data, tokens);
    while (token) {
      data = await postBrowse({ continuation: token });
      candidates += collectIds(data, ids, seen);
      token = continuation(data, tokens);
    }
    if (!candidates && endpoint.url) await appendHtmlFallback(ids, seen, endpoint.url);
    console.log(`[PlayAll] ${label}: ${ids.length} total playlist videos`);
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
    if (!key || !name || !version || !context) throw new Error('YouTube API context is not available.');
    const r = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(key)}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-youtube-client-name': String(name), 'x-youtube-client-version': String(version) },
      body: JSON.stringify({ context, ...payload })
    });
    if (!r.ok) throw new Error(`YouTube browse request failed with status ${r.status}.`);
    return r.json();
  }

  async function appendHtmlFallback(ids, seen, url) {
    const r = await fetch(absUrl(url), { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`Fallback tab request failed with status ${r.status}.`);
    const html = await r.text();
    const data = extractInitialData(html);
    if (data) return void collectIds(data, ids, seen);
    // Raw videoId regex cannot tell member-only from public; never use it while exclusion is enabled.
    if (excludeMembers) return;
    for (const match of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) push(match[1], ids, seen);
  }

  function collectIds(node, ids, seen) {
    let candidates = 0;
    walkEntries(node, (key, value) => {
      if (!value || typeof value !== 'object') return;
      let id = null;
      if (VIDEO_RENDERERS.has(key) && typeof value.videoId === 'string') id = value.videoId;
      else if (key === 'shortsLockupViewModel') id = value.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || null;
      else if (key === 'lockupViewModel' && value.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') id = value.contentId || null;
      if (!id) return;
      candidates++;
      if (excludeMembers && isMembersOnly(value)) return;
      push(id, ids, seen);
    });
    return candidates;
  }

  const VIDEO_RENDERERS = new Set([
    'videoRenderer', 'gridVideoRenderer', 'playlistVideoRenderer',
    'compactVideoRenderer', 'reelItemRenderer', 'channelVideoPlayerRenderer'
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
      const t = value.continuationEndpoint?.continuationCommand?.token || value.nextContinuationData?.continuation;
      if (t && !seen.has(t)) { seen.add(t); token = t; }
    });
    return token;
  }

  function extractInitialData(html) {
    for (const marker of ['var ytInitialData = ', 'window["ytInitialData"] = ', "window['ytInitialData'] = ", 'ytInitialData = ']) {
      const at = html.indexOf(marker);
      if (at < 0) continue;
      const start = html.indexOf('{', at + marker.length);
      if (start < 0) continue;
      const text = balancedObject(html, start);
      if (!text) continue;
      try { return JSON.parse(text); } catch {}
    }
    return null;
  }

  function balancedObject(text, start) {
    let depth = 0, string = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (string) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') string = false;
        continue;
      }
      if (c === '"') string = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  function walk(node, fn) {
    if (!node || typeof node !== 'object') return;
    fn(node);
    for (const value of Array.isArray(node) ? node : Object.values(node)) walk(value, fn);
  }

  function walkEntries(node, fn) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return void node.forEach(v => walkEntries(v, fn));
    for (const [key, value] of Object.entries(node)) { fn(key, value); walkEntries(value, fn); }
  }

  function push(id, ids, seen) { if (!seen.has(id)) { seen.add(id); ids.push(id); } }
  function loadBool(key, fallback) { const v = localStorage.getItem(key); return v == null ? fallback : v === 'true'; }
  function save(key, value) { localStorage.setItem(key, String(value)); }
  function clone(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }
  function absUrl(url) { return url.startsWith('http') ? url : `https://www.youtube.com${url}`; }
})();
