// ==UserScript==
// @name         ChatGPT Sticky Copy (Firefox)
// @namespace    https://github.com/sguzman/firefox-scripts
// @version      1.0.1
// @description  Provide a safe copy control on long visible code and writing blocks.
// @match        https://chatgpt.com/c/*
// @match        https://chatgpt.com/g/*/c/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  if(window.__fxStickyCopy) return;
  const BLOCK='pre,[data-testid="writing-block-container"]';
  const COPIES='button[data-testid*="copy" i],button[aria-label="Copy" i],button[title="Copy" i]';
  const PROMPT='#prompt-textarea,[data-testid="prompt-textarea"]';
  let main=document.querySelector('main'),raf=0,disposed=false,busy=false;
  if(!main)return;
  // Only one floating control exists, regardless of the number of blocks.
  const style=document.createElement('style');
  style.textContent=[
    '#fx-sticky-copy-button{background:#1b2028!important;color:#f9fafb!important;',
    'border:1px solid #06080c!important;box-shadow:0 2px 8px #0006!important;',
    'opacity:1!important;visibility:visible!important;font:600 13px system-ui!important}',
    '@media(prefers-color-scheme:dark){#fx-sticky-copy-button{',
    'background:#f8fafc!important;color:#111827!important;',
    'border-color:#cbd5e1!important;box-shadow:0 2px 10px #0007!important}}'
  ].join('');
  document.head?.append(style);
  const button=document.createElement('button');
  button.type='button';button.id='fx-sticky-copy-button';button.textContent='Copy';
  button.title='Copy the current block';button.setAttribute('aria-label','Copy current code or writing block');
  Object.assign(button.style,{position:'fixed',zIndex:'2147482000',
    display:'none',width:'66px',height:'32px',
    borderRadius:'8px',cursor:'pointer'});
  document.body.append(button);
  const blocks=new Set();
  function scanAdded(nodes) {
    let count=0;
    for(const node of nodes) {
      if(++count>24)break;
      if(node.nodeType!==1)continue;
      if(node.matches?.(BLOCK))blocks.add(node);
      // Only inspect a small number of matching nodes in an inserted
      // subtree. Never rescan the whole long conversation.
      for(const child of Array.from(node.querySelectorAll?.(BLOCK)||[]).slice(0,32))
        blocks.add(child);
    }
    if(blocks.size>300) {
      for(const block of blocks) {
        if(!block.isConnected)blocks.delete(block);
        if(blocks.size<=240)break;
      }
    }
  }
  // One initialization query, never repeated on scroll.
  for(const block of Array.from(main.querySelectorAll(BLOCK)).slice(-200))
    blocks.add(block);
  function nativeCopy(block) {
    const owner=block.matches?.('pre')?
      block.closest?.('[data-testid*="code"],[class*="code-block"],div.group')||block.parentElement:
      block;
    const controls=owner?.querySelectorAll?.(COPIES)||[];
    return Array.from(controls).find(b=>{
      const label=(b.getAttribute('aria-label')||b.title||b.textContent||'').trim();
      return /^copy(?: code| block)?$/i.test(label) && !b.disabled;
    })||null;
  }
  function visible(el) {
    const rect=el?.getBoundingClientRect();
    return rect && rect.width>0 && rect.height>0 &&
      rect.bottom>0&&rect.top<innerHeight;
  }
  function composerTop() {
    const prompt=document.querySelector(PROMPT);
    if(!prompt||!visible(prompt))return innerHeight-12;
    const rect=(prompt.closest?.('form')||prompt).getBoundingClientRect();
    return Math.max(0,rect.top-12);
  }
  let target=null;
  function paint() {
    raf=0;if(disposed)return;
    if(!main.isConnected){button.style.display='none';return;}
    const bottom=composerTop();
    let choice=null,area=0;
    for(const block of blocks) {
      if(!block.isConnected){blocks.delete(block);continue;}
      const rect=block.getBoundingClientRect();
      if(rect.width<220||rect.height<120||rect.bottom<=48||rect.top>=bottom)continue;
      const visibleTop=Math.max(rect.top,24),visibleBottom=Math.min(rect.bottom,bottom);
      const available=visibleBottom-visibleTop;
      if(available<75)continue;
      const writing=block.matches?.('[data-testid="writing-block-container"]');
      const copy=nativeCopy(block);
      // If native copy is visible on ordinary code, leave it alone. Writing
      // blocks may have a sticky native header: show proxy when top passed.
      if(!writing && copy && visible(copy))continue;
      if(writing && rect.top>=-20)continue;
      const score=available-Math.abs(rect.left+rect.width/2-innerWidth/2)*0.01;
      if(score>area){area=score;choice={block,copy,rect,visibleTop,visibleBottom};}
    }
    if(!choice){target=null;button.style.display='none';return;}
    const left=Math.min(innerWidth-75,Math.max(6,choice.rect.right-78));
    const top=choice.visibleBottom-45;
    if(top<choice.visibleTop+12||top+32>=bottom) {
      target=null;button.style.display='none';return;
    }
    // Never cover an existing interactive element, the composer or another
    // script's navigation control.
    const underlying=document.elementFromPoint(left+33,top+16);
    if(underlying && !choice.block.contains(underlying) &&
      !choice.block.parentElement?.contains(underlying)) {
      target=null;button.style.display='none';return;
    }
    target=choice;button.style.left=Math.round(left)+'px';
    button.style.top=Math.round(top)+'px';button.style.display='block';
  }
  function schedule() {if(!raf&&!disposed)raf=requestAnimationFrame(paint);}
  button.addEventListener('click',async()=>{
    if(!target||busy)return;
    busy=true;button.disabled=true;
    try {
      const native=target.copy?.isConnected?target.copy:nativeCopy(target.block);
      if(native)native.click();
      else {
        const text=target.block.matches('pre')?
          target.block.textContent:target.block.innerText;
        if(!text)throw new Error('Block contains no copyable text');
        if(text.length>2*1024*1024)throw new Error('Block exceeds 2 MiB copy limit');
        if(typeof GM_setClipboard!=='function')throw new Error('Clipboard grant unavailable');
        GM_setClipboard(text,'text');
      }
      button.textContent='Copied';
    } catch {button.textContent='Error';}
    finally {
      busy=false;button.disabled=false;
      setTimeout(()=>{if(button.isConnected)button.textContent='Copy';},1200);
    }
  });
  const observer=new MutationObserver(records=>{
    let changed=false;
    for(const record of records) {
      if(record.addedNodes?.length) {
        const before=blocks.size;
        scanAdded(record.addedNodes);
        if(blocks.size!==before)changed=true;
      }
      for(const n of record.removedNodes||[]) {
        if(blocks.has(n)){blocks.delete(n);changed=true;}
      }
    }
    // Streaming tokens are not a reason to run layout on every mutation.
    if(changed)schedule();
  });
  observer.observe(main,{childList:true,subtree:true});
  window.addEventListener('scroll',schedule,{passive:true,capture:true});
  window.addEventListener('resize',schedule,{passive:true});
  function dispose(){
    disposed=true;observer.disconnect();if(raf)cancelAnimationFrame(raf);
    window.removeEventListener('scroll',schedule,true);
    window.removeEventListener('resize',schedule);
    blocks.clear();button.remove();style.remove();delete window.__fxStickyCopy;
  }
  window.addEventListener('pagehide',dispose,{once:true});
  window.__fxStickyCopy={dispose};
  schedule();
})();
