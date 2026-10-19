'use strict';

// Deliberately conservative tripwires against the October 19 multi-tab incident.
// Review any relaxation explicitly; do not re-introduce head/DOM observers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../content-script.js'), 'utf8');
function numericConstant(name) {
  const match = source.match(new RegExp('\\bconst ' + name + ' = (\\d+);'));
  assert.ok(match, 'Missing measurable ' + name + ' budget');
  return Number(match[1]);
}
assert.doesNotMatch(source, /new\s+MutationObserver\s*\(/,
  'Do not attach DOM mutation observers to live ChatGPT tabs');
assert.doesNotMatch(source, /\.observe\s*\(\s*document\.head/,
  'Head observation is prohibited');
assert.equal((source.match(/setInterval\s*\(/g) || []).length, 1,
  'Only one completion timer is permitted');
assert.equal((source.match(/setTimeout\s*\(/g) || []).length, 0,
  'Do not add independent delayed page timers');
assert.ok(numericConstant('STREAM_POLL_MS') >= 3000,
  'Completion polling must remain slow and bounded');
assert.ok(numericConstant('GENERATION_HARD_CAP_MS') <= 180000,
  'Stalled watchers must stop within three minutes');
assert.ok(numericConstant('MAX_RECENT_TURNS') <= 96,
  'JavaScript must not traverse unbounded conversation history');
assert.match(source, /response:\s*snapshot\.response\.slice\(0,\s*260\)/,
  'Extension IPC may carry only a short notification preview');
assert.doesNotMatch(source, /document\.title\s*=\s*['"`][●◌]/,
  'Do not add legacy marker prefixes to titles');
console.log('PASS Browser resource-safety tripwires');
