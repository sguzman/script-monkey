'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../' + file), 'utf8');
const source = read('content-script.js');
const worker = read('service-worker.js');
const ui = read('chat-color-title.js');
const color = read('conversation-color.js');

// Never observe the page while idle or scan assistant text. After a
// successful transport event, ONE request-scoped observer may watch main for
// the final response action and MUST disconnect on completion/cancellation.
assert.equal((source.match(/new MutationObserver\s*\(/g)||[]).length,1);
assert.match(source,/completionObserver\.observe\(container,\{childList:true,subtree:true\}\)/);
assert.match(source,/completionObserver\?\.disconnect\(\)/);
assert.doesNotMatch(source,/new\s+(?:ResizeObserver|IntersectionObserver)\s*\(/);
assert.doesNotMatch(source, /setInterval\s*\(/);
assert.doesNotMatch(ui, /setInterval\s*\(/);
assert.equal((ui.match(/setTimeout\s*\(/g)||[]).length,2,
  'One bounded hydration timeout site and one debounced title repair');
assert.match(ui, /titleRepairTimer/);
assert.match(ui, /chatgptTabSignalOwner/);
assert.match(ui, /key !== lastChatKey/);
assert.doesNotMatch(worker, /bootstrapOpenTabColors|pendingColorBootstrap/);
assert.match(source, /CHATGPT_REQUEST_IGNORED/);
assert.match(worker, /state:'ignored'/);
assert.match(ui, /previousOwner\?\.dispose\?\.\(\)/);
assert.equal((source.match(/\bsetTimeout\s*\(/g) || []).length, 2,
  'Only one completion delay and one failure-banner settle check allowed');
assert.equal((source.match(/\bclearTimeout\s*\(/g) || []).length, 2);
assert.match(source, /MAX_REQUEST_EVENTS_PER_MINUTE = 60/);
assert.match(source, /eventWindowBlocked/);
assert.match(source, /RENDER_SETTLE_DELAY_MS = 2500/);
assert.doesNotMatch(source,/document\.querySelectorAll\(ASSISTANT_TURNS\)|:has\(\[data/);
assert.match(source,/MAX_TAIL_NODES = 768/);
assert.match(source,/inspected < MAX_TAIL_NODES/);
assert.match(source,/previousElementSibling/);
assert.match(source,/baselineAssistant/);
assert.match(source,/FINISHED_ACTION/);
assert.match(source,/document\.querySelector\(STOP_ACTION\)/);
assert.match(source,/document\.querySelector\('main'\)/);
assert.doesNotMatch(source,/querySelector\(['"]\[data-message-author-role/);
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
assert.match(ui, /connection interrupted/);
assert.match(ui, /this response couldn.t load/);
assert.match(ui, /could not load this chatgpt conversation/);
assert.match(ui, /chatgpt-tab-signal-change/);
assert.match(ui, /element\.closest\?\.\(/,
  'Exclude conversation turns from error detection');
assert.match(ui, /message\.length > 320/,
  'UI error checks must have a strict text length bound');
assert.doesNotMatch(color, /fetch\s*\(|XMLHttpRequest|localStorage/,
  'Color identity is pure and reproducible');

// Keep the proven lazy-worker and notification mechanics unchanged.
assert.doesNotMatch(worker,/globallyEnabled|enableAll|disableAll|GLOBAL_ENABLED_KEY/);
assert.match(worker,/message\.type === 'CHATGPT_GENERATION_STARTED'/);
assert.match(worker,/function injectedKey\(tabId\)/);
assert.match(worker,/documentId: docId, build: INJECTION_BUILD/);
assert.match(worker,/chrome\.runtime\.onInstalled\.addListener/);
assert.match(worker,/content-script\.js'\]/);
assert.match(source,/previousOwner\?\.dispose\?\.\(\)/);
assert.match(worker,/documentId: details\.documentId \|\| null/);
assert.doesNotMatch(worker,/chrome\.tabs\.onUpdated\.addListener\(/);
assert.match(worker,/documentEpoch\(tabId\)/);
assert.equal((worker.match(/chrome\.scripting\.executeScript\(/g)||[]).length,1,
  'Only request-driven renderer activation may execute a script');
assert.match(worker,/CHATGPT_COMPLETION_PROBE/);
assert.match(worker,/verdict\?\.confirmed !== true/);
assert.doesNotMatch(worker,/chrome\.tabs\.query\(/,
  'Extension reload must not scan open tabs');
assert.doesNotMatch(worker,/\.slice\(0, 72\)|Promise\.all\(workers\)/);
assert.match(worker, /INJECTION_BUILD = '0\.1\.31'/);
assert.match(worker,/pendingRendererInjection/);
assert.match(worker,/mode: 'request-only'/);
assert.match(worker,/attempted: 0, verified: 0, failed: 0/);
assert.match(source, /CHATGPT_BUILD_PROBE/);
assert.match(worker, /chatgptTabSignalUpgradeSummary/);
assert.match(worker,/files: \['conversation-color\.js', 'chat-color-title\.js', 'content-script\.js'\]/);
assert.match(worker,/type: 'CHATGPT_CONVERSATION_REQUEST_FAILED'/);
assert.doesNotMatch(worker,/chrome\.action\.set(?:Icon|BadgeText|BadgeBackgroundColor)/);

console.log('PASS safety invariants: no idle response observer, positive response completion controls, safe fallback, bounded error checks');
