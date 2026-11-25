// ==UserScript==
// @name         ChatGPT Auto-Continue
// @namespace    https://github.com/sguzman/script-monkey
// @version      0.1.10
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
    if (confidence !== "inferred") return "unavailable";
    if (!/^(✅|🔔)\s/u.test(title)) return "mismatch";
    return /^restored-/.test(reason || "") ? "historical" : phase;
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
  const defaults = {max:30, delay:3, waitMinutes:3, alerts:Object.fromEntries(Object.entries(EVENTS).map(([k,v])=>[k,[v[1],v[2]]]))};
  function load() {
    let old;
    try { old=GM_getValue('auto-continue-settings-v1', {}); } catch { old={}; }
    const bounded=(v,fallback,min,max)=>Number.isInteger(Number(v)) && Number(v)>=min && Number(v)<=max ? Number(v):fallback;
    return {max:bounded(old?.max,30,1,100),delay:bounded(old?.delay,3,1,60),waitMinutes:bounded(old?.waitMinutes,3,1,60),
      alerts:Object.fromEntries(Object.entries(defaults.alerts).map(([k,v])=>[k,
        Array.isArray(old?.alerts?.[k]) ? [old.alerts[k][0]===true,old.alerts[k][1]===true]:v.slice()]))};
  }
  let cfg=load(), run=null, acquiring=false, audio=null, busy=false, pending=false;
  const host=document.createElement('div');
  host.id='chatgpt-auto-continue-v1';
  if(document.getElementById(host.id)) return;
  const shadow=host.attachShadow({mode:'closed'});
  shadow.innerHTML='<style>:host{all:initial;position:fixed;right:12px;bottom:96px;z-index:2147483000;color-scheme:light dark;font:13px system-ui;color:CanvasText}section{background:Canvas;border:1px solid GrayText;border-radius:10px;padding:8px;max-width:min(330px,85vw);box-shadow:0 2px 12px #0003}button,input{font:inherit;color:inherit;background:Canvas;border:1px solid GrayText;border-radius:5px;padding:5px}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}header{display:flex;gap:6px;align-items:center}strong{flex:1}#status{margin-top:6px;overflow-wrap:anywhere;max-width:320px}#settings{max-height:50vh;overflow:auto;margin-top:8px}label{display:flex;justify-content:space-between;gap:8px;margin:5px 0}input[type=number]{width:55px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:3px;text-align:left}td:not(:first-child),th:not(:first-child){text-align:center}small{display:block;margin-top:6px;opacity:.8}</style><section><header><strong>Auto-Continue v0.1.10</strong><button id="start">Start</button><button id="stop" disabled>Stop</button><button id="toggle" aria-label="Settings">⚙</button></header><div id="status" role="status" aria-live="polite">Idle</div><div id="settings" hidden><label>Max automatic sends <input id="max" type="number" min="1" max="100"></label><label>Delay (seconds) <input id="delay" type="number" min="1" max="60"></label><label>Waiting retry (minutes) <input id="waitMinutes" type="number" min="1" max="60"></label><table><thead><tr><th>Event</th><th>Desktop</th><th>Sound</th></tr></thead><tbody id="events"></tbody></table><small>Settings apply to the next run. Stop conditions always apply, even with alerts disabled.</small></div></section>';
  const el=id=>shadow.getElementById(id);
  document.body.append(host);
  const render=(msg)=>{el('status').textContent=msg;el('start').disabled=!!run||acquiring;el('stop').disabled=!run&&!acquiring;};
  const save=()=>{try{GM_setValue('auto-continue-settings-v1',cfg);}catch{render('Settings could not be saved; current tab only.');}};
  for(const key of ['max','delay','waitMinutes']){
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
  function resolveResponseBody(u,a,follows,shared,turnSelector){
    if(!u.marker||!a.marker||!a.wrapper)return null;
    const bodies=[...(a.wrapper.matches('[data-response-body]')?[a.wrapper]:[]),
      ...a.wrapper.querySelectorAll('[data-response-body]')];
    const eligible=bodies.filter(b=>
      b.closest(turnSelector)===a.wrapper.closest(turnSelector)&&
      follows(u.marker,b)&&
      !b.querySelector('[data-message-author-role="user"],[data-turn="user"],[data-conversation-role="user"]')&&
      (b.contains(a.marker)||a.marker.contains(b)||follows(a.marker,b)||b.querySelector('[data-dil-response]')));
    // Refuse to fall back to the role anchor if a modern body exists
    // but its ownership is ambiguous.
    if(bodies.length)return eligible.at(-1)||null;
    return shared?a.marker:a.wrapper;
  }
  function turns(){
    const main=document.querySelector('main');
    const turnSelector='[data-testid^="conversation-turn"],[data-turn-key]';
    const roleSelector=role=>'[data-message-author-role="'+role+'"],[data-turn="'+role+'"],[data-conversation-role="'+role+'"]'+(role==='assistant'?', [data-chatgpt-agent-turn-start]':'');
    function latest(role){
      const markers=Array.from(main?.querySelectorAll(roleSelector(role))||[]);
      const marker=markers.at(-1)||null;
      const wrapper=marker?.closest(turnSelector)||marker?.closest('article')||marker;
      const explicit=marker?.closest('[data-message-author-role="'+role+'"]')||marker;
      const id=explicit?.getAttribute('data-message-id')||marker?.getAttribute('data-message-id')||
        wrapper?.getAttribute('data-message-id')||wrapper?.getAttribute('data-turn-key')||
        wrapper?.getAttribute('data-testid')||null;
      return {marker:explicit,wrapper,id:wrapper&&id?role+':'+id:null};
    }
    const u=latest('user'),a=latest('assistant');
    // A conversation-turn wrapper may contain both roles. Compare their
    // actual role markers rather than collapsing both into that wrapper.
    const follows=(first,second)=>!!(first&&second&&first!==second&&
      !first.contains(second)&&!second.contains(first)&&
      (first.compareDocumentPosition(second)&Node.DOCUMENT_POSITION_FOLLOWING)&&
      !(first.compareDocumentPosition(second)&Node.DOCUMENT_POSITION_DISCONNECTED));
    const after=follows(u.marker,a.marker);
    const shared=!!(u.wrapper&&a.wrapper&&
      (u.wrapper===a.wrapper||u.wrapper.contains(a.wrapper)||a.wrapper.contains(u.wrapper)));
    // Current renderer places the response body beside the role anchor,
    // inside the same turn-key wrapper. Resolve that body structurally.
    const assistant=resolveResponseBody(u,a,follows,shared,turnSelector);
    return {user:u.marker,assistant,uid:u.id,aid:a.id,after,
      ordering:!u.marker||!a.marker?'role missing':shared?'shared wrapper':'separate wrappers'};
  }
  function freshPair(t,r){
    return !!(t.uid&&t.aid&&t.after&&t.uid!==r.priorUser&&t.aid!==r.priorAssistant);
  }
  function terminalEvidence(r,reason){
    return reason==='fresh-assistant-terminal-action'||
      (reason==='finished-viewed'&&(r.sawGeneration||r.sawSubmission));
  }
  function marker(assistant){
    const invalid=reason=>({status:null,milestone:false,reason});
    if(!assistant)return invalid('response body not resolved');
    const roots=Array.from(assistant.querySelectorAll('[data-dil-response]'));
    const selector='p[data-d-component="text"], .markdown p';
    const excluded='pre,code,blockquote,li,table,button,[contenteditable="true"]';
    const visible=p=>!p.closest('[hidden],[aria-hidden="true"]');
    const paragraphs=Array.from(assistant.querySelectorAll(selector))
      .filter(p=>!p.closest(excluded)&&visible(p));
    // For the observed renderer, the status is a direct final paragraph
    // of the last visible response root. Never search a previous turn.
    const root=roots.filter(visible).at(-1);
    const last=root?root.lastElementChild:paragraphs.at(-1);
    function plain(p){
      return !!p&&p.tagName==='P'&&Array.from(p.querySelectorAll('*')).every(
        el=>el.tagName==='SPAN'&&el.getAttribute('data-d-text-flow')==='run');
    }
    const detail='response roots '+roots.length+', paragraphs '+paragraphs.length;
    if(!last)return invalid('no final paragraph; '+detail);
    if(!plain(last)||!paragraphs.includes(last))return invalid('final block is not a plain status paragraph; '+detail);
    const status=parseStatus(last.textContent);
    if(!status)return invalid('final paragraph is not a status marker; '+detail);
    if(paragraphs.some(p=>p!==last&&plain(p)&&parseStatus(p.textContent)))return invalid('multiple terminal markers; '+detail);
    const prev=last.previousElementSibling;
    const milestone=!!(plain(prev)&&prev.textContent.trim()==='[[MILESTONE]]');
    return {status,milestone,reason:'recognized'};
  }
  function composer(){
    const editorSelector='[contenteditable="true"][data-composer-markdown],#prompt-textarea[contenteditable="true"],[data-testid="prompt-textarea"][contenteditable="true"],[contenteditable="true"][role="textbox"]';
    const editors=Array.from(document.querySelectorAll(editorSelector)).filter(e=>
      e.isContentEditable&&e.getClientRects().length&&e.closest('form'));
    if(editors.length!==1)return {error:'expected one visible composer editor; found '+editors.length};
    const input=editors[0],form=input.closest('form');
    // Match known explicit Send controls, never retry/regenerate, voice,
    // generic submit buttons or unlabeled buttons.
    const selector='button[data-testid="send-button"],button[data-testid="composer-submit-button"],button[aria-label="Send prompt" i],button[aria-label="Send message" i],button[aria-label="Send" i],button[title="Send prompt" i],button[title="Send message" i],button[title="Send" i]';
    const sends=Array.from(form.querySelectorAll(selector)).filter(e=>e.getClientRects().length);
    return {input,form,send:sends.length===1?sends[0]:null,sendCount:sends.length};
  }
  function attachmentProblem(c){
    if(c.form.querySelector('[data-testid*="attachment-preview"], [data-testid*="attachment-chip"], [data-testid*="file-preview"], [data-testid*="upload-progress"], [data-composer-attachment], [aria-busy="true"]'))return 'attachment or busy composer';
    if(Array.from(c.form.querySelectorAll('input[type="file"]')).some(e=>e.files?.length))return 'selected file';
    return null;
  }
  function enabledSend(c){
    return !!c.send&&!c.send.disabled&&c.send.getAttribute('aria-disabled')!=='true';
  }
  function emptyProblem(c){
    if(c.error)return c.error;
    if(c.input.textContent.trim())return 'editor contains a draft';
    if(c.input.querySelector('img, [contenteditable="false"]'))return 'editor contains non-text content';
    if(c.sendCount>1)return 'multiple visible Send controls';
    if(enabledSend(c))return 'Send already enabled on empty editor';
    return attachmentProblem(c);
  }
  function finish(event,detail){
    const r=run;
    run=null;acquiring=false;
    if(r){r.release?.();notify(event,detail,r.settings);}
    render((EVENTS[event]?.[0]||event)+': '+detail);
  }
  function begin(lockRoute,release){
    const t=turns(),s=phase();
    const d=document.documentElement.dataset;
    const restored=/^restored-/.test(d.chatSignalsReason||'');
    const active=!restored&&['generating','submitted','verifying'].includes(s);
    if(route()!==lockRoute||!['idle','finished','historical','generating','submitted','verifying'].includes(s)){
      release();acquiring=false;render('Cannot start: '+s+' (Signals phase: '+(d.chatSignalsState||'missing')+', reason: '+(d.chatSignalsReason||'missing')+').');return;
    }
    // Starting on an existing completed reply never grants automatic Send.
    // Start while generating, or manually submit the first continuation.
    run={route:lockRoute,release,settings:JSON.parse(JSON.stringify(cfg)),count:0,
      step:active?'active':'armed',
      sawGeneration:active&&s==='generating',sawSubmission:active&&s==='submitted',priorUser:t.uid,priorAssistant:t.aid,
      activeUser:active&&['generating','verifying'].includes(s)?t.uid:null,
      acceptExistingAssistant:active&&['generating','verifying'].includes(s)&&t.after,deadline:Date.now()+60*60*1000,
      completion:null,until:0,mismatchAt:0,expectedMarker:null,lastCountdown:null};
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
    if(s==='idle'&&reason==='manual-cancel'&&r.step!=='armed'){finish('stopped','Response manually cancelled.');return;}
    if(['armed','sent','active'].includes(r.step)){
      if(s==='submitted')r.sawSubmission=true;
      if(s==='generating')r.sawGeneration=true;
    }
    if(s==='historical'||/^restored-/.test(reason||'')){
      if(r.step!=='armed')finish('invalid','Historical Signals state cannot authorize continuation.');
      return;
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
      if(!t.after)problems.push('assistant not after user ('+t.ordering+')');
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
      if(now<r.until){
        if(r.step==='delay'&&r.expectedMarker==='WAITING'){
          const seconds=Math.ceil((r.until-now)/1000);
          if(seconds!==r.lastCountdown){
            r.lastCountdown=seconds;
            render('Waiting — retry in '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' — '+r.count+'/'+r.settings.max+' sends.');
          }
        }
        return;
      }
      const m=marker(t.assistant);
      if(!m.status){finish('invalid','Marker: '+m.reason+'.');return;}
      if(r.step==='settling'){
        if(m.milestone)notify('milestone','Milestone reported by the assistant.',r.settings);
        if(!['CONTINUE','WAITING'].includes(m.status)){finish(m.status,'Assistant reported '+m.status+'.');return;}
        if(r.count>=r.settings.max){finish('budget','Automatic send budget exhausted.');return;}
        r.expectedMarker=m.status;
        r.lastCountdown=null;
        r.step='delay';
        if(m.status==='WAITING'){
          r.until=now+r.settings.waitMinutes*60*1000;
          r.deadline=Math.max(r.deadline,r.until+60000);
          notify('WAITING','Retry scheduled in '+r.settings.waitMinutes+' minute(s).',r.settings);
          render('Waiting — retry in '+r.settings.waitMinutes+':00 — '+r.count+'/'+r.settings.max+' sends.');
        }else{
          notify('iteration','Response finished.',r.settings);
          r.until=now+r.settings.delay*1000;
          render('Continuing after delay — '+r.count+'/'+r.settings.max+' sends.');
        }
        return;
      }
      if(m.status!==r.expectedMarker){finish('invalid','Project marker changed during delay.');return;}
      const c=composer();
      const problem=emptyProblem(c);
      if(problem){finish('invalid','Composer: '+problem+'.');return;}
      r.step='inserting';r.priorUser=t.uid;r.priorAssistant=t.aid;r.activeUser=null;r.acceptExistingAssistant=false;r.sawGeneration=false;r.sawSubmission=false;r.freshnessSince=0;r.deadline=now+10000;
      busy=true;
      try{
        c.input.focus();
        if(document.activeElement!==c.input){finish('invalid','Composer could not receive focus.');return;}
        document.execCommand('insertText',false,'continue');
        if(c.input.textContent.trim()!=='continue'){
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
      if(s!=='finished'||t.uid!==r.priorUser||t.aid!==r.priorAssistant||marker(t.assistant).status!==r.expectedMarker||c.error||c.input.textContent.trim()!=='continue'||attachmentProblem(c)||c.sendCount>1){
        finish('invalid','Send: '+(c.error||'composer or response changed; draft left untouched')+'.');return;
      }
      if(!enabledSend(c)){
        if(now<r.deadline-500)return;
        finish('invalid','Send: '+(c.sendCount===0?'no explicit Send control found':'Send stayed disabled')+'; draft left untouched.');return;
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
  function protectsComposer(step){
    return ['settling','delay','inserting'].includes(step);
  }
  function manualGesture(e,r,scriptBusy,c){
    // During the initial manual submission and while waiting for a reply,
    // the script does not own the composer. A keydown can arrive after
    // Signals changes to submitted/generating; do not cancel that turn.
    // The active turn ID and exact draft checks still gate any future Send.
    if(!r||scriptBusy||!e.isTrusted||!protectsComposer(r.step)||!c?.form?.contains(e.target))return false;
    if(e.type==='keydown'&&['Shift','Control','Alt','Meta','CapsLock','NumLock'].includes(e.key))return false;
    return ['pointerdown','keydown','paste','drop','compositionstart'].includes(e.type);
  }
  for(const type of ['pointerdown','keydown','paste','drop','compositionstart']){
    document.addEventListener(type,e=>{
      if(!run||busy||!e.isTrusted||!protectsComposer(run.step))return;
      if(manualGesture(e,run,busy,composer()))finish('invalid','Manual composer gesture ('+e.type+', '+run.step+'); stopped to protect your draft.');
    },true);
  }
  window.addEventListener('pagehide',()=>{requestToken++;if(run)finish('stopped','Page closed or navigated.');observer.disconnect();clearInterval(timer);},{once:true});
})();
