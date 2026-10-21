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
    // Legacy emoji is retained for API compatibility; the actual favicon
    // now uses exact hex color, with title emoji reserved for status.
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


  // Perceptual palette v2. Candidate swatches are shared and deterministic;
  // the chosen color maximizes minimum OKLab separation from colors already
  // assigned to OTHER open conversations. No random state or I/O.
  const PALETTE_V2 = Object.freeze([0.55, 0.70, 0.42].flatMap((l, band) =>
    Array.from({ length: 24 }, (_, index) =>
      hexFromHsl(index * 15 + (band === 1 ? 7.5 : 0),
        band === 2 ? 0.80 : 0.75, l)
    )
  ));

  function toOklab(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
    const values = [1, 3, 5].map(i => {
      const n = parseInt(hex.slice(i, i + 2), 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    const [r, g, b] = values;
    const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
    const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
    const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
    return [
      0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
      1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
      0.0259040371*l + 0.7827717662*m - 0.8086757660*s
    ];
  }

  const PALETTE_LAB = PALETTE_V2.map(toOklab);
  function oklabDistance(first, second) {
    const a = Array.isArray(first) ? first : toOklab(first);
    const b = Array.isArray(second) ? second : toOklab(second);
    if (!a || !b) return 0;
    return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
  }

  function assignFromUrl(url, occupiedHexes = []) {
    const identity = fromUrl(url);
    if (!identity) return null;
    // Input is bounded so a malformed caller cannot cause excessive work.
    const occupied = (Array.isArray(occupiedHexes) ? occupiedHexes : [])
      .slice(0, 40).map(toOklab).filter(Boolean);
    const seed = hash32('chatgpt-tab-color-v2/' + identity.key);
    let selected = seed % PALETTE_V2.length;
    if (occupied.length) {
      let highest = -1;
      let tie = -1;
      for (let index = 0; index < PALETTE_V2.length; index++) {
        const minimum = Math.min(...occupied.map(
          other => oklabDistance(PALETTE_LAB[index], other)
        ));
        // Prefer the perceptually farthest choice, with stable hash tie-break.
        const rank = hash32('chatgpt-tab-color-v2/' + identity.key + ':' + index);
        if (minimum > highest + 1e-10 ||
            (Math.abs(minimum-highest) <= 1e-10 && rank > tie)) {
          highest = minimum;
          tie = rank;
          selected = index;
        }
      }
    }
    return Object.freeze({
      ...identity, hex: PALETTE_V2[selected],
      paletteVersion: 2, paletteIndex: selected
    });
  }

  const api = Object.freeze({ version: 1, perceptualVersion: 2, parse, hash32, fromUrl, assignFromUrl, oklabDistance });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChatGPTConversationColor = api;
})(typeof globalThis === 'object' ? globalThis : null);
