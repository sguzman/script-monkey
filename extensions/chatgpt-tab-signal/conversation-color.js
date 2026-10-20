'use strict';

// Stable public color derivation for ChatGPT conversations.
// v1: FNV-1a over a canonical route key, then HSL -> sRGB. No storage,
// network access, runtime entropy, or dependence on the conversation title.
// Browser: globalThis.ChatGPTConversationColor.fromUrl(url).
// Node: require('./conversation-color.js').fromUrl(url).
(function exposeConversationColor(root) {
  const COMMON = ['🟥', '🟧', '🟨', '🟩', '🟦', '🟪'];
  const PROJECT = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'];
  const SAFE_ID = '[A-Za-z0-9_-]{3,128}';

  function parse(url) {
    let parsed;
    try { parsed = new URL(String(url)); }
    catch { return null; }
    if (parsed.origin !== 'https://chatgpt.com') return null;
    const path = parsed.pathname;
    let match = new RegExp('^/c/(' + SAFE_ID + ')/?$').exec(path);
    if (match) return {
      kind: 'chat', chatId: match[1], scopeId: null,
      key: 'chat:' + match[1]
    };
    match = new RegExp('^/g/(g-p-' + SAFE_ID + ')/c/(' + SAFE_ID + ')/?$').exec(path);
    if (match) return {
      kind: 'project', chatId: match[2], scopeId: match[1],
      key: 'project:' + match[1] + '/chat:' + match[2]
    };
    // Custom-GPT conversations are also chats, but not project chats.
    match = new RegExp('^/g/(g-' + SAFE_ID + ')/c/(' + SAFE_ID + ')/?$').exec(path);
    if (match) return {
      kind: 'gpt', chatId: match[2], scopeId: match[1],
      key: 'gpt:' + match[1] + '/chat:' + match[2]
    };
    return null;
  }

  function hash32(value) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function hexFromHsl(hue, saturation, lightness) {
    const a = saturation * Math.min(lightness, 1 - lightness);
    const channel = n => {
      const k = (n + hue / 30) % 12;
      const v = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * v).toString(16).padStart(2, '0');
    };
    return '#' + channel(0) + channel(8) + channel(4);
  }

  function fromUrl(url) {
    const identity = parse(url);
    if (!identity) return null;
    const hash = hash32('chatgpt-tab-color-v1/' + identity.key);
    const hue = hash % 360;
    // Browser tab titles can show emoji, not custom-color text. The emoji
    // is the closest six-band identifier; hex is the precise stable color.
    const index = Math.floor((((hue + 30) % 360) / 60));
    const emoji = (identity.kind === 'project' ? PROJECT : COMMON)[index];
    const hex = hexFromHsl(hue, 0.72, 0.55);
    return Object.freeze({
      kind: identity.kind,
      chatId: identity.chatId,
      scopeId: identity.scopeId,
      key: identity.key,
      hash,
      hue,
      hex,
      emoji
    });
  }

  const api = Object.freeze({ version: 1, parse, hash32, fromUrl });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatGPTConversationColor = api;
})(typeof globalThis === 'object' ? globalThis : null);
