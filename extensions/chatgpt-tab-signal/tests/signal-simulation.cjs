'use strict';

// Dependency-free simulation of Chromium's content-script environment.
// Run from this folder: node tests/signal-simulation.cjs
function harness(code, options = {}) {
  const docEvents = new Map();
  const winEvents = new Map();
  const emitted = [];
  const states = [];
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
      sendMessage(message) {
        if (message?.type === 'CHATGPT_TAB_STATE') states.push(message.state);
        else emitted.push(message);
        return Promise.resolve();
      }
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
  context(
    {}, chrome, document, window, location,
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
    emitted, states, document, location, children, intervals, siteIcon,
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
  async function flush() { await Promise.resolve(); await Promise.resolve(); }
  const colorStates = {
    '94a3b8': 'generating', '2563eb': 'unread', '16a34a': 'finished'
  };
  const pngIcons = Object.fromEntries(
    [...source.matchAll(/(generating|unread|finished): 'data:image.png;base64,([A-Za-z0-9+/=]+)'/g)]
      .map(match => [match[1], 'data:image/png;base64,' + match[2]])
  );
  check(Object.keys(pngIcons).length===3, 'Three real PNG favicons are defined');
  function hasColor(t, color) {
    const expected = pngIcons[colorStates[color]];
    return !!expected && t.children.at(-1)?.getAttribute('href') === expected;
  }
  {
    const t = harness(source);
    check(t.pendingTimeouts === 0, 'Idle tab has zero timers');
    check(t.observerCount === 0 && t.intervals.size === 0, 'No observers or intervals at idle');
    t.send({type:'CHATGPT_GENERATION_STARTED', requestId:'r1'});
    check(hasColor(t, '94a3b8'), 'Network start paints gray generating icon');
    check(t.states.at(-1)==='generating',
      'Request start informs native Chrome tab action without polling');
    check(t.pendingTimeouts === 0, 'Generation itself starts no polling timers');
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId:'r1'});
    check(t.pendingTimeouts === 1, 'Successful POST schedules exactly one settle timeout');
    t.advance(4); await flush();
    check(t.emitted.length === 0, 'No completion before network settle delay');
    t.advance(2); await flush();
    check(t.emitted.length === 1, 'Completion fires once after settle delay');
    check(t.emitted[0]?.requestId === 'r1', 'Completion carries network request ID');
    check(t.emitted[0]?.response === 'Response finished.', 'Completion never reads response contents');
    check(hasColor(t, '2563eb'), 'Background completion is blue unread');
    check(t.pendingTimeouts === 0, 'Completion releases timeout');
    check(t.turnQueries === 0 && t.roleReads === 0, 'No conversation transcript queries');
    check(t.observerCount === 0 && t.intervals.size === 0, 'No observers or intervals after completion');
    t.setFocus(true); t.fire('window','focus');
    check(hasColor(t, '16a34a'), 'Opening unread tab marks it viewed green');
    check(t.states.at(-1)==='finished',
      'Completion updates native browser action state');
    check(t.emitted.length === 1, 'Returning to tab never duplicates notification');
    check(t.document.title === 'Example conversation - ChatGPT', 'Never prefixes title');
    t.mutateSiteIcon('/assets/updated.ico');
    check(hasColor(t, '16a34a'), 'Unrelated favicon updates never trigger watcher callbacks');
    t.send({type:'CHATGPT_GENERATION_STARTED', requestId:'r2'});
    check(hasColor(t,'94a3b8'), 'New request paints gray');
    t.send({type:'CHATGPT_GENERATION_ABORTED', requestId:'r2'});
    check(t.children.at(-1)?.getAttribute('href') === '/assets/updated.ico', 'Abort restores current site favicon');
    check(t.pendingTimeouts === 0, 'Abort leaves zero timers');
  }
  {
    const t=harness(source,{focus:true});
    t.send({type:'CHATGPT_GENERATION_STARTED', requestId:'foreground'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId:'foreground'});
    t.advance(6); await flush();
    check(t.emitted.length === 1, 'Foreground network completion notifies once');
    check(hasColor(t,'16a34a'), 'Foreground completion becomes green');
    check(t.emitted[0]?.sessionTitle === 'Example conversation - ChatGPT', 'Notification uses conversation title');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_PREVIEW_UNREAD'});
    check(hasColor(t,'2563eb'), 'Popup preview blue state');
    t.setFocus(true); t.fire('document','pointerdown');
    check(hasColor(t,'16a34a'), 'Popup preview green after interaction');
    check(t.pendingTimeouts === 0, 'Preview creates no timeout');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'abort'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'abort'});
    t.send({type:'CHATGPT_GENERATION_ABORTED',requestId:'abort'});
    t.advance(10); await flush();
    check(t.emitted.length===0,'Error cancels scheduled completion');
    check(t.pendingTimeouts===0,'Error clears timer');
    check(t.children.at(-1)?.getAttribute('href') === '/assets/chatgpt.ico','Error restores original favicon');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'stopped'});
    t.clickStop();
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'stopped'});
    t.advance(10); await flush();
    check(t.emitted.length===0,'Manual stop suppresses late successful network completion');
    check(t.pendingTimeouts===0,'Manual stop leaves no timeout');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'stale'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'stale'});
    check(t.pendingTimeouts===1,'First network completion schedules timeout');
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'new'});
    check(t.pendingTimeouts===0,'New generation cancels previous request timer');
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'stale'});
    check(t.pendingTimeouts===0,'Stale completion cannot arm timer');
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'new'});
    t.advance(6); await flush();
    check(t.emitted.length===1 && t.emitted[0]?.requestId==='new','Only latest network request notifies');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'duplicate'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'duplicate'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'duplicate'});
    check(t.pendingTimeouts===1,'Duplicate completion does not create a second timer');
    t.advance(6); await flush();
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'duplicate'});
    t.advance(6); await flush();
    check(t.emitted.length===1,'Duplicate events never send duplicate completion');
  }
  {
    const t=harness(source);
    for(const id of ['regen1','regen2']) {
      t.send({type:'CHATGPT_GENERATION_STARTED',requestId:id});
      t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:id});
      t.advance(6); await flush();
    }
    check(t.emitted.length===2,'Identical responses from separate regenerations notify separately');
    check(t.pendingTimeouts===0,'Regenerations release timers');
  }
  {
    const t=harness(source,{focus:true});
    t.location.pathname='/';
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'first-new-chat'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'first-new-chat'});
    t.location.pathname='/c/assigned-conversation-id';
    t.advance(6); await flush();
    check(t.emitted.length===1,
      'New conversation route promotion must not suppress first completion');
    check(t.pendingTimeouts===0,'SPA new-chat completion releases its timer');
    check(hasColor(t,'16a34a'),
      'Focused new conversation reaches green completed state after URL promotion');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'nav'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'nav'});
    t.location.pathname='/c/other';
    t.advance(6); await flush();
    check(t.emitted.length===0,'Navigation during settle prevents stale notification');
    check(t.pendingTimeouts===0,'Navigation settle timer cleans itself');
  }
  {
    const t=harness(source,{extraTurns:12000,answer:'X'.repeat(400000)});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'huge'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'huge'});
    t.advance(6); await flush();
    check(t.emitted.length===1,'Huge conversation still sends completion');
    check(t.turnQueries===0 && t.roleReads===0,'Huge conversation never scanned or extracted');
    check(t.emitted[0]?.response.length<40,'Huge conversation creates only fixed-size IPC');
  }
  {
    const t=harness(source);
    for(let i=0;i<60;i++) {
      // Real worker sends a reusable enable message before each POST.
      // This must NEVER erase the event budget of an already-enabled tab.
      t.send({type:'CHATGPT_ENABLE_TAB'});
      t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'storm-'+i});
    }
    check(hasColor(t,'94a3b8'),'At the event budget, normal generating state still works');
    t.send({type:'CHATGPT_ENABLE_TAB'});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'overflow'});
    check(t.children.at(-1)?.getAttribute('href')==='/assets/chatgpt.ico',
      'Event storm fails closed to original favicon');
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'overflow'});
    t.advance(6); await flush();
    check(t.emitted.length===0,'Overflow does not generate a notification');
    check(t.pendingTimeouts===0,'Overflow creates no timers');
    t.advance(121);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'recovered'});
    check(hasColor(t,'94a3b8'),'Event budget resets after one minute');
  }
  {
    const t=harness(source);
    t.document.title='◌ Example conversation - ChatGPT';
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'title'});
    check(t.document.title==='◌ Example conversation - ChatGPT','Never changes even a legacy-prefixed conversation title');
    t.send({type:'CHATGPT_GENERATION_ABORTED',requestId:'title'});
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'late'});
    t.advance(6); await flush();
    check(t.emitted.length===1,'Network completion works when start event missed');
    check(t.pendingTimeouts===0,'Missed-start case releases timeout');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'opted'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'opted'});
    check(t.pendingTimeouts===1,'Enabled page has exactly one pending completion');
    t.send({type:'CHATGPT_DISABLE_TAB'});
    check(t.pendingTimeouts===0,'Disabling cancels the pending notification timer');
    check(t.children.length===1,'Disabling removes the added favicon link');
    t.advance(8); await flush();
    check(t.emitted.length===0,'Disabling prevents a queued completion notification');
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'ignored'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'ignored'});
    t.advance(8); await flush();
    check(t.emitted.length===0&&t.pendingTimeouts===0,
      'Disabled page ignores further lifecycle events entirely');
    check(t.children.length===1,'Disabled page leaves original favicon alone');
    t.send({type:'CHATGPT_ENABLE_TAB'});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'reselected'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'reselected'});
    t.advance(8); await flush();
    check(t.emitted.length===1,'Explicitly re-enabled page can notify again');
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
