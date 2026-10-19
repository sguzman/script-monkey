'use strict';

// Dependency-free simulation of Chromium's content-script environment.
// Run from this folder: node tests/signal-simulation.cjs
function harness(code, options = {}) {
  const docEvents = new Map();
  const winEvents = new Map();
  const emitted = [];
  const intervals = new Map();
  const timeouts = new Map();
  const children = [];
  const root = {};
  const observers = [];
  const siteAttrs = { href: '/assets/chatgpt.ico', type: 'image/x-icon' };
  const siteIcon = {
    rel: 'icon', dataset: {},
    getAttribute(name) { return siteAttrs[name] ?? null; },
    setAttribute(name, value) { siteAttrs[name] = value; }
  };
  children.push(siteIcon);
  const state = { now: 100000, next: 1, stop: !!options.stop, focus: !!options.focus };
  const observer = { observe() {}, disconnect() {} };
  const head = {
    appendChild(node) {
      const index = children.indexOf(node);
      if (index !== -1) children.splice(index, 1);
      children.push(node);
      node.isConnected = true;
      return node;
    },
    get lastElementChild() { return children[children.length - 1] || null; },
    querySelectorAll(selector) {
      if (selector === 'link[rel~="icon"]') return children.filter((child) => child.rel === 'icon');
      return [];
    }
  };
  class MockElement {
    closest() { return {}; }
    getClientRects() { return state.stop ? [{}] : []; }
  }
  function node() {
    const attrs = {};
    return {
      dataset: {}, isConnected: false,
      getAttribute(key) { return attrs[key]; },
      setAttribute(key, value) { attrs[key] = value; },
      hasAttribute(key) { return Object.hasOwn(attrs, key); },
      removeAttribute(key) { delete attrs[key]; },
      remove() {
        const index = children.indexOf(this);
        if (index !== -1) children.splice(index, 1);
        this.isConnected = false;
      }
    };
  }
  const turns = ['user', 'assistant'].map((role, index) => ({
    parentElement: root,
    textContent: role === 'assistant' ? (options.answer ?? 'Completed answer') : 'Question',
    getAttribute(key) {
      if (key === 'data-turn') return role;
      if (key === 'data-testid') return 'conversation-turn-' + index;
      return null;
    },
    matches(selector) { return role === 'assistant' && selector === '[data-message-author-role="assistant"]'; },
    querySelector() { return null; },
    closest() { return null; }
  }));
  function add(map, name, handler) {
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(handler);
  }
  const document = {
    title: 'Example conversation - ChatGPT', head,
    visibilityState: state.focus ? 'visible' : 'hidden',
    hasFocus: () => state.focus,
    createElement: node,
    addEventListener(name, handler) { add(docEvents, name, handler); },
    querySelectorAll(selector) {
      if (selector === '[data-testid^="conversation-turn-"]') return turns;
      if (selector.includes('stop-button')) return state.stop ? [new MockElement()] : [];
      return [];
    },
    querySelector() { return root; },
    body: root, documentElement: root
  };
  const window = { addEventListener(name, handler) { add(winEvents, name, handler); } };
  let receiver = null;
  const chrome = {
    runtime: {
      onMessage: { addListener(callback) { receiver = callback; } },
      sendMessage(message) { emitted.push(message); return Promise.resolve(); }
    }
  };
  const location = { pathname: '/c/simulation' };
  function setIntervalMock(fn) { const id = state.next++; intervals.set(id, fn); return id; }
  function clearIntervalMock(id) { intervals.delete(id); }
  function setTimeoutMock(fn, ms) {
    const id = state.next++;
    timeouts.set(id, { fn, at: state.now + ms });
    return id;
  }
  function clearTimeoutMock(id) { timeouts.delete(id); }
  const context = new Function(
    'globalThis', 'chrome', 'document', 'window', 'location', 'Date', 'performance',
    'Element', 'MutationObserver', 'setTimeout', 'clearTimeout', 'setInterval',
    'clearInterval', 'console', code
  );
  context(
    {}, chrome, document, window, location,
    { now: () => state.now }, { now: () => state.now },
    MockElement, class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    },
    setTimeoutMock, clearTimeoutMock, setIntervalMock, clearIntervalMock,
    { error() {}, warn() {} }
  );
  return {
    emitted, document, location, children, intervals, siteIcon,
    mutateSiteIcon(href) {
      siteIcon.setAttribute('href', href);
      for (const observer of observers) observer.callback();
    },
    send(message) {
      if (typeof receiver !== 'function') throw new Error('Content script message listener not registered');
      receiver(message);
    },
    setStop(value) { state.stop = value; },
    setAnswer(value) { turns[1].textContent = value; },
    setFocus(value) {
      state.focus = value;
      document.visibilityState = value ? 'visible' : 'hidden';
    },
    fire(which, name, event = {}) {
      for (const handler of (which === 'window' ? winEvents : docEvents).get(name) || []) handler(event);
    },
    tick() {
      state.now += 500;
      for (const callback of [...intervals.values()]) callback();
      for (const [id, timer] of [...timeouts]) {
        if (state.now >= timer.at) { timeouts.delete(id); timer.fn(); }
      }
    },
    advance(ticks) { for (let n = 0; n < ticks; n++) this.tick(); },
    clickStop() { this.fire('document', 'click', { target: new MockElement() }); }
  };
}
async function runSimulation(source) {
  const result = [];
  function check(condition, description) {
    result.push({ description, pass: !!condition });
  }
  async function settle() { await Promise.resolve(); await Promise.resolve(); }
  {
    const t = harness(source, { stop: true });
    t.send({ type: 'CHATGPT_GENERATION_STARTED', requestId: 'r1' });
    check(t.document.title === 'Example conversation - ChatGPT', 'Generation leaves tab title untouched');
    check(t.children.at(-1)?.getAttribute('href').includes('94a3b8'), 'Generating state uses gray favicon');
    t.send({ type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId: 'r1' });
    t.advance(10);
    check(t.emitted.length === 0, 'Still-thinking button prevents premature alert');
    t.setStop(false);
    t.advance(5);
    await settle();
    check(t.emitted.length === 1, 'One completion');
    check(t.emitted[0]?.requestId === 'r1', 'Completion carries request identity');
    check(t.document.title === 'Example conversation - ChatGPT', 'Unread state leaves tab title untouched');
    check(t.children.at(-1)?.getAttribute('href').includes('2563eb'), 'Unread state uses blue favicon');
    t.setFocus(true);
    t.fire('window', 'focus');
    check(t.document.title === 'Example conversation - ChatGPT', 'Return restores original title');
    check(t.children.at(-1)?.getAttribute('href') === '/assets/chatgpt.ico', 'Return actively restores site favicon');
    check(t.children.at(-1)?.getAttribute('type') === 'image/x-icon', 'Return restores favicon media type');
    t.mutateSiteIcon('/assets/chatgpt-updated.ico');
    check(t.children.at(-1)?.getAttribute('href') === '/assets/chatgpt-updated.ico', 'Site favicon updates propagate while viewed');
    check(t.intervals.size === 0, 'Completion cleans timers');
  }
  {
    const t = harness(source);
    t.send({ type: 'CHATGPT_GENERATION_STARTED', requestId: 'old' });
    t.send({ type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId: 'old' });
    t.tick();
    t.send({ type: 'CHATGPT_GENERATION_STARTED', requestId: 'new' });
    t.send({ type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId: 'old' });
    t.advance(6);
    await settle();
    check(t.emitted.length === 0, 'Stale response cannot emit');
    t.send({ type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId: 'new' });
    t.advance(5);
    await settle();
    check(t.emitted.length === 1 && t.emitted[0].requestId === 'new', 'Current response emits');
    check(t.intervals.size === 0, 'Canceled observer frees timers');
  }
  {
    const t = harness(source, { answer: '' });
    t.send({ type: 'CHATGPT_GENERATION_STARTED', requestId: 'empty' });
    t.send({ type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId: 'empty' });
    t.advance(70);
    await settle();
    check(t.emitted.length === 0, 'Empty answer never yields fake success');
    check(t.intervals.size === 0, 'Empty-answer watchdog cleans timers');
  }
  {
    const t = harness(source);
    t.send({ type: 'CHATGPT_PREVIEW_UNREAD' });
    check(t.document.title === 'Example conversation - ChatGPT', 'Popup preview leaves title unchanged');
    check(t.children.at(-1)?.getAttribute('href').includes('2563eb'), 'Popup preview shows blue icon');
    t.setFocus(true);
    t.fire('document', 'pointerdown');
    check(t.children.at(-1)?.getAttribute('href') === '/assets/chatgpt.ico', 'Popup preview restores original icon on interaction');
  }
  {
    const t = harness(source);
    t.send({ type: 'CHATGPT_GENERATION_STARTED', requestId: 'manual' });
    t.send({ type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId: 'manual' });
    t.tick();
    t.clickStop();
    t.advance(10);
    await settle();
    check(t.emitted.length === 0, 'Manual stop suppresses completion');
    check(t.document.title === 'Example conversation - ChatGPT', 'Manual stop resets indicator');
    check(t.intervals.size === 0, 'Manual stop cleans timers');
  }
  {
    const t = harness(source);
    t.send({ type: 'CHATGPT_GENERATION_STARTED', requestId: 'regen1' });
    t.send({ type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId: 'regen1' });
    t.advance(5);
    await settle();
    t.send({ type: 'CHATGPT_GENERATION_STARTED', requestId: 'regen2' });
    t.send({ type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId: 'regen2' });
    t.advance(5);
    await settle();
    check(t.emitted.length === 2, 'Two identical regenerated answers are separate completions');
  }
  {
    const t = harness(source);
    t.send({ type: 'CHATGPT_GENERATION_STARTED', requestId: 'nav' });
    t.send({ type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId: 'nav' });
    t.location.pathname = '/c/other';
    t.advance(5);
    await settle();
    check(t.emitted.length === 0, 'Navigation cancels response belonging to old conversation');
  }
  return result;
}
module.exports = { runSimulation };
if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../content-script.js'), 'utf8');
  runSimulation(source).then((results) => {
    for (const test of results) console.log((test.pass ? 'PASS' : 'FAIL') + ' ' + test.description);
    if (results.some((test) => !test.pass)) process.exitCode = 1;
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
