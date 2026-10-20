'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.service_worker, 'service-worker.js');
assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
// Only a tiny title-color decorator auto-loads on conversation routes.
// The response watcher must remain lazy, never a manifest content script.
assert.equal(manifest.content_scripts.length, 1);
assert.deepEqual(manifest.content_scripts[0].matches, [
  'https://chatgpt.com/c/*', 'https://chatgpt.com/g/*/c/*'
]);
assert.deepEqual(manifest.content_scripts[0].js, [
  'conversation-color.js', 'chat-color-title.js'
]);
assert.equal(manifest.content_scripts[0].run_at, 'document_idle');
assert.equal(manifest.content_scripts[0].js.includes('content-script.js'), false,
  'Response-status script must never be injected into idle tabs');
assert.equal(Object.hasOwn(manifest, 'optional_host_permissions'), false);
assert.equal(Object.hasOwn(manifest, 'action'), false, 'No toolbar button, badge, popup, or global toggle');
assert.ok(manifest.permissions.includes('storage'), 'Bounded injection tracking requires session storage');
assert.ok(manifest.permissions.includes('scripting'), 'Request-triggered dynamic injection');
const linked = [
  manifest.background.service_worker,
  ...manifest.content_scripts[0].js,
  'content-script.js'
];
for (const filename of linked) {
  assert.ok(fs.existsSync(path.join(base, filename)), 'Missing manifest asset: ' + filename);
}
console.log('PASS Manifest V3: no popup; chat-only title decorator; response watcher remains POST-only');
