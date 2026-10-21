'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const api = require('../conversation-color.js');

const id = '12345678-1234-4234-8234-1234567890ab';
const chat = 'https://chatgpt.com/c/' + id;
const project = 'https://chatgpt.com/g/g-p-a8b4def0-demo/c/' + id;
const gpt = 'https://chatgpt.com/g/g-example-gpt/c/' + id;

const simple = api.fromUrl(chat);
assert.equal(api.version, 1);
assert.equal(simple.kind, 'chat');
assert.equal(simple.key, 'chat:' + id);
assert.equal(simple.hue, 41);
assert.equal(simple.hash, 1292884601);
assert.equal(simple.hex, '#dfab3a');
assert.equal(simple.emoji, '🟧');

const inProject = api.fromUrl(project);
assert.equal(inProject.kind, 'project');
assert.equal(inProject.scopeId, 'g-p-a8b4def0-demo');
assert.equal(inProject.hash, 2261541910);
assert.equal(inProject.hex, '#df3ac3');
assert.equal(inProject.emoji, '🟣');
assert.notEqual(simple.key, inProject.key);

const inGpt = api.fromUrl(gpt);
assert.equal(inGpt.kind, 'gpt');
assert.equal(inGpt.hash, 3840443587);
assert.equal(inGpt.hex, '#df3acc');
assert.equal(inGpt.emoji, '🟪');

for (const suffix of ['', '/', '?model=auto', '#fragment']) {
  assert.equal(api.fromUrl(chat + suffix).hex, simple.hex);
}
for (const invalid of [
  'https://chatgpt.com/', 'https://chatgpt.com/projects',
  'https://chatgpt.com/g/g-p-demo/project',
  'https://chatgpt.com/share/' + id,
  'https://chatgpt.com/c/', 'https://chatgpt.com/c/../',
  'https://other.example/c/' + id, 'http://chatgpt.com/c/' + id,
  'https://chatgpt.com/c/' + id + '/messages'
]) assert.equal(api.fromUrl(invalid), null, 'Exclude nonchat: ' + invalid);
assert.equal(api.fromUrl(chat.replace('/c/', '/g/g-p-other-project/c/'))?.kind,'project');

// Hash is deterministic; colors are independent of title, tab ID,
// load order, storage and request state.
for (let i = 0; i < 1000; i++) {
  const url = 'https://chatgpt.com/c/fixture-' + i;
  const color = api.fromUrl(url);
  assert.equal(color.hex, api.fromUrl(url).hex);
  assert.match(color.hex, /^#[0-9a-f]{6}$/);
  assert.equal(Number.isInteger(color.hue) && color.hue >= 0 && color.hue < 360, true);
}
assert.equal(Object.isFrozen(simple), true);
// v2 is an explicitly separate, set-aware algorithm: v1 outputs stay fixed.
// Its candidate palette uses OKLab distance, not raw RGB/HSL step size.
assert.equal(api.perceptualVersion, 2);
assert.equal(api.assignFromUrl('https://other.example/c/synthetic-1', []), null);
const occupied = [];
for (let n = 0; n < 40; n++) {
  const url = 'https://chatgpt.com/c/synthetic-' + n;
  const candidate = api.assignFromUrl(url, occupied);
  const again = api.assignFromUrl(url, occupied);
  assert.equal(candidate.hex, again.hex, 'Same active colors => same assignment');
  assert.equal(candidate.paletteVersion, 2);
  assert.equal(/^#[0-9a-f]{6}$/.test(candidate.hex), true);
  assert.equal(occupied.includes(candidate.hex), false, 'No duplicate among 40 open chats');
  for (const previous of occupied) {
    assert.ok(api.oklabDistance(candidate.hex, previous) >= 0.06,
      'Distinct synthetic tab colors require perceptual separation');
  }
  occupied.push(candidate.hex);
}
assert.equal(new Set(occupied).size, 40);
assert.equal(api.fromUrl(chat).hex, '#dfab3a',
  'v1 reference colors remain backward compatible');
console.log('PASS color v1 golden vectors and v2 OKLab-separated 40-chat palette');

