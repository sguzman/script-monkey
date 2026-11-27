// ==UserScript==
// @name         Source Analysis ZIP (Firefox)
// @namespace    https://github.com/sguzman/firefox-scripts
// @version      1.0.2
// @description  Manually download current rendered DOM and accessible CSS, JS, source maps and WASM.
// @match        https://*/*
// @match        http://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  // Passive until a direct Tampermonkey menu click. No observers, hooks,
  // intervals, automatic downloads, network interception or remote libraries.
  // @connect * is needed for site-selected CDN hosts and redirect targets.
  const LIMIT = Object.freeze({
    resources: 120, totalBytes: 48 * 1024 * 1024,
    singleBytes: 8 * 1024 * 1024, timeoutMs: 9000,
    workers: 2, depth: 2, domChars: 8 * 1024 * 1024,
    referenceCount: 800, scanEntries: 1800
  });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let busy = false;
  const web = /^https?:$/;
  const codeExt = /\.(?:css|[cm]?js|jsx?|tsx?|wasm|map)(?:$|[?#])/i;
  const imageExt = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp[34]|webm|ogg|pdf)(?:$|[?#])/i;
  function urlOf(input,base) {
    if(!input || /^(?:data:|blob:|javascript:|#)/i.test(input.trim())) return null;
    try {
      const u=new URL(input.trim(),base);
      if(!web.test(u.protocol)) return null;
      u.hash='';
      return u.href;
    } catch {return null;}
  }
  const safeText = value=>String(value).replace(/[\r\n\t]+/g,' ').slice(0,180);
  function kindFrom(url) {
    const pathname=new URL(url).pathname.toLowerCase();
    if(/\.css$/.test(pathname))return 'css';
    if(/\.(?:[cm]?js|jsx?|tsx?)$/.test(pathname))return 'javascript';
    if(/\.wasm$/.test(pathname))return 'wasm';
    if(/\.map$/.test(pathname))return 'source-map';
    return null;
  }
  function archiveName(url,id,kind) {
    const fallback={javascript:'script.js',css:'style.css',wasm:'module.wasm','source-map':'source.map'}[kind];
    let name;
    try{name=decodeURIComponent(new URL(url).pathname.split('/').pop()||'')}catch{}
    name=(name||fallback).replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,65);
    if(!name || name==='.' || name==='..')name=fallback;
    if(!/\.(?:css|[cm]?js|jsx?|tsx?|map|wasm)$/i.test(name))name+='.'+(kind==='javascript'?'js':kind==='css'?'css':kind==='wasm'?'wasm':'map');
    return 'code/'+String(id).padStart(4,'0')+'-'+name;
  }
  function collect() {
    const dom='<!DOCTYPE html>\n'+document.documentElement.outerHTML;
    if(dom.length>LIMIT.domChars) throw Error('Rendered DOM exceeds 8-million-character limit');
    const assets=new Map(),references=[],omitted=[];
    const refSeen=new Set(), base=document.baseURI;
    function reference(value,parent,kind,reason) {
      const url=urlOf(value,parent);
      if(!url || refSeen.has(url) || references.length>=LIMIT.referenceCount)return;
      refSeen.add(url);references.push({url,kind,reason});
    }
    function enqueue(value,parent,kind,depth=0,source='dom') {
      const url=urlOf(value,parent);
      if(!url)return;
      const actualKind=kind||kindFrom(url);
      if(!actualKind)return;
      if(depth>LIMIT.depth){reference(url,parent,actualKind,'dependency-depth-limit');return;}
      if(!assets.has(url)){
        if(assets.size>=LIMIT.resources){
          if(omitted.length<200)omitted.push({url,reason:'asset-count-limit'});
          return;
        }
        assets.set(url,{
          url,kind:actualKind,depth,source,path:archiveName(url,assets.size+1,actualKind),
          status:'queued',bytes:null,mime:null,finalUrl:null
        });
      }
    }
    // A single user-triggered scan, with a bounded number of candidate nodes.
    const nodes=document.querySelectorAll('script[src],link[href]');
    for(let i=0;i<Math.min(nodes.length,LIMIT.scanEntries);i++){
      const el=nodes[i];
      if(el.localName==='script'){
        enqueue(el.getAttribute('src'),base,'javascript',0,'script-element');
        continue;
      }
      const rel=(el.getAttribute('rel')||'').toLowerCase();
      const as=(el.getAttribute('as')||'').toLowerCase();
      const type=(el.getAttribute('type')||'').toLowerCase();
      if(rel.includes('stylesheet')) enqueue(el.getAttribute('href'),base,'css',0,'stylesheet');
      else if(rel.includes('modulepreload')) enqueue(el.getAttribute('href'),base,'javascript',0,'modulepreload');
      else if(rel.includes('preload') && ['script','style','fetch'].includes(as)){
        const value=el.getAttribute('href');
        const kind=as==='script'?'javascript':as==='style'?'css':
          type.includes('wasm')?'wasm':kindFrom(urlOf(value,base)||base);
        enqueue(value,base,kind,0,'preload');
      }
    }
    if(nodes.length>LIMIT.scanEntries)omitted.push({reason:'dom-node-scan-limit',count:nodes.length-LIMIT.scanEntries});
    // Resource timing reveals late-loaded hashed chunks. Never replay
    // XHR/API requests or arbitrary JSON endpoints.
    const entries=performance.getEntriesByType('resource').slice(-LIMIT.scanEntries);
    for(const entry of entries){
      const u=urlOf(entry.name,base);
      if(!u)continue;
      const kind=kindFrom(u);
      if(kind && codeExt.test(u))enqueue(u,base,kind,0,'resource-timing');
      else if(imageExt.test(u))reference(u,base,'binary','not-downloaded');
    }
    // Record binary links for Viewsource, without transferring the files.
    const visual=document.querySelectorAll('img[src],source[src],video[src],audio[src],video[poster],link[rel~="icon"],link[rel~="preload"][as="font"]');
    for(let i=0;i<Math.min(visual.length,LIMIT.scanEntries);i++){
      const el=visual[i];
      const value=el.getAttribute('src')||el.getAttribute('poster')||el.getAttribute('href');
      reference(value,base,'binary','not-downloaded');
    }
    // Reject suspicious pseudo-imports from minified code, regex literals,
    // or documentation strings. Only URL-like paths are request candidates.
    const validCodeSpecifier=value=>typeof value==='string' &&
      value.length>0 && value.length<512 &&
      !/[\s"'<>()[\]{};\\|^$]/.test(value) &&
      /^(?:https?:\/\/|\/|\.\.?\/)/i.test(value);
    const discover=(text,origin,kind,depth)=>{
      if(kind==='css'){
        const imports=/@import\s+(?:url\(\s*)?['"]([^'")]+)['"]/gi;
        let m,count=0;
        while((m=imports.exec(text)) && ++count<=180)
          enqueue(m[1],origin,'css',depth+1,'css-import');
        const urls=/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
        count=0;
        while((m=urls.exec(text)) && ++count<=240){
          const u=urlOf(m[1],origin);
          if(u && kindFrom(u))enqueue(u,origin,null,depth+1,'css-url');
          else reference(m[1],origin,'binary','css-reference-only');
        }
      }
      if(kind==='javascript'){
        const imp=/(?:\bimport\s*(?:[^'"]{0,180}?\sfrom\s*)?|\bexport\s+[^'"]{0,180}?\sfrom\s*|\bimport\s*\(|\bnew\s+(?:Shared)?Worker\s*\()\s*['"]([^'"]+)['"]/g;
        let m,count=0;
        while((m=imp.exec(text)) && ++count<=180) {
          if(validCodeSpecifier(m[1]))
            enqueue(m[1],origin,'javascript',depth+1,'js-module-import');
        }
        const wasm=/['"]([^'"]+\.wasm(?:\?[^'"]*)?)['"]/gi;
        count=0;
        while((m=wasm.exec(text)) && ++count<=80) {
          if(validCodeSpecifier(m[1]))
            enqueue(m[1],origin,'wasm',depth+1,'js-wasm-reference');
        }
      }
      if(kind==='css' || kind==='javascript'){
        const maps=/[#@]\s*sourceMappingURL\s*=\s*([^\s*]+)/g;
        let m,count=0;
        while((m=maps.exec(text)) && ++count<=20)
          enqueue(m[1],origin,'source-map',depth+1,'source-map-comment');
      }
    };
    // Discovery from inline scripts/styles, bounded by DOM size and
    // existing user-triggered scan; do not execute any of the code.
    const inline=document.querySelectorAll('script[type="module"]:not([src]),style');
    for(let i=0;i<Math.min(inline.length,300);i++){
      const el=inline[i],body=el.textContent||'';
      if(body.length>200*1024)continue;
      discover(body,base,el.localName==='style'?'css':'javascript',0);
    }
    return {dom,assets,references,omitted,discover};
  }
  function createProgress(cancel) {
    const box=document.createElement('aside'),message=document.createElement('span');
    box.id='fx-source-analysis-status';
    Object.assign(box.style,{position:'fixed',bottom:'16px',right:'16px',zIndex:'2147483645',
      padding:'10px 12px',border:'1px solid GrayText',borderRadius:'8px',
      background:'Canvas',color:'CanvasText',font:'13px system-ui',
      boxShadow:'0 2px 12px #0005',maxWidth:'390px'});
    const theme=document.createElement('style');
    theme.textContent=[
      '#fx-source-analysis-status{background:#1b2028!important;color:#f9fafb!important;',
      'border-color:#06080c!important;box-shadow:0 2px 12px #0007!important}',
      '#fx-source-analysis-status button{background:#353c47!important;color:#f9fafb!important;',
      'border:1px solid #7b8795!important;border-radius:6px!important;',
      'font:600 12px system-ui!important}',
      '@media(prefers-color-scheme:dark){#fx-source-analysis-status{',
      'background:#f8fafc!important;color:#111827!important;',
      'border-color:#cbd5e1!important;box-shadow:0 2px 12px #0008!important}',
      '#fx-source-analysis-status button{background:#e2e8f0!important;',
      'color:#111827!important;border-color:#94a3b8!important}}'
    ].join('');
    box.append(theme);
    message.setAttribute('role','status');
    const button=document.createElement('button');
    button.type='button';button.textContent='Cancel';
    Object.assign(button.style,{marginLeft:'10px',cursor:'pointer'});
    button.addEventListener('click',()=>{button.disabled=true;cancel();message.textContent='Cancelling…';});
    box.append(message,button);
    document.body.append(box);
    return {message,button,box};
  }
  function get(url,track) {
    return new Promise((resolve,reject)=>{
      let settled=false,req=null;
      const finish=(err,value)=>{
        if(settled)return;
        settled=true;track.delete(req);
        if(err)reject(err);else resolve(value);
      };
      try{
        req=GM_xmlhttpRequest({
          method:'GET',url,responseType:'arraybuffer',timeout:LIMIT.timeoutMs,
          // Avoid sending session cookies to third-party CDNs where possible.
          onprogress:detail=>{
            if(detail.loaded>LIMIT.singleBytes) {
              try{req?.abort?.();}catch{}
              finish(Error('per-file-limit'));
            }
          },
          onload:r=>{
            if(r.status<200 || r.status>=300)return finish(Error('HTTP '+r.status));
            const bytes=r.response instanceof ArrayBuffer?new Uint8Array(r.response):
              ArrayBuffer.isView(r.response)?new Uint8Array(r.response.buffer,r.response.byteOffset,r.response.byteLength):
              null;
            if(!bytes)return finish(Error('binary-response-unavailable'));
            if(bytes.byteLength>LIMIT.singleBytes)return finish(Error('per-file-limit'));
            const mime=(/content-type:\s*([^\r\n;]+)/i.exec(r.responseHeaders||'')||[])[1]||'';
            // Reject HTML login/error pages disguised as source code.
            if(/text\/html/i.test(mime))return finish(Error('received-html-not-source'));
            finish(null,{bytes,finalUrl:r.finalUrl||url,mime});
          },
          onerror:()=>finish(Error('network-or-permission')),
          ontimeout:()=>finish(Error('timeout')),
          onabort:()=>finish(Error('aborted'))
        });
        if(!settled)track.add(req);
      }catch(err){finish(err);}
    });
  }
  // Minimal standard ZIP32 STORE encoder. No remote dependencies.
  const crcTable=Array.from({length:256},(_,n)=>{
    let c=n;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;
    return c>>>0;
  });
  function crc(bytes){
    let c=0xffffffff;
    for(let i=0;i<bytes.length;i++)c=(c>>>8)^crcTable[(c^bytes[i])&255];
    return (c^0xffffffff)>>>0;
  }
  function zip(entries){
    const chunks=[],central=[];
    let offset=0,centralSize=0;
    const u16=(v,o,n)=>v.setUint16(o,n,true);
    const u32=(v,o,n)=>v.setUint32(o,n,true);
    for(const [name,value] of entries){
      const label=encoder.encode(name);
      const bytes=typeof value==='string'?encoder.encode(value):value;
      const sig=crc(bytes),local=new Uint8Array(30+label.length);
      const h=new DataView(local.buffer);
      u32(h,0,0x04034b50);u16(h,4,20);u16(h,6,0x800);u16(h,8,0);
      u32(h,14,sig);u32(h,18,bytes.length);u32(h,22,bytes.length);
      u16(h,26,label.length);local.set(label,30);
      chunks.push(local,bytes);
      const dir=new Uint8Array(46+label.length),d=new DataView(dir.buffer);
      u32(d,0,0x02014b50);u16(d,4,20);u16(d,6,20);u16(d,8,0x800);
      u32(d,16,sig);u32(d,20,bytes.length);u32(d,24,bytes.length);
      u16(d,28,label.length);u32(d,42,offset);dir.set(label,46);
      central.push(dir);centralSize+=dir.length;offset+=local.length+bytes.length;
    }
    const tail=new Uint8Array(22),d=new DataView(tail.buffer);
    u32(d,0,0x06054b50);u16(d,8,central.length);u16(d,10,central.length);
    u32(d,12,centralSize);u32(d,16,offset);
    return new Blob([...chunks,...central,tail],{type:'application/zip'});
  }
  async function run() {
    if(busy)return;
    busy=true;
    const at=location.href,requests=new Set();
    let cancelled=false,view=null,downloadUrl=null;
    const cancel=()=>{cancelled=true;for(const req of requests)try{req?.abort?.();}catch{}};
    try{
      if(typeof GM_xmlhttpRequest!=='function')throw Error('Tampermonkey XHR permission unavailable');
      view=createProgress(cancel);
      view.message.textContent='Reading rendered DOM and code references…';
      const state=collect();
      const counters={attempted:0,captured:0,failed:0,bytes:0};
      let cursor=0;
      const queue=[...state.assets.values()];
      const next=()=> {
        while(cursor<queue.length){
          const item=queue[cursor++];
          if(item.status==='queued')return item;
        }
        return null;
      };
      const refresh=()=>{
        if(!view || cancelled)return;
        const mib=(counters.bytes/1048576).toFixed(1);
        view.message.textContent='Examined '+counters.attempted+'/'+queue.length+
          ' · Saved '+counters.captured+' · Failed '+counters.failed+' · '+mib+' MiB';
      };
      const work=async()=>{
        while(!cancelled){
          const item=next();
          if(!item)return;
          if(counters.bytes>=LIMIT.totalBytes){
            item.status='skipped';state.omitted.push({url:item.url,reason:'total-limit'});
            continue;
          }
          counters.attempted++;
          refresh();
          try{
            const result=await get(item.url,requests);
            if(cancelled)return;
            if(counters.bytes+result.bytes.length>LIMIT.totalBytes)throw Error('total-limit');
            item.status='captured';item.bytes=result.bytes;
            item.mime=result.mime;item.finalUrl=result.finalUrl;
            counters.bytes+=result.bytes.length;
            counters.captured++;
            // Discover additional module/CSS/source-map dependencies, bounded.
            if(item.depth<LIMIT.depth && item.kind!=='wasm' && item.kind!=='source-map'){
              state.discover(decoder.decode(result.bytes),result.finalUrl,item.kind,item.depth);
              for(const entry of state.assets.values())
                if(!queue.includes(entry))queue.push(entry);
            }
          }catch(err){
            item.status='missing';item.error=safeText(err?.message||err);
            counters.failed++;
          }
          refresh();
          if(counters.attempted%12===0)await new Promise(resolve=>setTimeout(resolve,0));
        }
      };
      await Promise.all(Array.from({length:LIMIT.workers},()=>work()));
      if(cancelled || at!==location.href)return;
      view.message.textContent='Building ZIP…';
      const captured=queue.filter(x=>x.status==='captured');
      const errors=queue.filter(x=>x.status!=='captured').map(x=>({
        url:x.url,kind:x.kind,reason:x.error||x.status
      }));
      const manifest={
        format:'firefox-source-analysis-v1',version:'1.0.2',
        url:at,title:document.title,capturedAt:new Date().toISOString(),
        budgets:LIMIT,summary:counters,
        captured:captured.map(x=>({
          url:x.url,finalUrl:x.finalUrl,kind:x.kind,path:x.path,
          mime:x.mime,bytes:x.bytes.length,origin:x.source
        })),
        failed:[...errors,...state.omitted],
        referencedOnly:state.references,
        caveats:[
          'The DOM is the current rendered document, not necessarily the original server response.',
          'Server-side source, protected cache, network POST responses and closed shadow roots are unavailable.',
          'Image/font/video/audio binaries were intentionally not downloaded.',
          'Source maps may not be deployed publicly and some CDN assets may require permission.',
          'The HTML is saved as text to avoid executing exported scripts.',
          'Archives may contain private page text and sensitive URLs; review before sharing.'
        ]
      };
      const entries=[
        ['rendered-dom.html.txt',state.dom],
        ['manifest.json',JSON.stringify(manifest,null,2)],
        ['README.txt','Source Analysis ZIP v1.0.2\n\n'+
          'rendered-dom.html.txt — current rendered HTML (non-executable)\n'+
          'code/ — available JS, CSS, WASM and source maps\n'+
          'manifest.json — sources, failures and binary URL references\n\n'+
          'This is client-side material only. Do not publish without privacy review.\n']
      ];
      for(const item of captured)entries.push([item.path,item.bytes]);
      const data=zip(entries);
      if(cancelled)return;
      downloadUrl=URL.createObjectURL(data);
      const link=document.createElement('a');
      link.href=downloadUrl;
      link.download='source-analysis-'+location.hostname.replace(/[^a-z0-9.-]/gi,'_')+
        '-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip';
      link.hidden=true;document.body.append(link);link.click();link.remove();
      view.message.textContent='ZIP requested: '+counters.captured+
        ' code assets, '+counters.failed+' failures, '+(counters.bytes/1048576).toFixed(1)+' MiB';
      view.button.disabled=true;
    }catch(err){
      if(view)view.message.textContent='Source analysis failed: '+safeText(err?.message||err);
    }finally{
      busy=false;
      if(view){view.button.disabled=true;setTimeout(()=>view.box.remove(),11000);}
      if(downloadUrl)setTimeout(()=>URL.revokeObjectURL(downloadUrl),30000);
    }
  }
  if(typeof GM_registerMenuCommand==='function')
    GM_registerMenuCommand('Download source analysis ZIP',run);
})();