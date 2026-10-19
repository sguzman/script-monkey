'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.service_worker, 'service-worker.js');
assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
assert.deepEqual(manifest.content_scripts[0].matches, ['https://chatgpt.com/*']);
const linked = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...manifest.content_scripts.flatMap((entry) => entry.js)
];
for (const filename of linked) {
  assert.ok(fs.existsSync(path.join(base, filename)), 'Missing manifest asset: ' + filename);
}
console.log('PASS Manifest V3 and bundled referenced files');
