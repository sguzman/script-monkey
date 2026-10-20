'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const api = require('../conversation-color.js');

const id = '6ad657d7-d4dc-83e8-9a07-3b5504bcfac7';
const chat = 'https://chatgpt.com/c/' + id;
const project = 'https://chatgpt.com/g/g-p-a8b4def0-demo/c/' + id;
const gpt = 'https://chatgpt.com/g/g-example-gpt/c/' + id;

const simple = api.fromUrl(chat);
assert.equal(api.version, 1);
assert.equal(simple.kind, 'chat');
assert.equal(simple.key, 'chat:' + id);
assert.equal(simple.hue, 90);
assert.equal(simple.hash, 4148030970);
assert.equal(simple.hex, '#8cdf3a');
assert.equal(simple.emoji, '🟨');

const inProject = api.fromUrl(project);
assert.equal(inProject.kind, 'project');
assert.equal(inProject.scopeId, 'g-p-a8b4def0-demo');
assert.equal(inProject.hash, 237053993);
assert.equal(inProject.hex, '#4ddf3a');
assert.equal(inProject.emoji, '🟡');
assert.notEqual(simple.key, inProject.key);

const inGpt = api.fromUrl(gpt);
assert.equal(inGpt.kind, 'gpt');
assert.equal(inGpt.hash, 2979187856);
assert.equal(inGpt.hex, '#d43adf');
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
console.log('PASS color v1 golden vectors: normal, project, custom GPT, 1000 deterministic chats, nonchat exclusion');
