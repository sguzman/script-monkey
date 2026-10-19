'use strict';

// Hard tripwires against the October 19 browser incident. These apply to the
// actual injected script and fail CI before any browser QA is considered.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../content-script.js'), 'utf8');
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
assert.doesNotMatch(source, /document\.(?:querySelector|querySelectorAll)\s*\(/,
  'No full-document selectors: do not inspect conversation DOM');
assert.doesNotMatch(source, /\b(?:textContent|innerText|innerHTML)\b/,
  'No conversation text extraction or full-answer IPC');
assert.doesNotMatch(source, /document\.head\?\.querySelectorAll\([^\n]*conversation/,
  'Head queries must be favicon-only');
assert.match(source, /response:\s*'Response finished\.'/,
  'Notifications must contain a static preview, not page content');
assert.doesNotMatch(source, /document\.title\s*=\s*['"][●◌]/,
  'Do not add title marker prefixes');
console.log('PASS Browser resource-safety invariants: zero observers, zero polling, no transcript reads');
