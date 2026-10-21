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
  const callbacks = new Map(), titleNode = {}, mutations = [];
  const links = [], alerts = [];
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
    constructor(fn) {this.callback=fn;observerCount++;mutations.push(fn);}
    observe(node,opts) {
      assert.equal(node,titleNode);
      assert.deepEqual(Object.keys(opts).sort(),['characterData','childList','subtree']);
    }
    disconnect(){disconnects++;}
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
    querySelectorAll:(selector)=> {
      assert.match(selector,/\[role="alert"\]/);
      return alerts;
    },
    addEventListener:(name,fn)=>callbacks.set('document.'+name,fn)
  };
  const window={
    addEventListener:(name,fn)=>callbacks.set('window.'+name,fn),
    navigation:{addEventListener:(name,fn)=>callbacks.set('navigation.'+name,fn)}
  };
  const globalThis={ChatGPTConversationColor:api};
  const ctx=vm.createContext({globalThis,location,document,window,MutationObserver:Observer,Date});
  function execute(){vm.runInContext(code,ctx,{timeout:1000});}
  execute();
  return {
    location,document,link,links,alerts,globalThis,execute,
    get observerCount(){return observerCount;},
    get writes(){return writes;},
    get disconnects(){return disconnects;},
    fire(name){callbacks.get(name)?.();},
    rename(next){document.title=next;for(const cb of mutations)cb();},
    status(next){globalThis.__chatgptTabSignalSetStatus(next);},
    banner(content,cls='text-red-500'){
      alerts.push({
        textContent:content,
        className:cls,
        closest:()=>null
      });
    },
    clearBanners(){alerts.length=0;}
  };
}
const normal=page('https://chatgpt.com/c/'+id);
const png=normal.link.getAttribute('href');
assert.equal(normal.document.title,'Synthetic conversation - ChatGPT',
  'Idle status has no title emoji');
assert.ok(png.includes(api.assignFromUrl('https://chatgpt.com/c/'+id, []).hex+'-square'));
normal.execute();
assert.equal(normal.observerCount,1,'No duplicate listeners on reinjection');
normal.status('generating');
assert.equal(normal.document.title,'⏳ Synthetic conversation - ChatGPT');
assert.equal(normal.link.getAttribute('href'),png,'Generation does not change identity color');
normal.status('unread');
assert.equal(normal.document.title,'🔔 Synthetic conversation - ChatGPT');
normal.status('finished');
assert.equal(normal.document.title,'✅ Synthetic conversation - ChatGPT');
normal.rename('React rename - ChatGPT');
assert.equal(normal.document.title,'✅ React rename - ChatGPT');
normal.status('idle');
assert.equal(normal.document.title,'React rename - ChatGPT');
normal.banner('Message delivery timed out. Please try again.');
assert.equal(normal.globalThis.__chatgptTabSignalDetectError(),'error');
normal.status('error');
assert.equal(normal.document.title,'⚠️ React rename - ChatGPT');
assert.equal(normal.link.getAttribute('href'),png,'Error does not change favicon color');
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

const homepage=page('https://chatgpt.com/');
assert.equal(homepage.link.getAttribute('href'),'/favicon.ico');
assert.equal(homepage.document.title,'Synthetic conversation - ChatGPT');
homepage.status('generating');
assert.equal(homepage.link.getAttribute('href'),'/favicon.ico');

const churn=page('https://chatgpt.com/c/'+id);
churn.status('generating');
for(let i=0;i<70;i++)churn.rename('React churn '+i);
assert.ok(churn.disconnects>=1,'Runaway title observer disconnects');
assert.ok(churn.writes<=70+24,'Title writes are bounded');

const ignored=page('https://chatgpt.com/c/'+id);
ignored.banner('A red word embedded in a code block');
ignored.alerts[0].closest=()=>({className:'conversation-turn'});
assert.equal(ignored.globalThis.__chatgptTabSignalDetectError(),null,
  'Conversation content is not mistaken for an error banner');
assert.equal(normal.globalThis.__chatgptTabSignalGetIcon().startsWith('data:image/png;base64,synthetic-'),true);
console.log('PASS perceptual favicon identity, five status emojis, errors/limits, SPA, bounded title writes');
