'use strict';
function harness(source, opts={}) {
  const listeners={}, messages=[], injections=[], notes=[], sounds=[], cleared=[];
  const session=new Map(),tabOps=[],windowOps=[];
  let activeTab={id:4,url:'https://chatgpt.com/c/fixture',active:true,windowId:7};
  const chrome={
    runtime:{
      onMessage:{addListener:f=>{listeners.message=f;}},
      onInstalled:{addListener:f=>{listeners.installed=f;}},
      getURL:p=>'chrome-extension://test/'+p,
      getContexts:async()=>[{contextType:'OFFSCREEN_DOCUMENT'}],
      sendMessage:async m=>{sounds.push(m);return {ok:true};}
    },
    webRequest:{
      onBeforeRequest:{addListener:f=>{listeners.start=f;}},
      onCompleted:{addListener:f=>{listeners.complete=f;}},
      onErrorOccurred:{addListener:f=>{listeners.error=f;}}
    },
    storage:{session:{
      async get(k){return {[k]:session.get(k)};},
      async set(x){for(const [k,v] of Object.entries(x))session.set(k,v);},
      async remove(k){session.delete(k);}
    }},
    tabs:{
      onRemoved:{addListener:f=>{listeners.removed=f;}},
      onUpdated:{addListener:f=>{listeners.updated=f;}},
      query:async()=>[activeTab],
      get:async id=>({id,windowId:7}),
      update:async(id,properties)=>tabOps.push({id,properties}),
      sendMessage:async(id,message)=>{
        messages.push({id,message});
        if(opts.unreachable)throw new Error('unreachable renderer');
      }
    },
    scripting:{executeScript:async args=>{
      injections.push(args);
      if(opts.injectFails)throw new Error('injection rejected');
      return [{frameId:0}];
    }},
    offscreen:{createDocument:async()=>{}},
    notifications:{
      create:async(id,options)=>{notes.push({id,options});return id;},
      clear:async id=>{cleared.push(id);return true;},
      onClicked:{addListener:f=>{listeners.clicked=f;}}
    },
    windows:{update:async(id,properties)=>windowOps.push({id,properties})}
  };
  class URLShim {
    constructor(url) {
      const match=String(url).match(/^([a-z]+):\/\/([^/?#]+)(\/[^?#]*)?/i);
      this.protocol=match?.[1]+':' || '';
      this.hostname=match?.[2] || '';
      this.pathname=match?.[3] || '/';
    }
  }
  new Function('chrome','URL','console',source)(chrome,URLShim,{warn(){},error(){}});
  return {
    listeners,messages,injections,notes,sounds,session,cleared,tabOps,windowOps,
    setTab(id,url='https://chatgpt.com/c/fixture'){activeTab={id,url,active:true,windowId:7};},
    request(phase,props={}){
      listeners[phase]({tabId:4,method:'POST',requestId:'r1',statusCode:200,
        url:'https://chatgpt.com/backend-api/f/conversation',...props});
    },
    async message(message,as='popup'){
      const sender=as==='popup'?{url:'chrome-extension://test/popup.html'}:
        {url:'https://chatgpt.com/c/fixture',tab:{id:as==='other'?5:4}};
      return new Promise(resolve=>{
        const value=listeners.message(message,sender,resolve);
        if(value!==true)resolve(undefined);
      });
    }
  };
}
async function runSimulation(source) {
  const results=[];
  const check=(pass,description)=>results.push({pass:!!pass,description});
  const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
  const h=harness(source);
  h.request('start');h.request('complete');await flush();
  check(h.messages.length===0,'Default-off: no content messages on network events');
  check(h.injections.length===0,'Default-off: no auto-injection');
  check(h.session.size===0,'Default-off: no opted-in tabs');
  check((await h.message({type:'CHATGPT_TAB_STATUS'}))?.enabled===false,'Popup shows off');
  check((await h.message({type:'CHATGPT_ENABLE_ACTIVE_TAB'},'page'))?.ok===false,
    'Injected page cannot activate itself');
  check(h.injections.length===0,'Page activation forgery causes zero injections');

  const enabled=await h.message({type:'CHATGPT_ENABLE_ACTIVE_TAB'});
  check(enabled?.ok&&enabled.enabled,'Explicit popup activation succeeds');
  check(h.injections.length===1&&h.injections[0].target.tabId===4,'Only selected tab injected');
  check(h.session.size===1,'Single session opt-in persisted');
  const baseline=h.messages.length;
  h.request('start',{method:'GET'});await flush();
  check(h.messages.length===baseline,'Ignores GET requests');
  h.request('start',{requestId:'network1'});h.request('complete',{requestId:'network1'});await flush();
  check(h.messages.some(v=>v.message.type==='CHATGPT_GENERATION_STARTED'&&v.id===4),
    'Selected tab receives network start');
  check(h.messages.some(v=>v.message.type==='CHATGPT_CONVERSATION_REQUEST_COMPLETED'&&v.id===4),
    'Selected tab receives successful network completion');
  const during=h.messages.length;
  h.request('start',{tabId:5,requestId:'other'});h.request('complete',{tabId:5,requestId:'other'});await flush();
  check(h.messages.length===during,'All other tabs receive zero request messages');
  check(h.injections.length===1,'Unselected tabs are never reinjected');
  h.setTab(5);
  const status=await h.message({type:'CHATGPT_TAB_STATUS'});
  check(status?.anotherEnabled,'Popup knows another tab is selected');
  check((await h.message({type:'CHATGPT_ENABLE_ACTIVE_TAB'}))?.ok===false,
    'Cannot enable a second tab while first selected');
  check(h.injections.length===1,'Second-tab rejection never injects');
  h.setTab(4);
  const completed={type:'CHATGPT_RESPONSE_COMPLETE',requestId:'network1',
    sessionTitle:'Example - ChatGPT',response:'Response finished.'};
  await h.message(completed,'page');await flush();
  check(h.notes.length===1,'Enabled completion yields exactly one native alert');
  check(h.sounds.some(v=>v.type==='PLAY_COMPLETION_SOUND'),'Enabled completion schedules sound');
  await h.message(completed,'page');await flush();
  check(h.notes.length===1,'Duplicate completion suppressed');
  await h.message({...completed,requestId:'other'},'other');await flush();
  check(h.notes.length===1,'Unselected tab cannot spoof completion');
  const noteId=h.notes[0].id;
  await h.listeners.clicked(noteId);
  check(h.tabOps.some(v=>v.id===4&&v.properties.active),'Notification points to selected tab');
  check(h.cleared.includes(noteId),'Notification click clears native alert');

  const disabled=await h.message({type:'CHATGPT_DISABLE_ACTIVE_TAB'});
  check(disabled?.ok&&!disabled.enabled,'Popup can disable tab');
  check(h.session.size===0,'Disable revokes session selection');
  check(h.messages.at(-1).message.type==='CHATGPT_DISABLE_TAB','Disable instructs page cleanup');
  const count=h.messages.length;
  h.request('start',{requestId:'after'});await flush();
  check(h.messages.length===count,'Disabled tab receives no more messages');
  await h.message({...completed,requestId:'after'},'page');await flush();
  check(h.notes.length===1,'Disabled tab cannot create alerts');

  const wrong=harness(source);
  wrong.setTab(4,'https://evil.example/');
  check((await wrong.message({type:'CHATGPT_ENABLE_ACTIVE_TAB'}))?.ok===false,
    'Non-ChatGPT origin cannot be enabled');
  check(wrong.injections.length===0,'Non-ChatGPT origin never injected');
  const failed=harness(source,{injectFails:true});
  check((await failed.message({type:'CHATGPT_ENABLE_ACTIVE_TAB'}))?.ok===false,
    'Failed injection is reported');
  check(failed.session.size===0,'Failed injection keeps extension off');

  const lifecycle=harness(source);
  await lifecycle.message({type:'CHATGPT_ENABLE_ACTIVE_TAB'});
  lifecycle.listeners.updated(4,{status:'loading'});await flush();
  check(lifecycle.session.size===0,'Navigation/reload revokes opt-in');
  await lifecycle.message({type:'CHATGPT_ENABLE_ACTIVE_TAB'});
  lifecycle.listeners.removed(4);await flush();
  check(lifecycle.session.size===0,'Tab removal revokes opt-in');
  await lifecycle.message({type:'CHATGPT_ENABLE_ACTIVE_TAB'});
  lifecycle.listeners.installed();await flush();
  check(lifecycle.session.size===0,'Extension upgrade revokes opt-in');

  const unreachable=harness(source,{unreachable:true});
  await unreachable.message({type:'CHATGPT_ENABLE_ACTIVE_TAB'});
  for(let i=0;i<60;i++){unreachable.request('start',{requestId:'n'+i});}
  await flush();
  check(unreachable.injections.length===1,'Unreachable tab never triggers network reinjection');
  check(unreachable.session.size===0,'Unreachable tab fails closed');

  return results;
}
module.exports={runSimulation};
if(require.main===module){
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.resolve(__dirname,'../service-worker.js'),'utf8');
  runSimulation(src).then(rows=>{
    for(const row of rows)console.log((row.pass?'PASS ':'FAIL ')+row.description);
    if(rows.some(row=>!row.pass))process.exitCode=1;
  }).catch(e=>{console.error(e);process.exitCode=1;});
}
