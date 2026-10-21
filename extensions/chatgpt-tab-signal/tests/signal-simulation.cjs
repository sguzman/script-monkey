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
    rel: 'icon', dataset: {}, isConnected: true,
    getAttribute(name) { return siteAttrs[name] ?? null; },
    setAttribute(name, value) { siteAttrs[name] = value; },
    hasAttribute(name) { return siteAttrs[name] !== undefined; },
    removeAttribute(name) { delete siteAttrs[name]; }
  };
  children.push(siteIcon);
  const state = { now: 100000, next: 1, stop: !!options.stop, focus: !!options.focus, roleReads: 0, perfReads: 0, turnQueries: 0 };
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
      if (key === 'data-turn') state.roleReads++;
      if (key === 'data-turn') return role;
      if (key === 'data-testid') return 'conversation-turn-' + index;
      return null;
    },
    matches(selector) { return role === 'assistant' && selector === '[data-message-author-role="assistant"]'; },
    querySelector() { return null; },
    closest() { return null; }
  }));
  for (let i = 0; i < (options.extraTurns || 0); i++) turns.unshift({
    parentElement: root, textContent: 'Old response',
    getAttribute(k) { if (k === 'data-turn') { state.roleReads++; return 'assistant'; }
      return k === 'data-testid' ? 'conversation-turn-old-' + i : null; },
    matches() { return false; }, querySelector() { return null; }, closest() { return null; }
  });
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
      if (selector === '[data-testid^="conversation-turn-"]') { state.turnQueries++; return turns; }
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
  function setIntervalMock(fn, ms) {
    const id = state.next++;
    intervals.set(id, { fn, ms, nextAt: state.now + ms });
    return id;
  }
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
  let activeBanner = options.banner || null;
  const statuses = [];
  const ui = {
    __chatgptTabSignalSetStatus: value => statuses.push(value),
    __chatgptTabSignalDetectError: () => activeBanner
  };
  context(
    ui, chrome, document, window, location,
    { now: () => state.now }, { now: () => {
      state.perfReads++;
      return state.now + (options.slowChecks ? state.perfReads * 60 : 0);
    } },
    MockElement, class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    },
    setTimeoutMock, clearTimeoutMock, setIntervalMock, clearIntervalMock,
    { error() {}, warn() {} }
  );
  return {
    emitted, document, location, children, intervals, siteIcon, statuses,
    setBanner(value) { activeBanner = value; },
    get pendingTimeouts() { return timeouts.size; },
    get turnQueries() { return state.turnQueries; },
    get roleReads() { return state.roleReads; },
    get observerCount() { return observers.length; },
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
      for (const [id, timer] of [...intervals]) {
        if (state.now >= timer.nextAt && intervals.has(id)) {
          timer.nextAt += timer.ms;
          timer.fn();
        }
      }
      for (const [id, timer] of [...timeouts]) {
        if (state.now >= timer.at) { timeouts.delete(id); timer.fn(); }
      }
    },
    advance(ticks) { for (let n = 0; n < ticks; n++) this.tick(); },
    clickStop() { this.fire('document', 'click', { target: new MockElement() }); }
  };
}
async function runSimulation(source) {
  const results = [];
  const check = (ok, label) => results.push({pass: !!ok, description: label});
  async function flush() {await Promise.resolve();await Promise.resolve();}
  {
    const t=harness(source);
    check(t.pendingTimeouts===0,'Idle status watcher has zero timers');
    check(t.observerCount===0&&t.intervals.size===0,'No status watcher DOM observers or polling');
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'r1'});
    check(t.statuses.at(-1)==='generating','POST starts generating title emoji');
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'r1'});
    check(t.pendingTimeouts===1,'Success schedules one cancellable settle delay');
    t.advance(4);await flush();
    check(t.emitted.length===0,'No premature completed notification');
    t.advance(2);await flush();
    check(t.emitted.length===1,'Successful POST sends notification and audio request');
    check(t.statuses.at(-1)==='unread','Background completion is unread');
    check(t.pendingTimeouts===0,'Successful completion releases timer');
    t.setFocus(true);t.fire('window','focus');
    check(t.statuses.at(-1)==='finished','Opening unread tab marks viewed');
    check(t.emitted[0]?.response==='Response finished.','Only fixed text leaves the page');
    check(t.turnQueries===0&&t.roleReads===0,'No transcript reads');
    check(t.document.title==='Example conversation - ChatGPT',
      'Status watcher delegates title; never writes it directly');
  }
  {
    const t=harness(source,{focus:true});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'bad'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_FAILED',requestId:'bad',statusCode:502});
    check(t.statuses.at(-1)==='error','Non-2xx response becomes error');
    check(t.pendingTimeouts===1,'Exactly one bounded delayed banner check');
    t.setBanner('limit');
    t.advance(4);await flush();
    check(t.statuses.at(-1)==='limit','Conversation cap overrides network error');
    check(t.emitted.length===0,'Error and limit never announce response completion');
    check(t.pendingTimeouts===0,'Failure check releases timer');
  }
  {
    const t=harness(source,{banner:'limit'});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'cap'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'cap'});
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='limit','2xx transport with limit UI is not success');
    check(t.emitted.length===0,'Rendered error suppresses misleading completion');
  }
  {
    const t=harness(source,{banner:'error'});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'red'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'red'});
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='error','Visible generic error has its own state');
    check(t.emitted.length===0,'Visible error is not treated as a completion');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'stopped'});
    t.clickStop();
    t.send({type:'CHATGPT_GENERATION_ABORTED',requestId:'stopped'});
    t.advance(10);await flush();
    check(t.statuses.at(-1)==='idle','Manual Stop is not a network failure');
    check(t.pendingTimeouts===0&&t.emitted.length===0,
      'Manual Stop has no delayed error or completion');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'old'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'old'});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'new'});
    check(t.pendingTimeouts===0,'New generation cancels stale completion');
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'new'});
    t.advance(6);await flush();
    check(t.emitted.length===1&&t.emitted[0]?.requestId==='new',
      'Only latest generation notifies');
  }
  {
    const t=harness(source,{extraTurns:12000,answer:'X'.repeat(400000)});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'huge'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'huge'});
    t.advance(6);await flush();
    check(t.emitted.length===1,'Huge conversation still notifies');
    check(t.turnQueries===0&&t.roleReads===0,
      'Huge conversation never searched or extracted');
  }
  {
    const t=harness(source);
    for(let i=0;i<61;i++){
      t.send({type:'CHATGPT_ENABLE_TAB'});
      t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'storm-'+i});
    }
    check(t.statuses.at(-1)==='idle','Event storm fails closed');
    check(t.pendingTimeouts===0,'Event storm leaves no timers');
    t.advance(121);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'recovered'});
    check(t.statuses.at(-1)==='generating','Event budget resets after a minute');
  }
  {
    const t=harness(source,{focus:true});
    t.location.pathname='/';
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'first'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'first'});
    t.location.pathname='/c/newly-assigned-synthetic-id';
    t.advance(6);await flush();
    check(t.emitted.length===1,'First chat URL promotion retains completion');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'disabled'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'disabled'});
    t.send({type:'CHATGPT_DISABLE_TAB'});
    check(t.pendingTimeouts===0,'Disable cancels completion and failure timers');
    t.advance(8);await flush();
    check(t.emitted.length===0,'Disabled tab does not send notification');
    t.send({type:'CHATGPT_ENABLE_TAB'});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'next'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'next'});
    t.advance(8);await flush();
    check(t.emitted.length===1,'Re-enabled tab resumes after POST');
  }
  return results;
}
module.exports = { runSimulation };
if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../content-script.js'), 'utf8');
  runSimulation(source).then(rows => {
    for(const r of rows) console.log((r.pass?'PASS ':'FAIL ')+r.description);
    if(rows.some(r=>!r.pass)) process.exitCode=1;
  }).catch(error => {console.error(error);process.exitCode=1;});
}
