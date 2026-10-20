'use strict';
// Dependency-free simulation of post-driven lazy injection in Chrome/Edge MV3.
function harness(src, opts = {}) {
  const ev = {}, messages = [], injections = [], notices = [], sounds = [];
  const session = new Map(), urls = new Map(), loaded = new Set();
  const cleared = [], switchedTabs = [];
  for (let i = 1; i <= 24; i++) urls.set(i, 'https://chatgpt.com/c/synthetic-' + i);
  const chrome = {
    runtime: {
      onMessage: {addListener(f) {ev.message = f;}},
      getURL(path) {return 'chrome-extension://test/' + path;},
      getContexts: async () => [{contextType: 'OFFSCREEN_DOCUMENT'}],
      sendMessage: async x => {
        sounds.push(x);
        return x.type === 'PLAY_COMPLETION_SOUND'
          ? {ok:true,rendered:true,contextState:'running'}
          : {ok:true};
      }
    },
    webRequest: {
      onBeforeRequest: {addListener(f) {ev.start = f;}},
      onCompleted: {addListener(f) {ev.complete = f;}},
      onErrorOccurred: {addListener(f) {ev.error = f;}}
    },
    storage: {
      session: {
        async get(key) {
          if (key === null) return Object.fromEntries(session);
          return {[key]: session.get(key)};
        },
        async set(values) {for (const [key, value] of Object.entries(values)) session.set(key, value);},
        async remove(keys) {for (const key of Array.isArray(keys) ? keys : [keys]) session.delete(key);}
      }
    },
    tabs: {
      onRemoved: {addListener(f) {ev.remove = f;}},
      onUpdated: {addListener(f) {ev.updated = f;}},
      get: async id => {
        if (!urls.has(id)) throw Error('tab absent');
        return {id, url: urls.get(id), windowId: 2};
      },
      update: async (id, options) => {switchedTabs.push({id, options});},
      sendMessage: async (id, message) => {
        if (!loaded.has(id) || opts.unreachable?.includes(id)) throw Error('tab unreachable');
        messages.push({id, message});
      }
    },
    scripting: {executeScript: async args => {
      injections.push(args);
      if (opts.injectFails?.includes(args.target.tabId)) throw Error('inject failed');
      loaded.add(args.target.tabId);
    }},
    notifications: {
      create: async (id, options) => {notices.push({id, options}); return id;},
      clear: async id => {cleared.push(id); return true;},
      onClicked: {addListener(f) {ev.clicked = f;}}
    },
    offscreen: {createDocument: async () => {}},
    windows: {update: async () => {}}
  };
  class URLShim {
    constructor(str) {
      const m = String(str).match(/^([a-z]+):\/\/([^/?#]+)(\/[^?#]*)?/i);
      this.protocol = m ? m[1] + ':' : '';
      this.hostname = m?.[2] || '';
      this.pathname = m?.[3] || '/';
    }
  }
  new Function('chrome', 'URL', 'console', src)(chrome, URLShim, {error() {}, warn() {}});
  return {
    ev, messages, injections, notices, sounds, session, urls, loaded, cleared, switchedTabs,
    net(type, tabId=1, requestId='r1', props={}) {
      ev[type]({tabId, requestId, method: 'POST', statusCode: 200,
        url: 'https://chatgpt.com/backend-api/f/conversation',
        documentId: 'doc-' + tabId, ...props});
    },
    pageCompletion(tabId, requestId) {
      const message = {type: 'CHATGPT_RESPONSE_COMPLETE', requestId,
        sessionTitle: 'Synthetic - ChatGPT', response: 'Response finished.'};
      ev.message(message, {url: urls.get(tabId), tab: {id: tabId}}, () => {});
    }
  };
}
async function runSimulation(src) {
  const results = [];
  const check = (pass, description) => results.push({pass:!!pass, description});
  async function tick() {for (let i=0;i<200;i++) await Promise.resolve();}
  const h = harness(src);
  check(h.injections.length === 0 && h.messages.length === 0,
    'Extension startup does not inject into any tabs');
  for (let i=1;i<=12;i++) h.net('start',i,'start-'+i);
  await tick();
  check(h.injections.length === 12,'Twelve conversations automatically activate twelve tabs');
  check(new Set(h.injections.map(x=>x.target.tabId)).size === 12,
    'Each originating tab injected once');
  check([...h.loaded].every(x=>x<=12),'Twelve idle tabs remain uninjected');
  check(h.messages.filter(x=>x.message.type === 'CHATGPT_GENERATION_STARTED').length === 12,
    'Start messages route separately to each tab');
  for (let i=1;i<=12;i++) h.net('complete',i,'start-'+i);
  await tick();
  check(h.messages.filter(x=>x.message.type === 'CHATGPT_CONVERSATION_REQUEST_COMPLETED').length === 12,
    'Completion is routed for all twelve tabs');
  check(h.injections.length===12, 'Completing does not inject twice');

  // A new ChatGPT conversation promotes / to /c/<id> using the History
  // API. This must not be mistaken for a document reload.
  h.net('start',3,'spa-new-chat'); await tick();
  const beforeSpaCompletion = h.messages.length;
  check(h.session.has('chatgptTabSignalInjected:3'),
    'Live tab has a recorded injection before SPA URL change');
  h.urls.set(3,'https://chatgpt.com/c/new-conversation');
  // A History API URL change does not replace the actual documentId.
  await tick();
  check(h.session.has('chatgptTabSignalInjected:3'),
    'SPA URL update preserves the running content script registration');
  h.net('complete',3,'spa-new-chat'); await tick();
  check(h.messages.length>beforeSpaCompletion &&
        h.messages.some(x=>x.id===3 && x.message.type==='CHATGPT_CONVERSATION_REQUEST_COMPLETED' &&
                           x.message.requestId==='spa-new-chat'),
    'In-flight stream completion survives a new conversation URL update');
  h.pageCompletion(3,'spa-new-chat');await tick();
  check(h.notices.length===1,
    'A new conversation notifies successfully after SPA URL transition');
  h.net('start',3,'again'); await tick();
  check(h.injections.length===12,'Subsequent requests reuse content script');
  h.net('start',22,'bad',{url:'https://evil.example/backend-api/f/conversation'});
  h.net('start',23,'get',{method:'GET'});
  h.net('start',24,'bad-path',{url:'https://chatgpt.com/backend-api/other'});
  h.urls.set(21,'https://evil.example/');
  h.net('start',21,'navigated');
  await tick();
  check(h.injections.length===12, 'Foreign URL, GET, wrong path, and cross-site tab cannot inject');
  h.pageCompletion(3,'unique');await tick();
  check(h.notices.length===2,'Subsequent valid completion can notify');
  check(h.sounds.some(x=>x.type==='PLAY_COMPLETION_SOUND'),'Offscreen audio playback was requested');
  check(h.notices.every(x=>x.options?.silent===false),
    'Native OS notification sound is not suppressed');
  h.pageCompletion(3,'unique');await tick();
  check(h.notices.length===2,'Duplicate completion is deduplicated');
  h.pageCompletion(15,'spoofed');await tick();
  check(h.notices.length===2,'Idle tab cannot forge a notification');
  await h.ev.clicked(h.notices[0].id);await tick();
  check(h.cleared.includes(h.notices[0].id),'Notification click clears alert');

  const p = harness(src,{injectFails:[1]});
  for(let i=0;i<40;i++)p.net('start',1,'fail-'+i);
  await tick();
  check(p.injections.length===1,'Renderer injection failure is not retried indefinitely');
  check(p.messages.length===0,'Failed injection never sends a page message');
  check(p.session.get('chatgptTabSignalInjected:1')?.documentId==='doc-1',
    'Failed attempt recorded for one physical document');
  const unreach=harness(src,{unreachable:[1]});
  unreach.net('start',1,'first');await tick();
  for(let i=0;i<40;i++)unreach.net('start',1,'repeat-'+i);
  await tick();
  check(unreach.injections.length===1,'Unreachable renderer does not create injection storms');
  const another = harness(src);
  another.net('complete',2,'completion-only');await tick();
  check(another.injections.length===0,'Completion without preceding start never injects');

  h.urls.set(3,'https://chatgpt.com/c/next');
  h.loaded.delete(3);
  h.net('start',3,'after-navigation',{documentId:'doc-3-reloaded'});await tick();
  check(h.injections.length===13,
    'New physical document ID permits exactly one new injection');
  check(h.session.get('chatgptTabSignalInjected:3')?.documentId==='doc-3-reloaded',
    'New document replaces the previous injection marker');
  h.net('start',3,'same-reloaded-document',{documentId:'doc-3-reloaded'});await tick();
  check(h.injections.length===13,
    'Repeated starts in same reloaded document do not cause reinjection');
  h.ev.remove(3); await tick();
  check(!h.session.has('chatgptTabSignalInjected:3'),'Tab close cleans session state');
  return results;
}
module.exports={runSimulation};
if(require.main===module){
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.resolve(__dirname,'../service-worker.js'),'utf8');
  runSimulation(source).then(results=>{
    for(const r of results) console.log((r.pass?'PASS ':'FAIL ')+r.description);
    if(results.some(r=>!r.pass))process.exitCode=1;
  }).catch(error=>{console.error(error);process.exitCode=1;});
}
