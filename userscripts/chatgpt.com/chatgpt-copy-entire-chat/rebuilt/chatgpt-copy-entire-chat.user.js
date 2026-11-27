// ==UserScript==
// @name         ChatGPT Copy Entire Chat (Firefox)
// @namespace    https://github.com/sguzman/firefox-scripts
// @version      1.0.0
// @description  Explicitly copy a complete ChatGPT conversation from proven server history.
// @match        https://chatgpt.com/c/*
// @match        https://chatgpt.com/g/*/c/*
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  // Nothing runs until the menu command is explicitly invoked. API retrieval
  // is sequential and bounded. Unproven/incomplete history is NEVER copied.
  const LIMITS = Object.freeze({
    pages: 200, messages: 20000, textChars: 12000000,
    requestMs: 16000, retries: 2, pageDelayMs: 150
  });
  const HIDDEN = new Set(['thoughts','reasoning','reasoning_recap',
    'model_editable_context','user_editable_context']);
  let running = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function conversationId() {
    return location.pathname.match(/(?:^|\/)c\/([0-9a-f]{8}-[0-9a-f-]{27,})\/?$/i)?.[1] || null;
  }
  function status(message, isError = false) {
    let el = document.getElementById('fx-copy-all-status');
    if (!el) {
      el = document.createElement('output');
      el.id = 'fx-copy-all-status';
      el.setAttribute('role','status');
      Object.assign(el.style, {position:'fixed',bottom:'18px',right:'18px',zIndex:'2147483000',
        padding:'10px 14px',maxWidth:'420px',whiteSpace:'pre-wrap',borderRadius:'8px',
        background:'Canvas',color:'CanvasText',border:'1px solid currentColor',
        font:'13px system-ui',pointerEvents:'none'});
      document.body?.append(el);
    }
    el.textContent=message;
    el.style.color = isError ? '#bd3f37' : 'CanvasText';
    return el;
  }
  async function jsonRequest(path, headers, label, accept404=false) {
    let last;
    for(let attempt=0;attempt<=LIMITS.retries;attempt++) {
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),LIMITS.requestMs);
      try {
        const response=await fetch(path,{
          method:'GET',credentials:'include',headers,signal:controller.signal
        });
        if(accept404 && response.status===404) return null;
        if(response.ok) return await response.json();
        if(![408,425,429].includes(response.status) && response.status<500)
          throw new Error(label+': HTTP '+response.status);
        last=new Error(label+': HTTP '+response.status);
        const raw=response.headers.get('retry-after');
        const retry=raw && (/^\d+$/.test(raw) ? Number(raw)*1000 : Date.parse(raw)-Date.now());
        if(attempt<LIMITS.retries) await sleep(Math.min(5000,Math.max(300,
          Number.isFinite(retry) ? retry : 500*(2**attempt))));
      } catch(error) {
        last=error;
        if(error?.message?.startsWith(label+': HTTP ') &&
            !/HTTP (?:408|425|429|5\d\d)/.test(error.message)) throw error;
        if(attempt<LIMITS.retries) await sleep(500*(2**attempt));
      } finally {clearTimeout(timeout);}
    }
    throw last || new Error(label+': request unsuccessful');
  }
  function visibleMessage(message) {
    if(!message || !['user','assistant'].includes(message.author?.role) ||
      message.weight===0 || message.metadata?.is_visually_hidden ||
      message.metadata?.is_visually_hidden_from_conversation) return null;
    if(message.author.role==='assistant' &&
      message.recipient && !['all','assistant'].includes(message.recipient)) return null;
    const content=message.content||{};
    if(HIDDEN.has(content.content_type||content.type)) return null;
    const parts=Array.isArray(content.parts) ? content.parts : [content.text];
    const text=parts.map(part=>{
      if(typeof part==='string') return part;
      if(part?.content_type==='image_asset_pointer') return '[Image]';
      if(['file_asset_pointer','file'].includes(part?.content_type))
        return '[File: '+(part.name||part.filename||'file')+']';
      return typeof part?.text==='string'?part.text:'';
    }).filter(Boolean);
    for(const item of message.metadata?.attachments||[]) {
      const name=item.name||item.file_name||item.filename||item.display_name;
      if(name) text.unshift('[Attachment: '+name+']');
    }
    const joined=text.join('\n\n').trim();
    return joined?{role:message.author.role==='user'?'USER':'ASSISTANT',
      text:joined}:null;
  }
  function mappingToMessages(data) {
    if(!data?.mapping || !data.current_node)
      throw new Error('Mapping does not expose a complete current branch');
    const seen=new Set(), backwards=[];
    let nodeId=data.current_node;
    while(nodeId!=null) {
      if(seen.has(nodeId)||seen.size>=LIMITS.messages)
        throw new Error('Mapping cycle or message limit');
      seen.add(nodeId);
      const node=data.mapping[nodeId];
      if(!node) throw new Error('Mapping parent missing: incomplete conversation');
      if(node.message) backwards.push(node.message);
      nodeId=node.parent;
    }
    return backwards.reverse();
  }
  async function readHistory(id) {
    status('Reading server history…');
    const session=await jsonRequest('/api/auth/session',
      {Accept:'application/json'},'Session');
    const token=session?.accessToken || session?.access_token;
    if(typeof token!=='string'||!token)
      throw new Error('ChatGPT session token unavailable; nothing copied');
    const headers={Accept:'application/json',Authorization:'Bearer '+token};
    const base='/backend-api/conversations/'+encodeURIComponent(id)
      +'?include_has_versions=true&num_turns=100';
    let page=await jsonRequest(base,headers,'Conversation',true);
    if(page===null) {
      const legacy=await jsonRequest('/backend-api/conversation/'+encodeURIComponent(id),
        headers,'Legacy conversation');
      return {messages:mappingToMessages(legacy),title:legacy.title||''};
    }
    if(!Array.isArray(page.messages)) {
      return {messages:mappingToMessages(page),title:page.title||''};
    }
    const title=page.title||'';
    let messages=page.messages.slice(),pages=1;
    let info=page.page_info;
    if(typeof info?.has_previous_page!=='boolean')
      throw new Error('Pagination proof unavailable; nothing copied');
    const seenIds=new Set(messages.map(m=>m?.id).filter(Boolean));
    const cursors=new Set();
    while(info.has_previous_page) {
      if(pages>=LIMITS.pages||messages.length>=LIMITS.messages)
        throw new Error('History exceeds a bounded export limit');
      const cursor=info.start_cursor;
      if(!cursor || cursors.has(cursor))
        throw new Error('Pagination cursor missing or repeated; nothing copied');
      cursors.add(cursor);
      status('Loading earlier history… page '+(pages+1));
      await sleep(LIMITS.pageDelayMs);
      page=await jsonRequest(base+'&before='+encodeURIComponent(cursor),
        headers,'Older conversation page');
      if(!Array.isArray(page.messages)||!page.messages.length||
        typeof page.page_info?.has_previous_page!=='boolean')
        throw new Error('Older history page is malformed; nothing copied');
      const older=page.messages.filter(m=>!m?.id || !seenIds.has(m.id));
      for(const m of older) if(m?.id) seenIds.add(m.id);
      if(!older.length) throw new Error('No pagination progress; nothing copied');
      messages=older.concat(messages);
      info=page.page_info;
      pages++;
    }
    if(info.has_previous_page!==false)
      throw new Error('Cannot prove start of history');
    return {messages,title};
  }
  async function copyEntireChat() {
    if(running) return;
    const id=conversationId(),initialPath=location.pathname;
    if(!id) {status('Open a ChatGPT conversation first.',true);return;}
    running=true;
    try {
      const result=await readHistory(id);
      if(location.pathname!==initialPath)
        throw new Error('Conversation changed during export');
      const entries=result.messages.map(visibleMessage).filter(Boolean);
      if(!entries.length) throw new Error('No visible conversation turns found');
      const title=(result.title||document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i,'')).trim();
      let transcript=title+'\nSource: '+location.href+'\n\n';
      for(const item of entries) {
        transcript+=item.role+'\n'+item.text+'\n\n';
        if(transcript.length>LIMITS.textChars)
          throw new Error('Transcript exceeds safe clipboard limit');
      }
      if(typeof GM_setClipboard!=='function')
        throw new Error('Userscript manager lacks GM_setClipboard');
      GM_setClipboard(transcript.trimEnd(),'text');
      status('Copied '+entries.length+' complete server-history turns.');
    } catch(error) {
      status('Export failed; no partial transcript copied.\n'+
        (error instanceof Error?error.message:'Unknown error'),true);
    } finally {running=false;}
  }
  if(typeof GM_registerMenuCommand==='function')
    GM_registerMenuCommand('Copy entire current ChatGPT chat',copyEntireChat);
})();
