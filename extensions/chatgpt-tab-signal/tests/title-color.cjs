'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const api = require('../conversation-color.js');
const code = fs.readFileSync(path.join(__dirname, '../chat-color-title.js'), 'utf8');
const id = '12345678-1234-4234-8234-1234567890ab';

function page(url, initialTitle = 'Synthetic conversation - ChatGPT') {
  let title = initialTitle, writes = 0, disconnects = 0, observerCount = 0;
  let timerId=0;
  const timers=new Map();
  const callbacks = new Map(), titleNode = {}, mutations = [];
  const links = [], alerts = [], assistantMessages = [], headings = [], events = [];
  const root = {dataset:{},
    style:{values:new Map(),getPropertyValue(k){return this.values.get(k)||'';},
      setProperty(k,v){this.values.set(k,v);},removeProperty(k){this.values.delete(k);}},
    dispatchEvent(e){events.push(e.type);}
  };
  const attributes = new Map([['href','/favicon.ico'], ['type','image/x-icon']]);
  const link = {
    isConnected:true,
    getAttribute:k=>attributes.get(k)??null,
    setAttribute:(k,v)=>attributes.set(k,v),
    hasAttribute:k=>attributes.has(k),
    removeAttribute:k=>attributes.delete(k)
  };
  links.push(link);
  class Observer {
    constructor(fn) {this.callback=fn;observerCount++;mutations.push(this);}
    observe(node,opts) {
      assert.equal(node,titleNode);
      assert.deepEqual(Object.keys(opts).sort(),['characterData','childList','subtree']);
    }
    disconnect(){disconnects++;this.disconnected=true;}
  }
  const location={href:url};
  const document={
    readyState:'complete',
    get title(){return title;},
    set title(value){title=String(value);writes++;},
    head:{
      querySelector:(q)=>{assert.equal(q,'title');return titleNode;},
      querySelectorAll:(q)=>{assert.equal(q,'link[rel~="icon"]');return links;},
      appendChild:(node)=>{node.isConnected=true;links.push(node);}
    },
    createElement:(kind)=>{
      if(kind==='canvas'){
        const canvas={width:0,height:0,shape:'',hex:''};
        return Object.assign(canvas,{
          getContext:()=>({
            set fillStyle(value){canvas.hex=value;},
            beginPath(){},arc(){canvas.shape='circle';},fill(){},
            fillRect(){canvas.shape='square';}
          }),
          toDataURL:()=> 'data:image/png;base64,synthetic-' + canvas.hex + '-' + canvas.shape
        });
      }
      assert.equal(kind,'link');
      const attrs=new Map();
      return {
        dataset:{},rel:'',isConnected:false,
        getAttribute:k=>attrs.get(k)??null,
        setAttribute:(k,v)=>attrs.set(k,v),
        hasAttribute:k=>attrs.has(k),
        removeAttribute:k=>attrs.delete(k),
        remove(){this.isConnected=false;links.splice(links.indexOf(this),1);}
      };
    },
    querySelector:selector=>selector.includes('[data-message-author-role]') ?
      (assistantMessages.at(-1)||null):null,
    querySelectorAll:selector=>{
      if(selector==='[data-message-author-role="assistant"]')return assistantMessages;
      if(selector.includes('main h1'))return headings;
      assert.match(selector,/\[role="alert"\]/);
      return alerts;
    },
    documentElement:root,
    addEventListener:(name,fn)=>callbacks.set('document.'+name,fn)
  };
  const window={
    addEventListener:(name,fn)=>callbacks.set('window.'+name,fn),
    navigation:{addEventListener:(name,fn)=>callbacks.set('navigation.'+name,fn)}
  };
  const globalThis={ChatGPTConversationColor:api};
  const ctx=vm.createContext({globalThis,location,document,window,
    MutationObserver:Observer,Date,Event:class {constructor(type){this.type=type;}},
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id)});
  function execute(){vm.runInContext(code,ctx,{timeout:1000});}
  execute();
  return {
    location,document,link,links,alerts,globalThis,execute,root,events,
    get observerCount(){return observerCount;},
    get writes(){return writes;},
    get disconnects(){return disconnects;},
    fire(name){callbacks.get(name)?.();},
    rename(next){document.title=next;for(const observer of mutations) {
        if(!observer.disconnected) observer.callback();
      }
      this.flushTitleRepairs();
    },
    churnTitle(next){document.title=next;for(const observer of mutations) {
        if(!observer.disconnected) observer.callback();
      }
    },
    flushTitleRepairs(){for(const [id,t] of [...timers]){
      timers.delete(id);t.fn();
    }},
    get pendingTimers(){return timers.size;},
    get pendingRepairTimers(){return [...timers.values()].filter(t=>t.delay===350).length;},
    status(next){globalThis.__chatgptTabSignalSetStatus(next);},
    banner(content,cls='text-red-500'){
      alerts.push({
        textContent:content,
        className:cls,
        closest:()=>null
      });
    },
    clearBanners(){alerts.length=0;},
    assistant(text){assistantMessages.length=0;
      if(text!==null)assistantMessages.push({textContent:text,getClientRects:()=>[{}]});},
    failedPage(text){headings.length=0;
      if(text!==null)headings.push({textContent:text,getClientRects:()=>[{}]});}
  };
}
const normal=page('https://chatgpt.com/c/'+id);
const png=normal.link.getAttribute('href');
assert.equal(normal.document.title,'Synthetic conversation - ChatGPT',
  'Idle status has no title emoji');
assert.ok(png.includes(api.assignFromUrl('https://chatgpt.com/c/'+id, []).hex+'-square'));
normal.execute();
assert.equal(normal.observerCount,1,'Same-build reinjection does not duplicate observers');
normal.status('generating');
const preservedTitle=normal.document.title;
normal.execute();
assert.equal(normal.document.title,preservedTitle);
assert.equal(normal.observerCount,1);
normal.status('generating');
assert.equal(normal.document.title,'⏳ Synthetic conversation - ChatGPT');
assert.equal(normal.root.dataset.chatgptTabSignalApiVersion,'1');
assert.equal(normal.root.dataset.chatgptTabSignalState,'generating');
assert.equal(normal.root.dataset.chatgptTabSignalColor,
  api.assignFromUrl('https://chatgpt.com/c/'+id, []).hex);
assert.equal(normal.root.style.getPropertyValue('--chatgpt-tab-signal-identity-hex-v2'),
  normal.root.dataset.chatgptTabSignalColor);
assert.ok(normal.events.includes('chatgpt-tab-signal-change'));
assert.equal(normal.link.getAttribute('href'),png,'Generation does not change identity color');
normal.status('unread');
assert.equal(normal.document.title,'🔔 Synthetic conversation - ChatGPT');
normal.status('finished');
assert.equal(normal.document.title,'✅ Synthetic conversation - ChatGPT');
normal.rename('React rename - ChatGPT');
assert.equal(normal.document.title,'✅ React rename - ChatGPT');
normal.status('idle');
assert.equal(normal.document.title,'React rename - ChatGPT');
assert.equal(normal.root.dataset.chatgptTabSignalState,'idle');
const eventCount=normal.events.length;
const writesAtRest=normal.writes;
const iconAtRest=normal.link.getAttribute('href');
for(let i=0;i<40;i++){
  normal.fire('window.focus');normal.fire('document.visibilitychange');
}
assert.equal(normal.writes,writesAtRest,'Focus cannot rewrite a settled title');
assert.equal(normal.link.getAttribute('href'),iconAtRest,
  'Focus cannot recolor a settled favicon');
assert.equal(normal.events.length,eventCount,
  'Focus cannot broadcast an unsolicited state/color change');
normal.status('idle');
assert.equal(normal.events.length,eventCount,
  'No duplicate public change events for unchanged state');
normal.banner('Message delivery timed out. Please try again.');
assert.equal(normal.globalThis.__chatgptTabSignalDetectError(),'error');
normal.status('error');
assert.equal(normal.document.title,'⚠️ React rename - ChatGPT');
assert.equal(normal.link.getAttribute('href'),png,'Error does not change favicon color');
normal.clearBanners();
normal.banner('Connection interrupted. Waiting for the complete answer',
  'rounded-xl border-neutral-600');
assert.equal(normal.globalThis.__chatgptTabSignalDetectError(),'interrupted',
  'Neutral-colored interruption has its own state');
normal.status('interrupted');
assert.equal(normal.document.title,'🔌 React rename - ChatGPT');
assert.equal(normal.link.getAttribute('href'),png);
normal.clearBanners();
normal.banner('Normal short red-styled text unrelated to a failed request');
assert.equal(normal.globalThis.__chatgptTabSignalDetectError(),null,
  'Red styling alone must never suppress a response completion');
normal.banner('Please try again');
assert.equal(normal.globalThis.__chatgptTabSignalDetectError(),null,
  'Generic advice without an actual failure must not create an error');
normal.banner("You've reached the maximum length for this conversation, but you can keep talking by starting a new chat.");
assert.equal(normal.globalThis.__chatgptTabSignalDetectError(),'limit',
  'Terminal conversation length limit overrides an earlier generic error');
normal.status('limit');
assert.equal(normal.document.title,'🛑 React rename - ChatGPT');
normal.location.href='https://chatgpt.com/projects';
normal.fire('navigation.currententrychange');
assert.equal(normal.document.title,'React rename - ChatGPT');
assert.equal(normal.link.getAttribute('href'),'/favicon.ico',
  'Leaving a chat restores its original favicon');
normal.location.href='https://chatgpt.com/c/next-synthetic-chat';
normal.fire('navigation.currententrychange');
assert.match(normal.link.getAttribute('href'),/^data:image\/png;base64,synthetic-#/);
assert.equal(normal.document.title,'React rename - ChatGPT',
  'A different chat starts idle, with the previous status cleared');

const project=page('https://chatgpt.com/g/g-p-a8b4def0-demo/c/'+id);
assert.ok(project.link.getAttribute('href').includes(api.assignFromUrl('https://chatgpt.com/g/g-p-a8b4def0-demo/c/'+id, []).hex+'-circle'));
project.status('limit');
assert.equal(project.document.title,'🛑 Synthetic conversation - ChatGPT');
assert.ok(project.link.getAttribute('href').includes(api.assignFromUrl('https://chatgpt.com/g/g-p-a8b4def0-demo/c/'+id, []).hex+'-circle'));

const responseFailure=page('https://chatgpt.com/c/'+id);
responseFailure.assistant('This response couldn’t load');
responseFailure.fire('window.focus');
assert.equal(responseFailure.document.title,'❌ Synthetic conversation - ChatGPT');
assert.equal(responseFailure.root.dataset.chatgptTabSignalState,'response_load_failed');
responseFailure.assistant('Normal response');
responseFailure.fire('window.focus');
assert.equal(responseFailure.root.dataset.chatgptTabSignalState,'idle');

const conversationFailure=page('https://chatgpt.com/c/'+id);
conversationFailure.failedPage('Could not load this ChatGPT conversation Try again');
conversationFailure.fire('window.focus');
assert.equal(conversationFailure.document.title,'🚫 Synthetic conversation - ChatGPT');
assert.equal(conversationFailure.root.dataset.chatgptTabSignalState,'conversation_load_failed');
conversationFailure.failedPage(null);
conversationFailure.fire('window.focus');
assert.equal(conversationFailure.root.dataset.chatgptTabSignalState,'idle');

const homepage=page('https://chatgpt.com/');
assert.equal(homepage.link.getAttribute('href'),'/favicon.ico');
assert.equal(homepage.document.title,'Synthetic conversation - ChatGPT');
homepage.status('generating');
assert.equal(homepage.link.getAttribute('href'),'/favicon.ico');

const churn=page('https://chatgpt.com/c/'+id);
churn.status('generating');
const beforeWrites=churn.writes;
for(let i=0;i<70;i++)churn.churnTitle('React churn '+i);
assert.equal(churn.pendingRepairTimers,1,
  'Rapid React title updates coalesce to one pending repair');
assert.equal(churn.writes-beforeWrites,70,
  'Observer does not immediately fight every React title mutation');
churn.flushTitleRepairs();
assert.equal(churn.document.title,'⏳ React churn 69');
assert.equal(churn.writes-beforeWrites,71,
  'Seventy React title updates cause only one extension repair write');
const owner=churn.globalThis.__chatgptConversationTitleColorOwner;
assert.equal(owner.build,'0.1.24');
owner.dispose();
churn.churnTitle('React no longer contested');
assert.equal(churn.pendingTimers,0,
  'Replaced owner disconnects observer and cancels timers');
assert.equal(churn.document.title,'React no longer contested');

const ignored=page('https://chatgpt.com/c/'+id);
ignored.banner('A red word embedded in a code block');
ignored.alerts[0].closest=()=>({className:'conversation-turn'});
assert.equal(ignored.globalThis.__chatgptTabSignalDetectError(),null,
  'Conversation content is not mistaken for an error banner');
assert.equal(normal.globalThis.__chatgptTabSignalGetIcon().startsWith('data:image/png;base64,synthetic-'),true);
console.log('PASS identity, failed-load recovery, public DOM state/color API, bounded title writes');
