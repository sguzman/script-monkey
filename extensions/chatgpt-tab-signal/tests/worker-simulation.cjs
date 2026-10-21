'use strict';
// Dependency-free simulation of post-driven lazy injection in Chrome/Edge MV3.
function harness(src, opts = {}) {
  const ev = {}, messages = [], injections = [], notices = [], sounds = [];
  const session = new Map(), urls = new Map(), loaded = new Set();
  const loadedBuilds = new Map(Object.entries(opts.existingBuilds || {})
    .map(([id,build])=>[Number(id),build]));
  for (const id of loadedBuilds.keys()) loaded.add(id);
  const cleared = [], switchedTabs = [], timers = [];
  for (let i = 1; i <= 24; i++) urls.set(i, 'https://chatgpt.com/c/synthetic-' + i);
  const chrome = {
    runtime: {
      onMessage: {addListener(f) {ev.message = f;}},
      onInstalled: {addListener(f) {ev.install = f;}},
      getURL(path) {return 'chrome-extension://test/' + path;},
      getContexts: async () => [{contextType: 'OFFSCREEN_DOCUMENT'}],
      sendMessage: async x => {
        sounds.push(x);
        return x.type === 'PLAY_COMPLETION_SOUND'
          ? {ok:true,rendered:true,contextState:'running'}
          : x.type === 'CHATGPT_RENDER_IDENTITY_ICON'
          ? {iconUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='}
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
      query: async () => [...urls.entries()].map(([id,url]) =>
        ({id,url,active:id===opts.activeTab}))
        .filter(tab => tab.url.startsWith('https://chatgpt.com/') && tab.url.includes('/c/')),
      onUpdated: {addListener(f) {ev.updated = f;}},
      get: async id => {
        if (!urls.has(id)) throw Error('tab absent');
        return {id, url: urls.get(id), windowId: 2};
      },
      update: async (id, options) => {switchedTabs.push({id, options});},
      sendMessage: async (id, message) => {
        if (!loaded.has(id) || opts.unreachable?.includes(id)) throw Error('tab unreachable');
        messages.push({id, message});
        if (message?.type === 'CHATGPT_COMPLETION_PROBE')
          return {confirmed:opts.completionReady !== false};
        if (message?.type === 'CHATGPT_GENERATION_STARTED' ||
            message?.type === 'CHATGPT_BUILD_PROBE')
          return {build:loadedBuilds.get(id)};
      }
    },
    scripting: {executeScript: async args => {
      if (typeof args.func === 'function') {
        if (opts.blockColorProbe && !opts.colorProbeBlocked) {
          opts.colorProbeBlocked=true;
          await new Promise(resolve=>{opts.releaseColorProbe=resolve;});
        }
        // Only the one-time migration probes page DOM; the worker delegates
        // response completion to the active content-script owner.
        return [{result:opts.existingColors?.[args.target.tabId]||null,
          documentId:'doc-'+args.target.tabId}];
      }
      injections.push(args);
      if (opts.injectFails?.includes(args.target.tabId)) throw Error('inject failed');
      loaded.add(args.target.tabId);
      loadedBuilds.set(args.target.tabId,'0.1.29');
      return [{documentId:'doc-'+args.target.tabId}];
    }},
    notifications: {
      create: async (id, options) => {notices.push({id, options}); return id;},
      clear: async id => {cleared.push(id); return true;},
      onClicked: {addListener(f) {ev.clicked = f;}}
    },
    offscreen: {createDocument: async () => {}},
    windows: {update: async () => {}, get: async () => ({focused:false})}
  };
  class URLShim {
    constructor(str) {
      const m = String(str).match(/^([a-z]+):\/\/([^/?#]+)(\/[^?#]*)?/i);
      this.protocol = m ? m[1] + ':' : '';
      this.hostname = m?.[2] || '';
      this.pathname = m?.[3] || '/';
    }
  }
  // Browser loads this public helper with importScripts; simulations supply
  // the exact same Node module, using synthetic chat identifiers only.
  globalThis.ChatGPTConversationColor = require('../conversation-color.js');
  new Function('chrome','URL','console','setTimeout','clearTimeout',src)(
    chrome,URLShim,{error(){},warn(){}},
    (f,ms)=>{const t={f,ms,active:true};timers.push(t);return t;},
    t=>{if(t)t.active=false;});
  return {
    ev, messages, injections, notices, sounds, session, urls, loaded,
    loadedBuilds, cleared, switchedTabs,
    async flushFallbacks() {
      for (const t of timers.splice(0)) if(t.active) {t.active=false;await t.f();}
      for(let i=0;i<200;i++) await Promise.resolve();
    },
    pageControl(tabId,type,requestId) {
      ev.message({type,requestId},{url:urls.get(tabId),tab:{id:tabId}},()=>{});
    },
    net(type, tabId=1, requestId='r1', props={}) {
      ev[type]({tabId, requestId, method: 'POST', statusCode: 200,
        url: 'https://chatgpt.com/backend-api/f/conversation',
        documentId: 'doc-' + tabId, ...props});
    },
    pageCompletion(tabId, requestId, notificationIcon=null) {
      const message = {type: 'CHATGPT_RESPONSE_COMPLETE', requestId,
        sessionTitle: 'Synthetic - ChatGPT', response: 'Response finished.',
        notificationIcon};
      ev.message(message, {url: urls.get(tabId), tab: {id: tabId}}, () => {});
    },
    color(tabId) {
      return new Promise(resolve => {
        ev.message({type:'CHATGPT_TAB_COLOR_REQUEST'},
          {url:urls.get(tabId),tab:{id:tabId}},resolve);
      });
    }
  };
}
async function runSimulation(src) {
  const results = [];
  const check = (pass, description) => results.push({pass:!!pass, description});
  async function tick() {for (let i=0;i<1600;i++) await Promise.resolve();}
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
  const coloredIcon='data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  h.pageCompletion(3,'unique',coloredIcon);await tick();
  check(h.notices.at(-1)?.options.iconUrl===coloredIcon,
    'Desktop notification icon matches the requesting tab identity PNG');
  check(h.notices.length===2,'Subsequent valid completion can notify');
  check(h.sounds.some(x=>x.type==='PLAY_COMPLETION_SOUND'),'Offscreen audio playback was requested');
  check(h.notices.every(x=>x.options?.silent===false),
    'Native OS notification sound is not suppressed');
  h.pageCompletion(3,'unique');await tick();
  check(h.notices.length===2,'Duplicate completion is deduplicated');
  const lateFailCount=h.messages.filter(m=>
    m.id===3 && m.message.type==='CHATGPT_CONVERSATION_REQUEST_FAILED').length;
  h.net('error',3,'unique',{error:'net::ERR_NETWORK_CHANGED'});await tick();
  h.net('complete',3,'unique',{statusCode:503});await tick();
  check(h.messages.filter(m=>
    m.id===3 && m.message.type==='CHATGPT_CONVERSATION_REQUEST_FAILED').length===lateFailCount,
    'Late request transport failures are ignored after confirmed success');
  h.pageCompletion(15,'spoofed');await tick();
  check(h.notices.length===2,'Idle tab cannot forge a notification');
  await h.ev.clicked(h.notices[0].id);await tick();
  check(h.cleared.includes(h.notices[0].id),'Notification click clears alert');

  // Serialized, on-demand allocation never enumerates or injects into
  // additional tabs. Active colors are distinct and reclaimed on close.
  const colors = harness(src);
  const assigned = await Promise.all(
    Array.from({length:24},(_,i)=>colors.color(i+1))
  );
  check(assigned.every(c=>/^#[0-9a-f]{6}$/.test(c?.hex||'')),
    'All 24 synthetic tabs receive a deterministic color allocation');
  check(new Set(assigned.map(c=>c.hex)).size===24,
    'Each of 24 simultaneously open chats receives a different color');
  const duplicate = await colors.color(2);
  check(duplicate?.hex===assigned[1]?.hex,
    'Repeated registration does not recolor an existing chat');
  check(colors.injections.length===0 &&
        colors.messages.length===0 &&
        colors.notices.length===0,
    'Color allocation does not activate response watcher or other tabs');
  colors.ev.remove(1); await tick();
  colors.urls.set(25,'https://chatgpt.com/c/synthetic-25');
  const replacement=await colors.color(25);
  check(replacement?.hex && !assigned.slice(1).some(c=>c.hex===replacement.hex),
    'New chat after tab close does not collide with surviving tabs');
  const sameChat=colors.urls.set(26,'https://chatgpt.com/c/synthetic-2');
  const duplicated=await colors.color(26);
  check(duplicated?.hex===assigned[1]?.hex,
    'Same conversation in two browser tabs preserves one identity color');

  const installation = harness(src);
  check(installation.injections.length===0,
    'Idle tabs are untouched until the one-time install/upgrade event');
  installation.ev.install();
  await tick();
  check(installation.injections.length===24,
    'One-time install upgrades existing ChatGPT tabs in place');
  check(installation.injections.every(x =>
    x.files.join(',')==='conversation-color.js,chat-color-title.js,content-script.js'),
    'Upgrade also replaces the response watcher without reloading the page');
  check(installation.messages.every(x=>x.message.type==='CHATGPT_BUILD_PROBE') &&
        installation.notices.length===0,
    'Upgrade sends only build handshakes, never fabricated completions');
  check(installation.session.get('chatgptTabSignalInjected:1')?.build==='0.1.29',
    'New-build marker recorded after verified in-place upgrade');
  const summary=installation.session.get('chatgptTabSignalUpgradeSummary');
  check(summary?.attempted===24 && summary?.verified===24 && summary.failed===0,
    'Twenty-four old tabs acknowledge new code without manual page reload');
  check(installation.messages.filter(x=>
    x.message.type==='CHATGPT_BUILD_PROBE').length===24,
    'Every installed watcher must pass an explicit build handshake');
  const priority=harness(src,{activeTab:19});
  priority.ev.install();await tick();
  check(priority.injections[0]?.target.tabId===19,
    'The active tab is hot-upgraded ahead of inactive conversations');
  const delayedColor={blockColorProbe:true};
  const hot=harness(src,delayedColor);
  hot.ev.install();await tick();
  check(hot.injections.length>0,
    'Active tab upgrade begins while color restoration is still blocked');
  check(!hot.session.has('chatgptTabSignalUpgradeSummary'),
    'Upgrade summary waits for the pending color restoration');
  delayedColor.releaseColorProbe();await tick();
  check(hot.session.get('chatgptTabSignalUpgradeSummary')?.verified===24,
    'All tabs finish upgrading after concurrent color restoration');
  const failedUpgrade=harness(src,{injectFails:[1]});
  failedUpgrade.ev.install();await tick();
  check(failedUpgrade.session.get('chatgptTabSignalUpgradeSummary')?.failed===1 &&
        failedUpgrade.session.get('chatgptTabSignalUpgradeSummary')?.verified===23,
    'Injection failure is counted rather than silently marked upgraded');

  const stale=harness(src,{existingBuilds:{1:'0.1.28'}});
  stale.net('start',1,'stale-loaded');await tick();
  check(stale.injections.length===1 &&
        stale.loadedBuilds.get(1)==='0.1.29',
    'Stale content listener cannot masquerade as a current-version watcher');

  const oldMarker=harness(src);
  oldMarker.session.set('chatgptTabSignalInjected:1',
    {documentId:'doc-1',build:'0.1.24'});
  oldMarker.net('start',1,'after-upgrade');
  await tick();
  check(oldMarker.injections.length===1,
    'Old-build injection markers never block current-build activation');
  check(oldMarker.session.get('chatgptTabSignalInjected:1')?.build==='0.1.29',
    'Old-build injection marker upgraded once');

  const preservedColors=harness(src,{
    existingColors:{
      1:{hex:'#aabbcc',ready:'v2'},
      2:{hex:'#aabbcc',ready:'v2'},
      3:{hex:'#bbccdd',ready:'v2'}
    }
  });
  preservedColors.ev.install();await tick();
  const allocationByTab=preservedColors.session.get(
    'chatgptTabSignalActiveColorsV2')||{};
  check(Object.keys(allocationByTab).length===24,
    'Update reconstructs reservations for 24 open chats');
  check(allocationByTab['1']?.hex==='#aabbcc',
    'Confirmed swatch survives an extension reload');
  check(allocationByTab['2']?.hex!=='#aabbcc',
    'Existing duplicate swatches are corrected on reload');
  check(new Set(Object.values(allocationByTab).map(c=>c.hex)).size===24,
    'No duplicate swatches among 24 open conversations');

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

  const unfinished=harness(src,{completionReady:false});
  unfinished.net('start',1,'still-thinking');await tick();
  unfinished.net('complete',1,'still-thinking');await tick();
  await unfinished.flushFallbacks();await tick();
  check(unfinished.notices.length===0 &&
        !unfinished.messages.some(m=>m.message.type==='CHATGPT_PREVIEW_UNREAD'),
    'Worker MUST NOT claim response complete from HTTP success alone');
  check(unfinished.sounds.length===0,
    'Unfinished response never triggers completion sound');

  const sleeping=harness(src);
  sleeping.net('start',1,'bg-response');await tick();
  sleeping.net('complete',1,'bg-response');await tick();
  check(!sleeping.messages.some(m=>m.message.type==='CHATGPT_PREVIEW_UNREAD'),
    'No premature unread status before normal render-settle interval');
  check(sleeping.notices.length===0,'Page gets the first opportunity to alert');
  await sleeping.flushFallbacks();await tick();
  check(sleeping.messages.some(m=>m.message.type==='CHATGPT_PREVIEW_UNREAD'),
    'Worker requests unread bell when the renderer missed its deadline');
  check(sleeping.notices.length===1 &&
        sleeping.sounds.some(s=>s.type==='PLAY_COMPLETION_SOUND'),
    'Background worker alerts despite a suspended renderer');
  check(sleeping.notices[0]?.options.iconUrl.startsWith('data:image/png;base64,'),
    'Background alert includes a conversation identity PNG');
  sleeping.pageCompletion(1,'bg-response');await tick();
  check(sleeping.notices.length===1,'Late page callback cannot duplicate alert');

  const ignored=harness(src);
  ignored.net('start',1,'normal');await tick();
  ignored.net('complete',1,'normal');await tick();
  ignored.pageCompletion(1,'normal');await tick();
  const beforeNotices=ignored.notices.length;
  const beforeSounds=ignored.sounds.filter(s=>s.type==='PLAY_COMPLETION_SOUND').length;
  ignored.net('start',1,'incidental');await tick();
  ignored.pageControl(1,'CHATGPT_REQUEST_IGNORED','incidental');await tick();
  ignored.net('complete',1,'incidental');await tick();
  await ignored.flushFallbacks();await tick();
  check(ignored.notices.length===beforeNotices,
    'Ignored incidental request cannot generate a duplicate desktop alert');
  check(ignored.sounds.filter(s=>s.type==='PLAY_COMPLETION_SOUND').length===beforeSounds,
    'Ignored incidental request cannot duplicate completion chime');
  check(ignored.session.get('chatgptTabSignalRequest:1')?.state==='ignored',
    'Worker persists request suppression for a suspended service worker');

  const stopped=harness(src);
  stopped.net('start',1,'stopped');await tick();
  stopped.pageControl(1,'CHATGPT_REQUEST_CANCELED','stopped');await tick();
  stopped.net('complete',1,'stopped');await tick();
  await stopped.flushFallbacks();await tick();
  check(stopped.notices.length===0,'Canceled request does not alert');

  const error=harness(src);
  error.net('start',1,'cloudflare');await tick();
  error.net('complete',1,'cloudflare',{statusCode:403});await tick();
  await error.flushFallbacks();await tick();
  check(error.notices.length===0,'Cloudflare 403 does not alert as success');

  const uiError=harness(src);
  uiError.net('start',1,'ui-error');await tick();
  uiError.net('complete',1,'ui-error');await tick();
  uiError.pageControl(1,'CHATGPT_RESPONSE_REJECTED','ui-error');await tick();
  await uiError.flushFallbacks();await tick();
  check(uiError.notices.length===0,'Recognized error UI prevents fallback');

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
