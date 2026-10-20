'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.service_worker, 'service-worker.js');
assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
assert.equal(Object.hasOwn(manifest, 'content_scripts'), false,
  'No automatic content scripts permitted in ANY ChatGPT tab');
assert.equal(Object.hasOwn(manifest, 'optional_host_permissions'), false);
assert.equal(Object.hasOwn(manifest.action, 'default_popup'), false, 'No popup or global toggle');
assert.ok(manifest.permissions.includes('storage'), 'Bounded injection tracking requires session storage');
assert.ok(manifest.permissions.includes('scripting'), 'Request-triggered dynamic injection');
const linked = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  'content-script.js'
];
for (const filename of linked) {
  assert.ok(fs.existsSync(path.join(base, filename)), 'Missing manifest asset: ' + filename);
}
console.log('PASS Manifest V3: no popup; no automatic content scripts');
