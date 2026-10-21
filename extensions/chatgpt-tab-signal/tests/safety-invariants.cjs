'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../' + file), 'utf8');
const source = read('content-script.js');
const worker = read('service-worker.js');
const ui = read('chat-color-title.js');
const color = read('conversation-color.js');

// Never observe ChatGPT's page tree or repeatedly scan a streamed response.
assert.doesNotMatch(source, /new\s+(?:MutationObserver|ResizeObserver|IntersectionObserver)\s*\(/);
assert.doesNotMatch(source, /setInterval\s*\(/);
assert.doesNotMatch(ui, /setInterval\s*\(|setTimeout\s*\(/);
assert.equal((source.match(/\bsetTimeout\s*\(/g) || []).length, 2,
  'Only one completion delay and one failure-banner settle check allowed');
assert.equal((source.match(/\bclearTimeout\s*\(/g) || []).length, 2);
assert.match(source, /MAX_REQUEST_EVENTS_PER_MINUTE = 60/);
assert.match(source, /eventWindowBlocked/);
assert.match(source, /RENDER_SETTLE_DELAY_MS = 2500/);
assert.doesNotMatch(source, /document\.(?:querySelector|querySelectorAll)\s*\(/);
assert.doesNotMatch(source, /textContent|innerText|innerHTML/,
  'Status watcher cannot read conversation contents');
assert.doesNotMatch(source, /document\.title\s*=/);
assert.match(source, /response:\s*'Response finished\.'/);
assert.match(source, /visibleError\(\)/);
assert.match(source, /scheduleErrorCheck\(requestId\)/);
assert.match(source, /suppressedRequestId/);

// One light, bounded UI owner. Its only observer is <title>, not head,
// body, transcript, or the favicon declarations.
assert.equal((ui.match(/new MutationObserver\s*\(/g)||[]).length,1);
assert.match(ui, /document\.head\?\.querySelector\('title'\)/);
assert.match(ui, /titleObserver\.observe\(element,/);
assert.match(ui, /MAX_WRITES_PER_MINUTE = 24/);
assert.match(ui, /MAX_ICON_WRITES_PER_MINUTE = 48/);
assert.match(ui, /titleObserver\?\.disconnect\(\)/);
assert.match(ui, /document\.head\.querySelectorAll\('link\[rel~="icon"\]'\)/);
assert.match(ui, /canvas\.toDataURL\('image\/png'\)/);
assert.match(ui, /color\.kind === 'project'/);
assert.match(ui, /__chatgptTabSignalSetStatus/);
assert.match(ui, /__chatgptTabSignalDetectError/);
assert.match(ui, /maximum length for this conversation/);
assert.match(ui, /message delivery timed out/);
assert.doesNotMatch(ui, /data-message-author-role.*textContent/s,
  'No transcript extraction permitted');
assert.doesNotMatch(color, /fetch\s*\(|XMLHttpRequest|localStorage/,
  'Color identity is pure and reproducible');

// Keep the proven lazy-worker and notification mechanics unchanged.
assert.doesNotMatch(worker,/globallyEnabled|enableAll|disableAll|GLOBAL_ENABLED_KEY/);
assert.match(worker,/message\.type === 'CHATGPT_GENERATION_STARTED'/);
assert.match(worker,/function injectedKey\(tabId\)/);
assert.match(worker,/chrome\.storage\.session\.set\(\{ \[key\]: \{ documentId: docId \} \}\)/);
assert.match(worker,/documentId: details\.documentId \|\| null/);
assert.doesNotMatch(worker,/chrome\.tabs\.onUpdated\.addListener\(/);
assert.match(worker,/documentEpoch\(tabId\)/);
assert.equal((worker.match(/chrome\.scripting\.executeScript\(/g)||[]).length,2);
assert.equal((worker.match(/chrome\.tabs\.query\(/g)||[]).length,1);
assert.match(worker,/tabs\.slice\(0, 40\)/);
assert.match(worker,/files: \['conversation-color\.js', 'chat-color-title\.js'\]/);
assert.match(worker,/files: \['conversation-color\.js', 'chat-color-title\.js', 'content-script\.js'\]/);
assert.match(worker,/type: 'CHATGPT_CONVERSATION_REQUEST_FAILED'/);
assert.doesNotMatch(worker,/chrome\.action\.set(?:Icon|BadgeText|BadgeBackgroundColor)/);

console.log('PASS safety invariants: one title-only observer, no polling, PNG identity, bounded error checks, POST-driven status');
