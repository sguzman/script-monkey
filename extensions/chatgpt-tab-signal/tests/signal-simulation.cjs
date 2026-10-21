'use strict';

// Dependency-free simulation of Chromium's content-script environment.
// Run from this folder: node tests/signal-simulation.cjs
function harness(code, options = {}) {
  const docEvents = new Map();
  const winEvents = new Map();
  const emitted = [], controls = [];
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
  const state = { now: 100000, next: 1, stop: !!options.stop,
    copyCount: 0, actionPending: false, focus: !!options.focus,
    roleReads: 0, perfReads: 0, turnQueries: 0 };
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
      if (selector === 'button[data-testid="copy-turn-action-button"]')
        return Array.from({length:state.copyCount},()=>new MockElement());
      if (selector === '[data-testid^="conversation-turn-"]') { state.turnQueries++; return turns; }
      if (selector.includes('stop-button')) return state.stop ? [new MockElement()] : [];
      return [];
    },
    querySelector(selector) {
      if (selector === 'main') return root;
      if (selector.includes('button[data-testid="stop-button"]'))
        return state.stop ? new MockElement() : null;
      return root;
    },
    body: root, documentElement: root
  };
  const window = { addEventListener(name, handler) { add(winEvents, name, handler); } };
  let receiver = null;
  const chrome = {
    runtime: {
      onMessage: { addListener(callback) { receiver = callback; } },
      sendMessage(message) {
        (message.type === 'CHATGPT_RESPONSE_COMPLETE' ? emitted : controls).push(message);
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
    emitted, controls, document, location, children, intervals, siteIcon, statuses,
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
      if (message.type === 'CHATGPT_GENERATION_STARTED')
        state.actionPending = statuses.at(-1) === 'generating';
      if (message.type === 'CHATGPT_CONVERSATION_REQUEST_COMPLETED' &&
          state.actionPending && !options.deferResponseActions) {
        state.actionPending = false;
        state.copyCount++;
        for(const observer of observers) observer.callback();
      }
      if (message.type === 'CHATGPT_CONVERSATION_REQUEST_FAILED')
        state.actionPending = false;
    },
    revealCompletedResponse() {
      state.copyCount++;
      for(const observer of observers) observer.callback();
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
    clickStop() { this.fire('document', 'click', { target: new MockElement() }); },
    promptEnter() { this.fire('document','keydown',{
      key:'Enter',shiftKey:false,isComposing:false,target:new MockElement()
    }); }
  };
}
async function runSimulation(source) {
  const results = [];
  const check = (ok, label) => results.push({pass: !!ok, description: label});
  async function flush() {await Promise.resolve();await Promise.resolve();}
  {
    const t=harness(source,{focus:true,deferResponseActions:true});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'partial-response'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'partial-response'});
    t.advance(32);await flush();
    check(t.statuses.at(-1)==='generating',
      'A response still working 16s after HTTP 200 remains thinking');
    check(t.emitted.length===0,
      'No notification or sound request until final response controls appear');
    check(t.pendingTimeouts===0,
      'Waiting for final UI uses no recurring timers');
    t.fire('window','focus');
    check(t.statuses.at(-1)==='generating',
      'Clicking a still-working chat cannot turn it into completed status');
    t.revealCompletedResponse();
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='finished'&&t.emitted.length===1,
      'Completed response controls trigger exactly one notification');
  }
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
    // Successful final answer is terminal: a stale failure/preview for the
    // same network request must not turn the title into a false warning.
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_FAILED',requestId:'r1',statusCode:503});
    t.send({type:'CHATGPT_PREVIEW_UNREAD',requestId:'r1'});
    check(t.statuses.at(-1)==='unread',
      'Late failure and unread hint cannot override successful response');
    check(t.emitted.length===1,'Late failure does not re-announce completion');
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
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'completed'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'completed'});
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='finished','Foreground response has terminal check state');
    for(let i=0;i<12;i++) {
      const id='incidental-'+i;
      t.send({type:'CHATGPT_GENERATION_STARTED',requestId:id});
      check(t.statuses.at(-1)==='finished',
        'Unsolicited POST '+i+' cannot demote completed chat to hourglass');
      t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:id});
      t.advance(6);await flush();
    }
    check(t.emitted.length===1,
      'Twelve incidental request completions produce no duplicate notification');
    check(t.controls.filter(c=>c.type==='CHATGPT_REQUEST_IGNORED').length===12,
      'All twelve unsolicited requests explicitly veto worker notifications');
    for(let i=0;i<12;i++)t.fire('window','focus');
    check(t.statuses.at(-1)==='finished','Focus cannot revive completed generation');
    t.promptEnter();
    t.send({type:'CHATGPT_GENERATION_STARTED',
      requestId:'late-incidental',startedAt:98000});
    check(t.statuses.at(-1)==='finished',
      'An older delayed START cannot steal the next user Send gesture');
    t.send({type:'CHATGPT_GENERATION_STARTED',
      requestId:'new-user-reply',startedAt:139000});
    check(t.statuses.at(-1)==='generating','Real new prompt still sets hourglass');
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'new-user-reply'});
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='finished'&&t.emitted.length===2,
      'New user prompt completes and notifies normally');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'good'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'good'});
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='unread','Background answer completed before secondary request');
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'auxiliary'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_FAILED',requestId:'auxiliary',statusCode:503});
    t.advance(5);await flush();
    check(t.statuses.at(-1)==='unread',
      'Failed secondary POST without UI error preserves successful answer');
    t.setFocus(true);t.fire('window','focus');
    check(t.statuses.at(-1)==='finished',
      'Preserved unread completion still becomes viewed on focus');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'good'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'good'});
    t.advance(6);await flush();
    t.promptEnter();
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'user-retry'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_FAILED',requestId:'user-retry',statusCode:503});
    check(t.statuses.at(-1)==='idle',
      'New prompt HTTP failure without visible error is not a chat error');
    t.setBanner('error');
    t.advance(4);await flush();
    check(t.statuses.at(-1)==='error',
      'Newly rendered failure banner confirms the error');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'good'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'good'});
    t.advance(6);await flush();
    t.promptEnter();
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'real-ui-error'});
    t.setBanner('error');
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_FAILED',requestId:'real-ui-error',statusCode:503});
    check(t.statuses.at(-1)==='error',
      'Visible genuine error overrides previous successful answer');
  }
  {
    const t=harness(source,{focus:true});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'bad'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_FAILED',requestId:'bad',statusCode:502});
    check(t.statuses.at(-1)==='idle',
      'Bare non-2xx response cannot prove conversation failure');
    check(t.pendingTimeouts===1,'Exactly one bounded delayed banner check');
    t.setBanner('limit');
    t.advance(4);await flush();
    check(t.statuses.at(-1)==='limit','Conversation cap overrides network error');
    check(t.emitted.length===0,'Error and limit never announce response completion');
    check(t.pendingTimeouts===0,'Failure check releases timer');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'lost'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_FAILED',requestId:'lost',statusCode:503});
    t.setBanner('interrupted');
    t.advance(4);await flush();
    check(t.statuses.at(-1)==='interrupted',
      'Connection interruption overrides generic network failure');
    check(t.emitted.length===0,'Interrupted request does not announce completion');
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'retry'});
    check(t.statuses.at(-1)==='generating',
      'A new response can start after an interruption');
    t.setBanner(null);
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'retry'});
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='unread'&&t.emitted.length===1,
      'Recovered answer triggers normal unread alert');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'http-ok-interrupted'});
    t.setBanner('interrupted');
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'http-ok-interrupted'});
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='interrupted'&&t.emitted.length===0,
      'Transport success with interruption UI is not completion');
    check(t.controls.some(m=>m.type==='CHATGPT_RESPONSE_REJECTED'),
      'Interruption vetoes worker fallback notification');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'cap'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'cap'});
    t.setBanner('limit');
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='limit','2xx transport with limit UI is not success');
    check(t.emitted.length===0,'Rendered error suppresses misleading completion');
    check(t.controls.some(m=>m.type==='CHATGPT_RESPONSE_REJECTED'),
      'Recognized error tells worker to suppress fallback');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'red'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'red'});
    t.setBanner('error');
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='error','Visible generic error has its own state');
    check(t.emitted.length===0,'Visible error is not treated as a completion');
  }
  {
    // A harmless red badge, a pre-existing banner, or an active foreground
    // tab must NEVER silence a successful response notification/chime.
    const t=harness(source,{focus:true,banner:'error'});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'foreground-success'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'foreground-success'});
    t.advance(6);await flush();
    check(t.statuses.at(-1)==='finished',
      'Foreground successful response is viewed, even with pre-existing UI');
    check(t.emitted.length===1 &&
      t.emitted[0]?.type==='CHATGPT_RESPONSE_COMPLETE',
      'Foreground success ALWAYS reaches notification and sound pipeline');
    check(!t.statuses.includes('error'),
      'Pre-existing red UI cannot cause a false error status');
  }
  {
    const t=harness(source,{banner:'error'});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'old-banner'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_FAILED',requestId:'old-banner',statusCode:503});
    t.advance(4);await flush();
    check(!t.statuses.includes('error'),
      'Pre-existing banner cannot make a later failed POST a chat warning');
  }
  {
    const t=harness(source,{banner:'limit'});
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'existing-limit'});
    t.send({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED',requestId:'existing-limit'});
    t.advance(6);await flush();
    check(t.emitted.length===1, 'Stale limit UI cannot suppress new successful response');
  }
  {
    const t=harness(source);
    t.send({type:'CHATGPT_GENERATION_STARTED',requestId:'canceled'});
    t.send({type:'CHATGPT_GENERATION_ABORTED',requestId:'canceled'});
    check(t.statuses.at(-1)==='idle',
      'Network abort without evidence is not classified as an error');
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
    check(t.controls.some(m=>m.type==='CHATGPT_REQUEST_CANCELED'),
      'Manual Stop tells worker to cancel fallback');
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
