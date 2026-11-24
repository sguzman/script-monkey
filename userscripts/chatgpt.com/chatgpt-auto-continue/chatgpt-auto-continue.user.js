// ==UserScript==
// @name         ChatGPT Auto-Continue
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.1.2
// @description  Bounded, opt-in continuation of an approved project using Chat Signals and explicit project markers.
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @updateURL    https://raw.githubusercontent.com/sguzman/script-monkey/main/userscripts/chatgpt.com/chatgpt-auto-continue/chatgpt-auto-continue.user.js
// @downloadURL  https://raw.githubusercontent.com/sguzman/script-monkey/main/userscripts/chatgpt.com/chatgpt-auto-continue/chatgpt-auto-continue.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

function parseStatus(line) {
  const m = /^\[\[(CONTINUE|ALL_DONE|QA_REQUIRED|INPUT_REQUIRED|BLOCKED|WAITING|CONTEXT_LIMIT)\]\]$/.exec(String(line).trim());
  return m ? m[1] : null;
}
function signalState(phase, confidence, reason, title) {
  const prefixes = {idle:"⚪",submitted:"📤",generating:"⏳",verifying:"🔎",finished:null,interrupted:"🔌",failed:"⚠️",limit:"🛑",unknown:"❔"};
  if (!Object.prototype.hasOwnProperty.call(prefixes,phase)) return "unavailable";
  if (["interrupted","failed","limit","unknown"].includes(phase)) return phase;
  if (phase === "finished") {
    if (confidence !== "inferred" || /^restored-/.test(reason || "")) return "unavailable";
    return /^(✅|🔔)\s/u.test(title) ? phase : "mismatch";
  }
  if (!title.startsWith(prefixes[phase]+" ")) return "mismatch";
  if (phase !== "verifying" && confidence !== "observed") return "unavailable";
  return phase;
}

(() => {
  'use strict';
  if (window.top !== window.self) return;
  const EVENTS = {
    iteration: ['Iteration completed', false, false],
    milestone: ['Milestone reached', true, false],
    ALL_DONE: ['Project completed', true, true],
    QA_REQUIRED: ['QA required', true, true],
    INPUT_REQUIRED: ['Human input required', true, true],
    BLOCKED: ['Project blocked', true, true],
    WAITING: ['Waiting for dependency', true, false],
    CONTEXT_LIMIT: ['Context handoff required', true, true],
    interrupted: ['Connection interrupted', true, true],
    failed: ['Response failed', true, true],
    limit: ['Conversation limit', true, true],
    invalid: ['Uncertain state / invalid marker', true, true],
    budget: ['Iteration limit reached', true, true],
    stopped: ['Manually stopped', false, false],
  };
  const defaults = {max:30, delay:3, alerts:Object.fromEntries(Object.entries(EVENTS).map(([k,v])=>[k,[v[1],v[2]]]))};
  function load() {
    let old;
    try { old=GM_getValue('auto-continue-settings-v1', {}); } catch { old={}; }
    const bounded=(v,fallback,min,max)=>Number.isInteger(Number(v)) && Number(v)>=min && Number(v)<=max ? Number(v):fallback;
    return {max:bounded(old?.max,30,1,100),delay:bounded(old?.delay,3,1,60),
      alerts:Object.fromEntries(Object.entries(defaults.alerts).map(([k,v])=>[k,
        Array.isArray(old?.alerts?.[k]) ? [old.alerts[k][0]===true,old.alerts[k][1]===true]:v.slice()]))};
  }
  let cfg=load(), run=null, acquiring=false, audio=null, busy=false, pending=false;
  const host=document.createElement('div');
  host.id='chatgpt-auto-continue-v1';
  if(document.getElementById(host.id)) return;
  const shadow=host.attachShadow({mode:'closed'});
  shadow.innerHTML='<style>:host{all:initial;position:fixed;right:12px;bottom:96px;z-index:2147483000;color-scheme:light dark;font:13px system-ui;color:CanvasText}section{background:Canvas;border:1px solid GrayText;border-radius:10px;padding:8px;max-width:min(330px,85vw);box-shadow:0 2px 12px #0003}button,input{font:inherit;color:inherit;background:Canvas;border:1px solid GrayText;border-radius:5px;padding:5px}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}header{display:flex;gap:6px;align-items:center}strong{flex:1}#status{margin-top:6px;overflow-wrap:anywhere;max-width:320px}#settings{max-height:50vh;overflow:auto;margin-top:8px}label{display:flex;justify-content:space-between;gap:8px;margin:5px 0}input[type=number]{width:55px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:3px;text-align:left}td:not(:first-child),th:not(:first-child){text-align:center}small{display:block;margin-top:6px;opacity:.8}</style><section><header><strong>Auto-Continue</strong><button id="start">Start</button><button id="stop" disabled>Stop</button><button id="toggle" aria-label="Settings">⚙</button></header><div id="status" role="status" aria-live="polite">Idle</div><div id="settings" hidden><label>Max automatic sends <input id="max" type="number" min="1" max="100"></label><label>Delay (seconds) <input id="delay" type="number" min="1" max="60"></label><table><thead><tr><th>Event</th><th>Desktop</th><th>Sound</th></tr></thead><tbody id="events"></tbody></table><small>Settings apply to the next run. Stop conditions always apply, even with alerts disabled.</small></div></section>';
  const el=id=>shadow.getElementById(id);
  document.body.append(host);
  const render=(msg)=>{el('status').textContent=msg;el('start').disabled=!!run||acquiring;el('stop').disabled=!run&&!acquiring;};
  const save=()=>{try{GM_setValue('auto-continue-settings-v1',cfg);}catch{render('Settings could not be saved; current tab only.');}};
  for(const key of ['max','delay']){
    const input=el(key);input.value=cfg[key];
    input.addEventListener('change',()=>{
      const n=Number(input.value), lo=1,hi=key==='max'?100:60;
      if(Number.isInteger(n)&&n>=lo&&n<=hi){cfg[key]=n;save();}
      input.value=cfg[key];
    });
  }
  for(const [key,[name]] of Object.entries(EVENTS)){
    const tr=document.createElement('tr'), td=document.createElement('td');td.textContent=name;tr.append(td);
    for(let i=0;i<2;i++){
      const cell=document.createElement('td'),box=document.createElement('input');box.type='checkbox';box.checked=cfg.alerts[key][i];
      box.setAttribute('aria-label',name+(i===0?' desktop':' sound'));
      box.addEventListener('change',()=>{cfg.alerts[key][i]=box.checked;save();});cell.append(box);tr.append(cell);
    }
    el('events').append(tr);
  }
  el('toggle').addEventListener('click',()=>{el('settings').hidden=!el('settings').hidden;});
  function notify(event,detail,settings){
    const flags=settings.alerts[event];if(!flags)return;
    if(flags[0])try{GM_notification({title:'Auto-Continue: '+EVENTS[event][0],text:detail,timeout:8000});}catch{/* visible panel remains */}
    if(flags[1]&&audio?.state==='running')try{
      const o=audio.createOscillator(),g=audio.createGain(),now=audio.currentTime;
      o.frequency.value=event==='ALL_DONE'?660:440;g.gain.setValueAtTime(.045,now);g.gain.exponentialRampToValueAtTime(.001,now+.22);
      o.connect(g);g.connect(audio.destination);o.start(now);o.stop(now+.23);
    }catch{/* browser audio is best effort */}
  }
  function route(){
    const m=/\/c\/([a-z0-9-]+)\/?$/i.exec(location.pathname);
    return m?location.origin+location.pathname.replace(/\/$/,''):null;
  }
  function phase(){
    const d=document.documentElement.dataset;
    return signalState(d.chatSignalsState,d.chatSignalsConfidence,d.chatSignalsReason,document.title);
  }
  function turns(){
    const main=document.querySelector('main');
    const turnSelector='[data-testid^="conversation-turn"],[data-turn-key]';
    const roleSelector=role=>'[data-message-author-role="'+role+'"],[data-turn="'+role+'"],[data-conversation-role="'+role+'"]'+(role==='assistant'?', [data-chatgpt-agent-turn-start]':'');
    function latest(role){
      const marker=Array.from(main?.querySelectorAll(roleSelector(role))||[]).at(-1)||null;
      const node=marker?.closest(turnSelector)||marker?.closest('article')||marker;
      const id=marker?.getAttribute('data-message-id')||node?.getAttribute('data-message-id')||
        node?.getAttribute('data-turn-key')||node?.getAttribute('data-testid')||null;
      return {node,id:node&&id?role+':'+id:null};
    }
    const u=latest('user'),a=latest('assistant');
    return {user:u.node,assistant:a.node,uid:u.id,aid:a.id,
      after:!!(u.node&&a.node&&u.node!==a.node&&(u.node.compareDocumentPosition(a.node)&Node.DOCUMENT_POSITION_FOLLOWING))};
  }
  function freshPair(t,r){
    return !!(t.uid&&t.aid&&t.after&&t.uid!==r.priorUser&&t.aid!==r.priorAssistant);
  }
  function terminalEvidence(r,reason){
    return reason==='fresh-assistant-terminal-action'||
      (reason==='finished-viewed'&&(r.sawGeneration||r.sawSubmission));
  }
  function marker(assistant){
    const blocks=assistant?.querySelectorAll('.markdown');
    if(!blocks?.length)return {status:null,milestone:false};
    const last=blocks[blocks.length-1],p=last.lastElementChild;
    if(!p||p.tagName!=='P'||p.childElementCount)return {status:null,milestone:false};
    const status=parseStatus(p.textContent);
    const prev=p.previousElementSibling;
    const milestone=!!(prev&&prev.tagName==='P'&&!prev.childElementCount&&prev.textContent.trim()==='[[MILESTONE]]');
    // Only read standalone marker-shaped paragraphs, not the transcript.
    // Reject multiple standalone terminal markers in the final response.
    if(status&&Array.from(blocks).some(b=>Array.from(b.children).some(c=>c!==p&&c.tagName==='P'&&!c.childElementCount&&parseStatus(c.textContent))))return {status:null,milestone:false};
    return {status,milestone};
  }
  function composer(){
    const input=document.querySelector('#prompt-textarea[contenteditable="true"]');
    const form=input?.closest('form');
    if(!input||!form)return null;
    const send=form.querySelector('button[data-testid="send-button"]');
    return {input,form,send};
  }
  function emptyComposer(c){
    if(!c||c.input.textContent.trim()||c.input.querySelector('img, [contenteditable="false"]'))return false;
    // Refuse if recognizable file/attachment previews or pending uploads exist.
    return !c.form.querySelector('[data-testid*="attachment-preview"], [data-testid*="attachment-chip"], [data-testid*="file-preview"], [data-testid*="upload-progress"], [aria-busy="true"]');
  }
  function finish(event,detail){
    const r=run;
    run=null;acquiring=false;
    if(r){r.release?.();notify(event,detail,r.settings);}
    render((EVENTS[event]?.[0]||event)+': '+detail);
  }
  function begin(lockRoute,release){
    const t=turns(),s=phase();
    if(route()!==lockRoute||!['idle','finished','generating','submitted','verifying'].includes(s)){
      release();acquiring=false;render('Cannot start: Signals state or conversation is unavailable.');return;
    }
    // Starting on an existing completed reply never grants automatic Send.
    // Start while generating, or manually submit the first continuation.
    run={route:lockRoute,release,settings:JSON.parse(JSON.stringify(cfg)),count:0,
      step:['generating','submitted','verifying'].includes(s)?'active':'armed',
      sawGeneration:s==='generating',sawSubmission:s==='submitted',priorUser:t.uid,priorAssistant:t.aid,
      activeUser:['generating','verifying'].includes(s)?t.uid:null,
      acceptExistingAssistant:['generating','verifying'].includes(s)&&t.after,deadline:Date.now()+60*60*1000,
      completion:null,until:0,mismatchAt:0};
    acquiring=false;render(run.step==='armed'?'Armed — manually send the first message.':'Watching current response.');
    schedule();
  }
  let requestToken=0;
  el('start').addEventListener('click',()=>{
    if(run||acquiring)return;
    const r=route();
    if(!r){render('Open an existing conversation first.');return;}
    if(!navigator.locks?.request){render('Web Locks unavailable; cannot prevent duplicate same-chat loops.');return;}
    try{audio??=new AudioContext();audio.resume().catch(()=>{});}catch{/* audio optional */}
    acquiring=true;render('Acquiring conversation lock…');
    const token=++requestToken;
    navigator.locks.request('chatgpt-auto-continue:'+r,{ifAvailable:true},async lock=>{
      if(token!==requestToken)return;
      if(!lock){acquiring=false;render('This conversation already has an active loop.');return;}
      await new Promise(resolve=>begin(r,resolve));
    }).catch(()=>{if(token===requestToken){if(run)finish('invalid','Conversation lock failed.');else{acquiring=false;render('Conversation lock failed.');}}});
  });
  el('stop').addEventListener('click',()=>{requestToken++;finish('stopped','Automatic continuation disabled.');});
  function act(){
    const r=run;if(!r)return;
    const now=Date.now();
    if(route()!==r.route){finish('invalid','Conversation changed.');return;}
    if(now>r.deadline){finish('invalid','Run or response timed out.');return;}
    const s=phase();
    if(['interrupted','failed','limit','unknown'].includes(s)){finish(s==='unknown'?'invalid':s,'Chat Signals reported '+s+'.');return;}
    if(['unavailable','mismatch'].includes(s)){
      r.mismatchAt ||= now;
      if(now-r.mismatchAt>4000)finish('invalid','Signals attributes/title missing, stale or inconsistent.');
      return;
    }
    r.mismatchAt=0;
    const t=turns();
    const reason=document.documentElement.dataset.chatSignalsReason;
    if(['armed','sent','active'].includes(r.step)){
      if(s==='submitted')r.sawSubmission=true;
      if(s==='generating')r.sawGeneration=true;
    }
    if(r.step==='armed'||r.step==='sent'){
      if(['submitted','generating','verifying'].includes(s)||
         (s==='finished'&&freshPair(t,r)&&terminalEvidence(r,reason))){
        r.step='active';r.deadline=now+60*60*1000;
        if(t.uid&&t.uid!==r.priorUser)r.activeUser=t.uid;
        render('Watching fresh response — '+r.count+'/'+r.settings.max+' sends.');
      }else return;
    }
    if(r.step==='active'){
      if(!r.activeUser&&t.uid&&t.uid!==r.priorUser)r.activeUser=t.uid;
      if(r.activeUser&&t.uid&&t.uid!==r.activeUser){finish('invalid','Unexpected user turn.');return;}
      if(s!=='finished')return;
      const problems=[];
      if(!terminalEvidence(r,reason))problems.push('no fresh Signals terminal evidence');
      if(!r.activeUser||t.uid!==r.activeUser)problems.push('user turn not matched');
      if(!t.aid)problems.push('assistant identifier missing');
      if(!t.after)problems.push('assistant not after user');
      if(!r.acceptExistingAssistant&&t.aid===r.priorAssistant)problems.push('assistant identifier unchanged');
      if(problems.length){
        r.freshnessSince ||= now;
        if(now-r.freshnessSince<2500)return;
        finish('invalid',problems.join('; ')+'.');return;
      }
      r.completion={uid:t.uid,aid:t.aid};r.step='settling';r.until=now+1000;
      return;
    }
    if(r.step==='settling'||r.step==='delay'){
      if(s!=='finished'||t.uid!==r.completion.uid||t.aid!==r.completion.aid||!t.after){
        finish('invalid','Completed reply changed before continuation.');return;
      }
      if(now<r.until)return;
      const m=marker(t.assistant);
      if(!m.status){finish('invalid','Missing or ambiguous final project marker.');return;}
      if(r.step==='settling'){
        if(m.milestone)notify('milestone','Milestone reported by the assistant.',r.settings);
        if(m.status!=='CONTINUE'){finish(m.status,'Assistant reported '+m.status+'.');return;}
        notify('iteration','Response finished.',r.settings);
        if(r.count>=r.settings.max){finish('budget','Automatic send budget exhausted.');return;}
        r.step='delay';r.until=now+r.settings.delay*1000;
        render('Continuing after delay — '+r.count+'/'+r.settings.max+' sends.');return;
      }
      if(m.status!=='CONTINUE'){finish('invalid','Project marker changed during delay.');return;}
      const c=composer();
      if(!emptyComposer(c)||(c.send&&!c.send.disabled&&c.send.getAttribute('aria-disabled')!=='true')){
        finish('invalid','Composer is not demonstrably empty or has an enabled Send before insertion.');return;
      }
      r.step='inserting';r.priorUser=t.uid;r.priorAssistant=t.aid;r.activeUser=null;r.acceptExistingAssistant=false;r.sawGeneration=false;r.sawSubmission=false;r.freshnessSince=0;r.deadline=now+10000;
      busy=true;
      try{
        c.input.focus();
        if(!document.execCommand('insertText',false,'continue')||c.input.textContent.trim()!=='continue'){
          finish('invalid','Composer insertion not confirmed; no send attempted.');return;
        }
        r.until=Date.now()+250;
      }catch{finish('invalid','Composer insertion failed.');}
      finally{busy=false;}
      return;
    }
    if(r.step==='inserting'){
      if(now<r.until)return;
      const c=composer();
      if(s!=='finished'||t.uid!==r.priorUser||t.aid!==r.priorAssistant||!c||c.input.textContent.trim()!=='continue'||!c.send||c.send.disabled||c.send.getAttribute('aria-disabled')==='true'||!c.send.getClientRects().length){
        finish('invalid','Send is not uniquely ready; draft left untouched.');return;
      }
      // Set the in-flight latch before clicking. Never retry an ambiguous send.
      r.step='sent';r.count++;r.deadline=now+45000;
      busy=true;try{c.send.click();}catch{finish('invalid','Send failed; no retry.');}finally{busy=false;}
      render(run?'Submission attempted — waiting for fresh response.':el('status').textContent);
    }
  }
  function schedule(){
    if(!run||pending)return;
    pending=true;queueMicrotask(()=>{pending=false;try{act();}catch{finish('invalid','Unexpected observer/composer error; stopped safely.');}});
  }
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-chat-signals-state','data-chat-signals-confidence','data-chat-signals-reason']});
  if(document.head)observer.observe(document.head,{childList:true,characterData:true,subtree:true});
  // A timer handles stable completion, delays, deadlines and SPA navigation;
  // throttling/suspension can delay progress, not authorize an extra Send.
  const timer=setInterval(schedule,350);
  for(const type of ['input','pointerdown','keydown']){
    document.addEventListener(type,e=>{
      if(!run||busy||!e.isTrusted||run.step==='armed')return;
      const c=composer();
      if(c?.form.contains(e.target))finish('invalid','Manual composer interaction; stopped to protect your draft.');
    },true);
  }
  window.addEventListener('pagehide',()=>{requestToken++;if(run)finish('stopped','Page closed or navigated.');observer.disconnect();clearInterval(timer);},{once:true});
})();
