// ==UserScript==
// @name         ChatGPT Current Message Jump (Firefox)
// @namespace    https://github.com/sguzman/firefox-scripts
// @version      1.0.1
// @description  Navigate mounted conversation turns with visible high-contrast controls.
// @match        https://chatgpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if(window.__fxCurrentMessageJump) return;
  const LIMIT=Object.freeze({tailNodes:1800,turns:240,size:38,gap:8});
  const TURN='[data-testid^="conversation-turn-"],[data-turn-key],[data-turn="assistant"],[data-turn="user"]';
  const MARKER='[data-message-author-role="assistant"],[data-message-author-role="user"]';
  let main=null,turns=[],frame=0,disposed=false,current=null;
  const style=document.createElement('style');
  style.textContent=[
    '#fx-current-message-jump button{box-sizing:border-box!important;width:38px!important;height:38px!important;',
    'border-radius:10px!important;background:#1b2028!important;color:#f9fafb!important;',
    'border:1px solid #06080c!important;box-shadow:0 2px 9px #0006!important;',
    'font:bold 23px/1 system-ui!important;cursor:pointer!important;pointer-events:auto!important;',
    'opacity:1!important;visibility:visible!important}',
    '#fx-current-message-jump button:focus-visible{outline:3px solid #3b82f6!important;outline-offset:2px}',
    '#fx-current-message-jump button:hover{filter:brightness(1.18)}',
    '@media(prefers-color-scheme:dark){#fx-current-message-jump button{',
    'background:#f8fafc!important;color:#111827!important;',
    'border-color:#cbd5e1!important;box-shadow:0 2px 10px #0007!important}}'
  ].join('');
  document.head?.append(style);
  const overlay=document.createElement('nav');
  overlay.id='fx-current-message-jump';
  overlay.setAttribute('aria-label','ChatGPT conversation navigation');
  Object.assign(overlay.style,{position:'fixed',zIndex:'2147482000',
    display:'none',flexDirection:'column',gap:LIMIT.gap+'px',pointerEvents:'none'});
  function addButton(label,title){
    const b=document.createElement('button');
    b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);
    overlay.append(b);return b;
  }
  const up=addButton('↑','Jump to previous or start of current message');
  const down=addButton('↓','Jump to next or end of current message');
  document.body?.append(overlay);
  const getMain=()=>document.querySelector('main,[role="main"]');
  function rebuild(){
    const found=getMain();
    if(!found){main=null;turns=[];return;}
    main=found;
    const reversed=[],seen=new Set();
    let node=main.lastElementChild,walked=0;
    while(node && walked++<LIMIT.tailNodes && reversed.length<LIMIT.turns){
      let turn=null;
      if(node.matches?.(TURN))turn=node;
      else if(node.matches?.(MARKER))turn=node.closest?.(TURN+',article')||node;
      if(turn && !seen.has(turn) && turn.isConnected){
        seen.add(turn);reversed.push(turn);
      }
      if(node.lastElementChild){node=node.lastElementChild;continue;}
      while(node && node!==main && !node.previousElementSibling)node=node.parentElement;
      if(!node || node===main)break;
      node=node.previousElementSibling;
    }
    turns=reversed.reverse().filter((turn,index,all)=>
      !all.some((other,i)=>i!==index && other.contains(turn)));
  }
  function role(turn){
    const marker=turn.matches?.(MARKER)?turn:turn.querySelector?.(MARKER);
    return marker?.getAttribute('data-message-author-role')||
      turn.getAttribute('data-turn')||'';
  }
  function viewport(){
    const prompt=document.querySelector('#prompt-textarea,[data-testid="prompt-textarea"]');
    const top=8;
    const composer=prompt?.closest?.('form')||prompt;
    const bottom=Math.min(innerHeight-8,composer?.getBoundingClientRect()?.top ?? innerHeight-8);
    return {top,bottom:bottom>top+110?bottom:innerHeight-8};
  }
  function choose(){
    const {top,bottom}=viewport(),mid=(top+bottom)/2;
    let chosen=null,score=-Infinity;
    for(let i=0;i<turns.length;i++){
      const turn=turns[i],r=turn.getBoundingClientRect();
      if(r.height<1 || r.bottom<=top || r.top>=bottom)continue;
      const overlap=Math.min(r.bottom,bottom)-Math.max(r.top,top);
      const nextScore=overlap+(r.top<=mid && r.bottom>=mid?3000:0)+
        (role(turn)==='assistant'?50:0);
      if(nextScore>score){score=nextScore;chosen={turn,index:i,rect:r,top,bottom};}
    }
    return chosen;
  }
  function blocked(x,y){
    const element=document.elementFromPoint(x,y);
    return Boolean(element && element.closest?.(
      'button,a,input,textarea,[role="dialog"],[role="menu"],[contenteditable="true"]'
    ) && !overlay.contains(element));
  }
  function place(height){
    const rect=main?.getBoundingClientRect();
    const xs=[
      innerWidth-LIMIT.size-12,
      rect && rect.right+8,
      12,
      rect && rect.left-LIMIT.size-8
    ].filter(Number.isFinite);
    const {top,bottom}=viewport();
    const y=Math.max(top+8,Math.min(bottom-height-8,(top+bottom-height)/2));
    if(y+height>bottom)return null;
    for(const x of xs){
      if(x<4 || x+LIMIT.size>innerWidth-4)continue;
      if(!blocked(x+LIMIT.size/2,y+LIMIT.size/2) &&
         !blocked(x+LIMIT.size/2,y+height-LIMIT.size/2))
        return {x,y};
    }
    return null;
  }
  function paint(){
    frame=0;if(disposed)return;
    if(!main?.isConnected)rebuild();
    const selected=choose();
    if(!selected){overlay.style.display='none';current=null;return;}
    current=selected;
    const hasPrev=selected.index>0 || selected.rect.top<selected.top-10;
    const hasNext=selected.index<turns.length-1 || selected.rect.bottom>selected.bottom+10;
    up.hidden=!hasPrev;
    down.hidden=!hasNext;
    if(!hasPrev&&!hasNext){overlay.style.display='none';return;}
    const height=(hasPrev?LIMIT.size:0)+(hasNext?LIMIT.size:0)+
      (hasPrev&&hasNext?LIMIT.gap:0);
    const xy=place(height);
    if(!xy){overlay.style.display='none';return;}
    overlay.style.left=Math.round(xy.x)+'px';
    overlay.style.top=Math.round(xy.y)+'px';
    overlay.style.display='flex';
  }
  function schedule(){if(!frame&&!disposed)frame=requestAnimationFrame(paint);}
  function jump(direction){
    if(!current)return;
    const i=turns.indexOf(current.turn);
    if(i<0)return;
    const r=current.turn.getBoundingClientRect(),area=viewport();
    let target=current.turn,edge='start';
    if(direction==='up'){
      if(r.top>=area.top-24 && i>0)target=turns[i-1];
    }else{
      if(r.bottom<=area.bottom+24 && i+1<turns.length){
        target=turns[i+1];edge='start';
      }else edge='end';
    }
    target.scrollIntoView({block:edge,behavior:'instant'});
    schedule();
  }
  up.addEventListener('click',()=>jump('up'));
  down.addEventListener('click',()=>jump('down'));
  function relevant(records){
    let inspected=0;
    for(const record of records){
      for(const node of record.addedNodes){
        if(++inspected>48)return false;
        if(node.nodeType!==1)continue;
        if(node.matches?.('main,[role="main"],'+TURN+','+MARKER) ||
          (node.childElementCount>0 && node.querySelector?.('main,'+TURN+','+MARKER)))
          return true;
      }
      for(const node of record.removedNodes){
        if(++inspected>48)return false;
        if(node===main || turns.includes(node))return true;
      }
    }
    return false;
  }
  const observer=new MutationObserver(records=>{
    if(relevant(records)){rebuild();schedule();}
  });
  observer.observe(document.body,{childList:true,subtree:true});
  const onNavigation=()=>{rebuild();schedule();};
  window.addEventListener('scroll',schedule,{passive:true,capture:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('popstate',onNavigation);
  function dispose(){
    disposed=true;observer.disconnect();if(frame)cancelAnimationFrame(frame);
    window.removeEventListener('scroll',schedule,true);
    window.removeEventListener('resize',schedule);
    window.removeEventListener('popstate',onNavigation);
    style.remove();overlay.remove();delete window.__fxCurrentMessageJump;
  }
  window.addEventListener('pagehide',dispose,{once:true});
  window.__fxCurrentMessageJump={dispose};
  rebuild();schedule();
})();