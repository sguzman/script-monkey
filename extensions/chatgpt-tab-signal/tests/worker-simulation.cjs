'use strict';
// Global-switch and lazy-injection regression suite; runs with no browser.
function harness(src,opts={}){
  const ev={},messages=[],injections=[],notices=[],sounds=[],cleared=[];
  const session=new Map(),local=new Map(),loaded=new Set(),urls=new Map();
  const ops=[];
  for(let i=1;i<=24;i++)urls.set(i,'https://chatgpt.com/c/fixture-'+i);
  const chrome={
    runtime:{
      onMessage:{addListener:f=>ev.message=f},
      onInstalled:{addListener:f=>ev.installed=f},
      getURL:p=>'chrome-extension://test/'+p,
      getContexts:async()=>[{contextType:'OFFSCREEN_DOCUMENT'}],
      sendMessage:async m=>{sounds.push(m);return {ok:true}}
    },
    storage:{
      session:{
        async get(k){return k===null?Object.fromEntries(session):{[k]:session.get(k)}},
        async set(obj){for(const [k,v] of Object.entries(obj))session.set(k,v)},
        async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])session.delete(k)}
      },
      local:{
        async get(k){return {[k]:local.get(k)}},
        async set(obj){for(const [k,v] of Object.entries(obj))local.set(k,v)}
      }
    },
    webRequest:{
      onBeforeRequest:{addListener:f=>ev.start=f},
      onCompleted:{addListener:f=>ev.complete=f},
      onErrorOccurred:{addListener:f=>ev.error=f}
    },
    tabs:{
      onRemoved:{addListener:f=>ev.removed=f},
      onUpdated:{addListener:f=>ev.updated=f},
      query:async()=>[{id:1,url:urls.get(1)}],
      get:async id=>{if(!urls.has(id))throw Error('no tab');return {id,url:urls.get(id),windowId:7}},
      update:async(id,x)=>ops.push({id,x}),
      sendMessage:async(id,m)=>{
        if(!loaded.has(id)||opts.unreachable?.includes(id))throw Error('unreachable');
        messages.push({id,m})
      }
    },
    scripting:{executeScript:async args=>{
      injections.push(args);
      if(opts.fail?.includes(args.target.tabId))throw Error('injection failure');
      loaded.add(args.target.tabId);
    }},
    offscreen:{createDocument:async()=>{}},
    notifications:{
      create:async(id,options)=>{notices.push({id,options});return id},
      clear:async id=>{cleared.push(id);return true},
      onClicked:{addListener:f=>ev.clicked=f}
    },
    windows:{update:async()=>{}}
  };
  class URLShim{
    constructor(url){
      const m=String(url).match(/^([a-z]+):\/\/([^/?#]+)(\/[^?#]*)?/i);
      this.protocol=m?m[1]+':':'';
      this.hostname=m?.[2]||'';
      this.pathname=m?.[3]||'/';
    }
  }
  new Function('chrome','URL','console',src)(chrome,URLShim,{warn(){},error(){}});
  return {
    ev,messages,injections,notices,sounds,cleared,session,local,loaded,urls,
    net(kind,id=1,requestId='r1',changes={}){
      ev[kind]({tabId:id,requestId,method:'POST',statusCode:200,
        url:'https://chatgpt.com/backend-api/f/conversation',...changes});
    },
    async msg(type,as='popup',id=1,props={}){
      const sender=as==='popup'?{url:'chrome-extension://test/popup.html'}:
        {url:urls.get(id),tab:{id}};
      return new Promise(resolve=>{
        const result=ev.message({type,...props},sender,resolve);
        if(result!==true)resolve(undefined);
      });
    }
  };
}
async function runSimulation(src){
  const h=harness(src),rows=[];
  const chk=(x,label)=>rows.push({pass:!!x,description:label});
  const tick=async()=>{for(let i=0;i<220;i++)await Promise.resolve()};
  chk((await h.msg('CHATGPT_GLOBAL_STATUS'))?.enabled===false,'Disabled by default');
  h.net('start');h.net('complete');await tick();
  chk(h.injections.length===0&&h.messages.length===0,'No injection or IPC before enable');
  chk((await h.msg('CHATGPT_GLOBAL_ENABLE','page'))?.ok===false,'Page cannot enable globally');
  chk(h.local.size===0,'Rejected enable leaves settings unchanged');
  chk((await h.msg('CHATGPT_GLOBAL_ENABLE'))?.enabled===true,'One popup click enables all tabs');
  chk(h.injections.length===0&&h.messages.length===0,'Enabling leaves ALL idle tabs untouched');
  for(let i=1;i<=12;i++)h.net('start',i,'start-'+i);
  await tick();
  chk(h.injections.length===12,'First POST lazily injects twelve active tabs');
  chk(new Set(h.injections.map(x=>x.target.tabId)).size===12,'One script per active tab');
  chk(h.messages.filter(x=>x.m.type==='CHATGPT_GENERATION_STARTED').length===12,
    'All 12 active tabs get independent start signals');
  chk([...h.loaded].every(id=>id<=12),'Other 12 open idle tabs remain untouched');
  for(let i=1;i<=12;i++)h.net('complete',i,'start-'+i);
  await tick();
  chk(h.messages.filter(x=>x.m.type==='CHATGPT_CONVERSATION_REQUEST_COMPLETED').length===12,
    'All twelve completions routed');
  chk(h.injections.length===12,'Completion does not inject again');
  h.net('start',3,'again');await tick();
  chk(h.injections.length===12,'Existing tab reuses its content script');
  let before=h.injections.length;
  h.net('start',20,'get',{method:'GET'});
  h.net('start',21,'alien',{url:'https://evil.example/backend-api/f/conversation'});
  h.urls.set(22,'https://evil.example/c/fixture');
  h.net('start',22,'moved');
  await tick();
  chk(h.injections.length===before,'GET, foreign host and navigated tabs cannot inject');
  await h.msg('CHATGPT_RESPONSE_COMPLETE','page',3,{
    requestId:'response-3',sessionTitle:'Example - ChatGPT',response:'Response finished.'
  });
  await tick();
  chk(h.notices.length===1,'First completed response shows notification');
  chk(h.sounds.some(m=>m.type==='PLAY_COMPLETION_SOUND'),'Completion plays sound');
  await h.msg('CHATGPT_RESPONSE_COMPLETE','page',3,{
    requestId:'response-3',sessionTitle:'Example',response:'Response finished.'
  });
  await tick();
  chk(h.notices.length===1,'Deduplication prevents repeating same completion');
  const firstId=h.notices[0].id;
  await h.ev.clicked(firstId);await tick();
  chk(h.cleared.includes(firstId),'Clicking response notification clears it');
  const off=await h.msg('CHATGPT_GLOBAL_DISABLE');
  chk(off?.ok&&!off.enabled,'One click disables all tabs');
  chk(h.session.size===0,'All per-tab injection flags cleared on disable');
  chk(h.messages.filter(x=>x.m.type==='CHATGPT_DISABLE_TAB').length===12,
    'Only 12 used tabs receive disable cleanup');
  before=h.messages.length;
  h.net('start',3,'disabled');h.net('complete',3,'disabled');await tick();
  chk(h.messages.length===before,'Disabled network traffic does not reach pages');
  await h.msg('CHATGPT_RESPONSE_COMPLETE','page',3,{
    requestId:'late',sessionTitle:'Example',response:'Response finished.'
  });
  await tick();
  chk(h.notices.length===1,'Late completion after global off is ignored');
  chk(h.injections.length===12,'Disabling did not inject any idle tab');
  await h.msg('CHATGPT_GLOBAL_ENABLE');
  chk(h.injections.length===12,'Re-enable still leaves tabs idle');
  h.net('start',3,'reenabled');await tick();
  chk(h.injections.length===12,'Reenabled prior page requires no second injection');
  chk(h.messages.some(x=>x.id===3&&x.m.type==='CHATGPT_ENABLE_TAB'),
    'Previously disabled content is reactivated on its next request');
  h.urls.set(3,'https://chatgpt.com/c/another');
  h.loaded.delete(3);h.ev.updated(3,{status:'loading'});await tick();
  h.net('start',3,'new-document');await tick();
  chk(h.injections.length===13,'Navigation allows one injection into replacement document');
  h.ev.removed(3);await tick();
  chk(!h.session.has('chatgptTabSignalInjected:3'),'Close cleans the per-tab attempt flag');
  const bad=harness(src,{fail:[1]});
  await bad.msg('CHATGPT_GLOBAL_ENABLE');
  for(let i=0;i<40;i++)bad.net('start',1,'fail-'+i);
  await tick();
  chk(bad.injections.length===1,'Unreachable renderer triggers at most one injection attempt');
  chk(bad.messages.length===0,'Failed renderer never receives lifecycle messages');
  chk((await h.msg('TEST_BOTH'))?.ok===true,'Popup notification test still works');
  return rows;
}
module.exports={runSimulation};
if(require.main===module){
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.resolve(__dirname,'../service-worker.js'),'utf8');
  runSimulation(source).then(rows=>{
    for(const r of rows)console.log((r.pass?'PASS ':'FAIL ')+r.description);
    if(rows.some(r=>!r.pass))process.exitCode=1;
  }).catch(e=>{console.error(e);process.exitCode=1});
}
