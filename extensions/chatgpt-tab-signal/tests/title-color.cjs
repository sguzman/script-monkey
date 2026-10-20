'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../conversation-color.js');
const source = fs.readFileSync(path.join(__dirname, '../chat-color-title.js'), 'utf8');
const uuid = '12345678-1234-4234-8234-1234567890ab';

function page(href, initial = 'Conversation - ChatGPT') {
  let value = initial, writes = 0, observers = 0, disconnected = 0;
  const subscriptions = new Map();
  const titleNode = {};
  const mutationCallbacks = [];
  class MutationObserverMock {
    constructor(fn) { this.fn = fn; mutationCallbacks.push(fn); observers++; }
    observe(node, opts) {
      assert.equal(node, titleNode);
      assert.deepEqual(Object.keys(opts).sort(), ['characterData','childList','subtree']);
    }
    disconnect() { disconnected++; }
  }
  function add(which, name, fn) { subscriptions.set(which + '.' + name, fn); }
  const location = { href };
  const document = {
    readyState: 'complete',
    get title() { return value; },
    set title(next) { value = String(next); writes++; },
    head: { querySelector(selector) {
      assert.equal(selector, 'title');
      return titleNode;
    } },
    addEventListener(name, fn) { add('document', name, fn); }
  };
  const window = {
    addEventListener(name, fn) { add('window', name, fn); },
    navigation: {
      addEventListener(name, fn) { add('navigation', name, fn); }
    }
  };
  const globalThis = { ChatGPTConversationColor: api };
  const ctx = vm.createContext({ globalThis, location, document, window,
    MutationObserver: MutationObserverMock, Date });
  function execute() { vm.runInContext(source, ctx, { timeout: 1500 }); }
  execute();
  return {
    execute, location, document,
    get writes() { return writes; },
    get observers() { return observers; },
    get disconnected() { return disconnected; },
    fire(name) { subscriptions.get(name)?.(); },
    siteTitle(value) {
      document.title = value;
      for (const fn of mutationCallbacks) fn();
    }
  };
}

const normal = page('https://chatgpt.com/c/' + uuid);
assert.equal(normal.document.title, '🟨 Conversation - ChatGPT');
assert.equal(normal.observers, 1);
normal.execute();
assert.equal(normal.observers, 1, 'A reinjection must not install a second title observer');
normal.siteTitle('Renamed by React - ChatGPT');
assert.equal(normal.document.title, '🟨 Renamed by React - ChatGPT');
normal.fire('window.focus');
assert.equal(normal.document.title, '🟨 Renamed by React - ChatGPT');
normal.location.href = 'https://chatgpt.com/c/another-conversation';
normal.fire('navigation.currententrychange');
assert.equal(normal.document.title.startsWith(api.fromUrl(normal.location.href).emoji+' '),true);
normal.location.href = 'https://chatgpt.com/projects';
normal.fire('navigation.currententrychange');
assert.equal(normal.document.title, 'Renamed by React - ChatGPT',
  'Leaving chats clears the prefix, without coloring general pages');

const project = page('https://chatgpt.com/g/g-p-a8b4def0-demo/c/' + uuid);
assert.equal(project.document.title, '🟡 Conversation - ChatGPT');
project.siteTitle('An answer - ChatGPT');
assert.equal(project.document.title, '🟡 An answer - ChatGPT');

const untouched = page('https://chatgpt.com/projects');
assert.equal(untouched.document.title, 'Conversation - ChatGPT');
assert.equal(untouched.writes, 0);

const storms = page('https://chatgpt.com/c/' + uuid);
for (let i=0;i<70;i++) storms.siteTitle('Busy title ' + i);
assert.ok(storms.writes <= 70 + 24, 'Title rewrite budget is capped');
assert.ok(storms.disconnected >= 1,'Title observer disconnects on excess churn');
console.log('PASS isolated title markers: idle, SPA, project, site retitles, no duplicate install, bounded churn');
