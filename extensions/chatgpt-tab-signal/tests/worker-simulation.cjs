'use strict';
// No third-party dependencies: node tests/worker-simulation.cjs
function harness(source) {
  const ev = {};
  const routed = [], sounds = [], notifications = [], cleared = [], tabs = [], windows = [];
  const chrome = {
    webRequest: {
      onBeforeRequest: { addListener(f) { ev.start = f; } },
      onCompleted: { addListener(f) { ev.complete = f; } },
      onErrorOccurred: { addListener(f) { ev.error = f; } }
    },
    runtime: {
      onMessage: { addListener(f) { ev.message = f; } },
      getURL(path) { return 'chrome-extension://test/' + path; },
      getContexts() { return Promise.resolve([{ contextType: 'OFFSCREEN_DOCUMENT' }]); },
      sendMessage(message) { sounds.push(message); return Promise.resolve({ ok: true }); }
    },
    tabs: {
      sendMessage(tabId, message) { routed.push({ tabId, message }); return Promise.resolve(); },
      query() { return Promise.resolve([{ id: 4, url: 'https://chatgpt.com/c/example' }]); },
      get(tabId) { return Promise.resolve({ id: tabId, windowId: 9 }); },
      update(tabId, options) { tabs.push({ tabId, options }); return Promise.resolve(); },
      onRemoved: { addListener(f) { ev.remove = f; } }
    },
    windows: {
      update(id, options) { windows.push({ id, options }); return Promise.resolve(); }
    },
    scripting: { executeScript() { throw new Error('Unnecessary reinjection'); } },
    offscreen: { createDocument() { return Promise.resolve(); } },
    notifications: {
      create(id, options) { notifications.push({ id, options }); return Promise.resolve(id); },
      clear(id) { cleared.push(id); return Promise.resolve(true); },
      onClicked: { addListener(f) { ev.click = f; } }
    }
  };
  // Pass URL explicitly so the same test works in minimal JS interpreters.
  class URLShim {
    constructor(raw) {
      const withoutOrigin = String(raw).replace(/^[a-z]+:\/\/[^/]+/, '');
      this.pathname = withoutOrigin.split(/[?#]/)[0];
    }
  }
  new Function('chrome', 'URL', 'console', source)(
    chrome, URLShim, { warn() {}, error() {} }
  );
  return {
    ev, routed, sounds, notifications, cleared, tabs, windows,
    net(which, props = {}) {
      ev[which](Object.assign({
        tabId: 4, method: 'POST', frameId: 0,
        requestId: 'req-1', statusCode: 200,
        url: 'https://chatgpt.com/backend-api/f/conversation'
      }, props));
    },
    async message(msg) {
      return new Promise((resolve) => {
        const result = ev.message(msg, { tab: { id: 4 } }, resolve);
        if (result !== true) resolve(undefined);
      });
    }
  };
}
async function runSimulation(source) {
  const outcomes = [];
  const check = (pass, description) => outcomes.push({ pass: !!pass, description });
  async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
  const h = harness(source);
  h.net('start', { method: 'GET' });
  await flush();
  check(h.routed.length === 0, 'Ignores GET requests');
  h.net('start', { requestId: 'a' });
  await flush();
  check(h.routed.some(v => v.message.type === 'CHATGPT_GENERATION_STARTED' &&
    v.message.requestId === 'a' && v.tabId === 4), 'Routes generation start by request ID');
  h.net('complete', { requestId: 'a' });
  await flush();
  check(h.routed.some(v => v.message.type === 'CHATGPT_CONVERSATION_REQUEST_COMPLETED' &&
    v.message.requestId === 'a'), 'Routes completion by request ID');
  h.net('error', { requestId: 'broken' });
  h.net('complete', { requestId: 'failure', statusCode: 500 });
  await flush();
  check(h.routed.some(v => v.message.type === 'CHATGPT_GENERATION_ABORTED' &&
    v.message.requestId === 'broken'), 'Network abort routed');
  check(h.routed.some(v => v.message.type === 'CHATGPT_GENERATION_ABORTED' &&
    v.message.requestId === 'failure'), 'HTTP failure routed');

  const message = {
    type: 'CHATGPT_RESPONSE_COMPLETE', requestId: 'a',
    completionKey: 'same-turn', fingerprint: 'same-answer',
    sessionTitle: 'My Chat - ChatGPT', response: 'Answer finished'
  };
  await h.message(message);
  await flush();
  check(h.notifications.length === 1, 'One real notification generated');
  check(h.sounds.filter(v => v.type === 'PLAY_COMPLETION_SOUND').length === 1,
    'One chime dispatched');
  check(h.notifications[0]?.options?.iconUrl?.startsWith('data:image/png;base64,'),
    'Notification icon is bundled data URI');

  await h.message(message);
  await flush();
  check(h.notifications.length === 1, 'Same request cannot notify twice');
  await h.message({ ...message, requestId: 'b' });
  await flush();
  check(h.notifications.length === 2, 'Distinct regeneration can notify again');

  const id = h.notifications[1].id;
  await h.ev.click(id);
  check(h.tabs.some(v => v.tabId === 4 && v.options.active === true),
    'Notification click activates correct tab');
  check(h.windows.some(v => v.id === 9 && v.options.focused === true),
    'Notification click focuses correct window');
  check(h.cleared.includes(id), 'Notification click clears notification');

  const preview = await h.message({ type: 'TEST_UNREAD_TAB' });
  await flush();
  check(preview?.ok === true, 'Popup preview request succeeds');
  check(h.routed.some(v => v.message.type === 'CHATGPT_PREVIEW_UNREAD'),
    'Popup preview reaches current ChatGPT tab');

  return outcomes;
}
module.exports = { runSimulation };
if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  runSimulation(source).then((results) => {
    for (const row of results) console.log((row.pass ? 'PASS ' : 'FAIL ') + row.description);
    if (results.some(row => !row.pass)) process.exitCode = 1;
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
