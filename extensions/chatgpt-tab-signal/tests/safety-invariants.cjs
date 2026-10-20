'use strict';

// Static safety constraints apply to the actual injected script.
// Prevent potentially expensive browser behavior before browser QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../content-script.js'), 'utf8');
const workerSource = fs.readFileSync(path.resolve(__dirname, '../service-worker.js'), 'utf8');
const titleSource = fs.readFileSync(path.resolve(__dirname, '../chat-color-title.js'), 'utf8');
function constant(name) {
  const match = source.match(new RegExp('\\bconst ' + name + ' = (\\d+);'));
  assert.ok(match, 'Missing bounded ' + name);
  return Number(match[1]);
}
assert.doesNotMatch(source, /new\s+MutationObserver\s*\(/,
  'No permanent or temporary MutationObserver in ChatGPT tabs');
assert.doesNotMatch(source, /new\s+(?:ResizeObserver|IntersectionObserver)\s*\(/,
  'No hidden alternate page-wide DOM observers');
assert.doesNotMatch(source, /(?:^|[^\w])setInterval\s*\(/,
  'No polling timers at all');
assert.equal((source.match(/\bsetTimeout\s*\(/g) || []).length, 1,
  'Exactly one cancellable post-network settling timeout');
assert.equal((source.match(/\bclearTimeout\s*\(/g) || []).length, 1,
  'The settling timeout must be cancellable');
assert.ok(constant('RENDER_SETTLE_DELAY_MS') <= 3000,
  'Network settle timeout must be short');
assert.ok(constant('MAX_REQUEST_EVENTS_PER_MINUTE') <= 60,
  'Lifecycle event budget must cap per-tab event storms');
assert.match(source, /eventWindowBlocked/,
  'Once the event budget is exceeded, the tab must fail closed');
assert.doesNotMatch(source, /document\.(?:querySelector|querySelectorAll)\s*\(/,
  'No full-document selectors: do not inspect conversation DOM');
assert.doesNotMatch(source, /\b(?:textContent|innerText|innerHTML)\b/,
  'No conversation text extraction or full-answer IPC');
assert.doesNotMatch(source, /document\.head\?\.querySelectorAll\([^\n]*conversation/,
  'Head queries must be favicon-only');
assert.match(source, /response:\s*'Response finished\.'/,
  'Notifications must contain a static preview, not page content');
assert.doesNotMatch(source, /document\.title\s*=/,
  'Never modify conversation titles at all');
assert.doesNotMatch(workerSource, /globallyEnabled|enableAll|disableAll|GLOBAL_ENABLED_KEY/,
  'No global activation switch may remain');
assert.match(workerSource, /message\.type === 'CHATGPT_GENERATION_STARTED'/,
  'Only a new ChatGPT conversation POST may cause lazy injection');
assert.match(workerSource, /function injectedKey\(tabId\)/,
  'Per-document injection must be bounded');
assert.match(workerSource, /chrome\.storage\.session\.set\(\{ \[key\]: \{ documentId: docId \} \}\)/,
  'Document-specific injection marker must be persisted before attempting injection');
assert.match(workerSource, /documentId: details\.documentId \|\| null/,
  'Conversation request must carry Chrome document identity');
assert.doesNotMatch(workerSource, /chrome\.tabs\.onUpdated\.addListener\(/,
  'A tab loading event must not revoke same-document SPA conversations');
assert.match(workerSource, /documentEpoch\(tabId\)/,
  'Stale navigation events must be ignored');
assert.equal((workerSource.match(/chrome\.scripting\.executeScript\(/g) || []).length, 2,
  'One POST-driven status injection and one install-only color injection are permitted');
const injectionBlock = workerSource.slice(
  workerSource.indexOf('async function deliverToTab('),
  workerSource.indexOf('function signalToChatTab(')
);
assert.match(injectionBlock, /if \(!mayInject \|\| epoch !== documentEpoch\(tabId\)\) return/,
  'Completion/error events must never inject');
assert.equal((workerSource.match(/chrome\.tabs\.query\(/g) || []).length, 1,
  'Only the one-shot install/upgrade color bootstrap may enumerate tabs');
const colorUpgrade = workerSource.slice(
  workerSource.indexOf('// On installation/update, color existing conversation tabs once'),
  workerSource.indexOf('chrome.tabs.onRemoved.addListener')
);
assert.match(colorUpgrade, /chrome\.runtime\.onInstalled\.addListener\(/);
assert.match(colorUpgrade, /tabs\.slice\(0, 40\)/,
  'At most 40 existing chat tabs can be decorated per upgrade');
assert.doesNotMatch(colorUpgrade, /content-script\.js/,
  'Upgrade must NEVER load the response watcher into idle tabs');
assert.match(colorUpgrade, /files: \['conversation-color\.js', 'chat-color-title\.js'\]/);
assert.match(workerSource, /files: \['conversation-color\.js', 'chat-color-title\.js', 'content-script\.js'\]/,
  'Only POST-triggered injection may load the response-status watcher');
assert.doesNotMatch(titleSource, /setInterval\s*\(|setTimeout\s*\(/,
  'Title color may not poll');
assert.match(titleSource, /document\.head\?\.querySelector\('title'\)/,
  'Title observer must attach to the title node, not the head element');
assert.doesNotMatch(titleSource, /document\.(?:querySelector|querySelectorAll)\s*\(/,
  'Title color must never inspect conversation DOM');
assert.match(titleSource, /MAX_WRITES_PER_MINUTE = 24/,
  'Title rewrites must be rate-limited');
assert.match(titleSource, /titleObserver\?\.disconnect\(\)/,
  'Title observer stops on pathological page-title churn');
assert.doesNotMatch(workerSource, /chrome\.action\.set(?:Icon|BadgeText|BadgeBackgroundColor)/,
  'Never modify the extension toolbar icon or badge');
assert.doesNotMatch(source, /CHATGPT_TAB_STATE/,
  'Favicon states must not be routed to an extension toolbar button');
assert.match(source, /originalFavicons = new Map\(\)/,
  'Site favicon candidates must be backed up and restored');
assert.match(source, /link\[rel~="icon"\]/,
  'Only actual site favicon candidates may be rewritten');

console.log('PASS Browser safety invariants: bounded title-only observer, no polling or transcript reads; response watcher remains POST-driven');
