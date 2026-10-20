'use strict';

// Static safety constraints apply to the actual injected script.
// Prevent potentially expensive browser behavior before browser QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../content-script.js'), 'utf8');
const workerSource = fs.readFileSync(path.resolve(__dirname, '../service-worker.js'), 'utf8');
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
assert.match(workerSource, /async function globallyEnabled\(\)/,
  'Global activity must require one explicit stored setting');
assert.match(workerSource, /if \(!await globallyEnabled\(\)\) return/,
  'All network events must fail closed when global mode is off');
assert.match(workerSource, /message\.type === 'CHATGPT_GENERATION_STARTED'/,
  'Only a new conversation request can trigger lazy activation');
assert.match(workerSource, /function injectedKey\(tabId\)/,
  'Injection attempts must be tracked per tab');
assert.match(workerSource, /chrome\.storage\.session\.set\(\{ \[key\]: true \}\)/,
  'Injection attempt must be recorded before awaiting browser injection');
assert.match(workerSource, /isPopupSender\(sender\)/,
  'Only the extension popup may change global state');
assert.equal((workerSource.match(/chrome\.scripting\.executeScript\(/g) || []).length, 1,
  'There may be only one lazy-injection site');
const injectBlock = workerSource.slice(
  workerSource.indexOf('async function deliverToTab('),
  workerSource.indexOf('function signalToChatTab(')
);
assert.match(injectBlock, /if \(!mayInject \|\| !await globallyEnabled\(\)\) return/,
  'Completion/error events must never inject an uninitialized tab');
assert.doesNotMatch(workerSource, /selectedTabId\(/,
  'Per-tab manual selection may not return');

console.log('PASS Browser safety invariants: zero observers, zero polling, no transcript reads, one global switch, lazy per-request injection');
