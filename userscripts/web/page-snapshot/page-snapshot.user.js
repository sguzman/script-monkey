// ==UserScript==
// @name         Page Snapshot ZIP (Firefox)
// @namespace    https://github.com/sguzman/firefox-scripts
// @version      1.0.1
// @description  Manually archive current rendered HTML and accessible client-side resources into a local ZIP.
// @match        https://*/*
// @match        http://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  // Wide read permissions are necessary for cross-origin CDN assets, but
  // ABSOLUTELY NO network access occurs until the menu command is invoked.
  // Tampermonkey may require approval of each redirected asset domain.
  const LIMIT = Object.freeze({
    resources: 600, singleBytes: 24 * 1024 * 1024,
    totalBytes: 192 * 1024 * 1024, timeoutMs: 16000,
    workers: 2, nestedDepth: 3, htmlChars: 12 * 1024 * 1024
  });
  let running = false;
  const textEncoder = new TextEncoder();
  const utf8 = text => textEncoder.encode(text);
  const decode = bytes => new TextDecoder('utf-8', {fatal:false}).decode(bytes);
  const active = new Set();
  const skipped = [];
  const resources = new Map();
  let cancelled = false, currentLocation = '';
  let panel, output;
  const isWeb = url => /^https?:$/.test(url.protocol);
  const safeName = name => (name || 'page').replace(/[^\w.-]+/g,'_').slice(0,72) || 'page';
  const noteSkip = (url,reason) => {
    if(skipped.length < 2000) skipped.push({url,reason:String(reason).slice(0,230)});
  };
  function resolveURL(value,base) {
    try {
      if(!value || /^\s*(?:#|data:|javascript:|mailto:|tel:)/i.test(value)) return null;
      const url = new URL(value.trim(),base);
      url.hash='';
      return isWeb(url) ? url.href : null;
    } catch {return null;}
  }
  function extension(value) {
    let name = 'asset';
    try {name = new URL(value).pathname.split('/').pop() || 'asset';} catch {}
    const safe = safeName(decodeURIComponent(name).slice(0,88));
    return safe === 'asset' ? 'resource.bin' : safe;
  }
  function ui() {
    panel=document.createElement('aside');
    panel.id='fx-page-snapshot-status';
    Object.assign(panel.style,{
      position:'fixed',zIndex:'2147483645',bottom:'16px',right:'16px',
      padding:'11px 14px',maxWidth:'350px',background:'Canvas',
      color:'CanvasText',border:'1px solid GrayText',borderRadius:'9px',
      boxShadow:'0 2px 14px #0005',font:'13px system-ui'
    });
    const theme=document.createElement('style');
    theme.textContent=[
      '#fx-page-snapshot-status{background:#1b2028!important;color:#f9fafb!important;',
      'border-color:#06080c!important;box-shadow:0 2px 12px #0007!important}',
      '#fx-page-snapshot-status button{background:#353c47!important;color:#f9fafb!important;',
      'border:1px solid #7b8795!important;border-radius:6px!important;',
      'font:600 12px system-ui!important}',
      '@media(prefers-color-scheme:dark){#fx-page-snapshot-status{',
      'background:#f8fafc!important;color:#111827!important;',
      'border-color:#cbd5e1!important;box-shadow:0 2px 12px #0008!important}',
      '#fx-page-snapshot-status button{background:#e2e8f0!important;',
      'color:#111827!important;border-color:#94a3b8!important}}'
    ].join('');
    panel.append(theme);
    output=document.createElement('span');
    output.setAttribute('role','status');
    const cancel=document.createElement('button');
    cancel.type='button';cancel.textContent='Cancel';
    Object.assign(cancel.style,{marginLeft:'12px',cursor:'pointer',
      padding:'4px 8px',color:'CanvasText',background:'Canvas',
      border:'1px solid GrayText',borderRadius:'5px'});
    cancel.addEventListener('click',()=>{
      cancelled=true;for(const req of active) try{req.abort?.();}catch{}
      output.textContent='Cancelled. No archive will be downloaded.';
      cancel.disabled=true;
    });
    panel.append(output,cancel);
    document.body?.append(panel);
    return cancel;
  }
  function status(text){if(output)output.textContent=text;}
  function collectInitial() {
    const html='<!DOCTYPE html>\n'+document.documentElement.outerHTML;
    if(html.length > LIMIT.htmlChars) throw Error('Rendered HTML exceeds 12-million-character safety budget');
    const list = new Map();
    function queue(value,base,type='resource',depth=0) {
      const url=resolveURL(value,base);
      if(!url)return null;
      if(!list.has(url)) {
        if(list.size >= LIMIT.resources) {
          noteSkip(url,'Resource count limit reached');
          return null;
        }
        const index=list.size+1;
        list.set(url,{url,kind:type,depth,path:'assets/'+
          String(index).padStart(4,'0')+'-'+extension(url),bytes:null,
          mime:null,status:'queued'});
      }
      return list.get(url);
    }
    const base=document.baseURI;
    const attrs=[
      ['script[src]','src','javascript'],
      ['link[href]','href','link'],
      ['img[src]','src','image'],['source[src]','src','media'],
      ['video[src]','src','media'],['video[poster]','poster','image'],
      ['audio[src]','src','media'],['input[src]','src','image'],
      ['embed[src]','src','embedded'],['object[data]','data','embedded'],
      ['iframe[src]','src','iframe'],['image[href]','href','svg'],
      ['use[href]','href','svg']
    ];
    // One bounded initial DOM selector, not fourteen page-wide traversals.
    const selectors=attrs.map(x=>x[0]).concat('[srcset]').join(',');
    const candidates=document.querySelectorAll(selectors);
    let scanned=0;
    for(const el of candidates) {
      if(++scanned>12000) {
        noteSkip(base,'DOM candidate budget reached (12,000 elements)');
        break;
      }
      for(const [selector,attribute,kind] of attrs)
        if(el.matches(selector))queue(el.getAttribute(attribute),base,kind);
      if(el.hasAttribute('srcset'))
        for(const part of (el.getAttribute('srcset')||'').split(',')) {
          const ref=part.trim().split(/\s+/)[0];
          queue(ref,base,'image');
        }
    }
    // Only static resource entries. Re-requesting authenticated API/XHR
    // endpoints risks leaking private material or triggering operations.
    const safeStatic=/\.(?:js|mjs|css|wasm|json|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp3|mp4|webm|ogg|pdf)(?:$|[?#])/i;
    for(const entry of performance.getEntriesByType('resource').slice(-1500)) {
      const type=String(entry.initiatorType||'');
      if(safeStatic.test(entry.name) ||
        ['script','css','link','img','image','video','audio'].includes(type))
        queue(entry.name,base,'performance');
    }
    const cssFromText=(value,origin,depth=0)=>{
      const refs=/(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(?:url\(\s*)?['"]([^'"]+)['"])/gi;
      let match,steps=0;
      while((match=refs.exec(value)) && ++steps<=1000)
        queue(match[2]||match[3],origin,'css-dependency',depth+1);
    };
    for(const node of document.querySelectorAll('style'))
      cssFromText(node.textContent||'',base);
    for(const node of document.querySelectorAll('[style]'))
      cssFromText(node.getAttribute('style')||'',base);
    for(const sheet of Array.from(document.styleSheets).slice(0,200)) {
      try {
        const rules=sheet.cssRules;
        let css='';
        for(let i=0;i<Math.min(rules.length,4000);i++)css+=rules[i].cssText+'\n';
        cssFromText(css,sheet.href||base);
      } catch { /* cross-origin CSS inaccessible; external CSS is fetched below */ }
    }
    return {html,queue,list,cssFromText};
  }
  function request(url) {
    return new Promise((resolve,reject)=>{
      let finished=false,handle=null;
      function settle(error,result) {
        if(finished)return;
        finished=true;active.delete(handle);
        if(error)reject(error);else resolve(result);
      }
      try {
        handle=GM_xmlhttpRequest({
          method:'GET',url,responseType:'arraybuffer',
          timeout:LIMIT.timeoutMs,
          anonymous:false,
          onprogress:info=>{
            if(info.loaded>LIMIT.singleBytes) {
              try{handle?.abort();}catch{}
              settle(Error('File exceeds 24 MiB safety limit'));
            }
          },
          onload:response=>{
            if(response.status<200 || response.status>=300)
              return settle(Error('HTTP '+response.status));
            const locationURL=response.finalUrl||url;
            const bytes=response.response instanceof ArrayBuffer ?
              new Uint8Array(response.response) :
              ArrayBuffer.isView(response.response) ?
                new Uint8Array(response.response.buffer,response.response.byteOffset,
                  response.response.byteLength) : null;
            if(!bytes) return settle(Error('Binary response unavailable'));
            if(bytes.byteLength>LIMIT.singleBytes)
              return settle(Error('File exceeds 24 MiB safety limit'));
            const mime=/content-type:\s*([^\r\n;]+)/i.exec(response.responseHeaders||'')?.[1] || '';
            settle(null,{bytes,mime,finalUrl:locationURL});
          },
          ontimeout:()=>settle(Error('Timed out')),
          onerror:()=>settle(Error('Network or permission error')),
          onabort:()=>settle(Error('Request cancelled'))
        });
        if(!finished)active.add(handle);
      } catch(error){settle(error);}
    });
  }
  function discoverDependencies(item,source,queue,cssFromText) {
    if(item.depth>=LIMIT.nestedDepth)return;
    if(/\.css(?:$|\?)/i.test(item.url) || /text\/css/i.test(item.mime)) {
      cssFromText(source,item.finalUrl||item.url,item.depth);
    } else if(/\.m?js(?:$|\?)/i.test(item.url) ||
      /(?:javascript|ecmascript)/i.test(item.mime)) {
      const jsImports=/(?:\b(?:import|export)\s*(?:[^'"]*?\sfrom\s*)?|\bimport\s*\(|\bnew\s+(?:Shared)?Worker\s*\()\s*['"]([^'"]+)['"]/g;
      let m,count=0;
      while((m=jsImports.exec(source)) && ++count<=300)
        queue(m[1],item.finalUrl||item.url,'js-dependency',item.depth+1);
      const maps=/[#@]\s*sourceMappingURL\s*=\s*([^\s*]+)/g;
      while((m=maps.exec(source)) && ++count<=350)
        queue(m[1],item.finalUrl||item.url,'source-map',item.depth+1);
    }
  }
  async function downloadResources(state) {
    let cursor=0,downloaded=0,bytesTotal=0;
    // Processing the dynamic Map in insertion order lets discovered CSS/JS
    // dependencies enter the queue, up to the same shared count/size limits.
    async function worker(){
      while(!cancelled) {
        const item=Array.from(state.list.values())[cursor++];
        if(!item)return;
        if(bytesTotal>=LIMIT.totalBytes) {
          item.status='skipped';noteSkip(item.url,'Total archive budget exhausted');continue;
        }
        status('Fetching '+(downloaded+1)+' / '+state.list.size+' assets…');
        try {
          const result=await request(item.url);
          if(cancelled)return;
          if(bytesTotal+result.bytes.length>LIMIT.totalBytes)
            throw Error('Total archive budget exhausted');
          bytesTotal+=result.bytes.length;
          item.bytes=result.bytes;item.mime=result.mime;
          item.finalUrl=result.finalUrl;item.status='captured';
          downloaded++;
          if(item.depth<LIMIT.nestedDepth &&
            (/\.css(?:$|\?)/i.test(item.url)||/\.m?js(?:$|\?)/i.test(item.url)||
             /css|javascript|ecmascript/i.test(item.mime))) {
            // UTF-8 decode only textual resource types, never images/fonts.
            discoverDependencies(item,decode(item.bytes),state.queue,state.cssFromText);
          }
        } catch(error) {
          item.status='missing';
          noteSkip(item.url,error?.message||'Unknown request failure');
        }
        if(cursor%10===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    await Promise.all(Array.from({length:LIMIT.workers},()=>worker()));
    return {downloaded,bytesTotal};
  }
  function offlineHTML(state) {
    const clone=document.documentElement.cloneNode(true);
    // Snapshot is intentionally NON-EXECUTABLE, since replaying a saved
    // authenticated page could send requests or repeat actions.
    for(const script of clone.querySelectorAll('script'))script.remove();
    for(const node of clone.querySelectorAll('meta[http-equiv="refresh"]'))node.remove();
    for(const el of clone.querySelectorAll('form')) {
      el.removeAttribute('action');el.removeAttribute('method');
    }
    const rewrite=(raw,base,path)=>{
      const abs=resolveURL(raw,base);
      const hit=abs && state.list.get(abs);
      if(hit?.status==='captured')return hit.path;
      return null;
    };
    const linkAttrs=['src','href','poster','data'];
    for(const node of clone.querySelectorAll('*')) {
      for(const attr of linkAttrs) {
        if(!node.hasAttribute(attr))continue;
        const value=node.getAttribute(attr);
        if(!value || /^\s*(?:data:|#)/i.test(value))continue;
        if(attr==='href' && node.matches('a,area')) continue;
        const replacement=rewrite(value,document.baseURI);
        if(replacement)node.setAttribute(attr,replacement);
        else if(resolveURL(value,document.baseURI))node.removeAttribute(attr);
      }
      for(const attr of ['srcset','imagesrcset','formaction']) node.removeAttribute(attr);
      for(const attr of Array.from(node.attributes)) {
        if(attr.name.toLowerCase().startsWith('on')) node.removeAttribute(attr.name);
      }
    }
    for(const element of clone.querySelectorAll('base'))element.remove();
    // Rewrite available inline style URLs as well as linked CSS.
    const offlineStyle=text=>text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
      (full,q,url)=>{
        const local=rewrite(url,document.baseURI);
        return local ? 'url('+q+local+q+')' : full;
      });
    for(const element of clone.querySelectorAll('style'))
      element.textContent=offlineStyle(element.textContent||'');
    for(const element of clone.querySelectorAll('[style]'))
      element.setAttribute('style',offlineStyle(element.getAttribute('style')||''));
    // Forensic source-dom.html retains original attributes and scripts.
    const head=clone.querySelector('head');
    if(head) {
      const csp=document.createElement('meta');
      csp.setAttribute('http-equiv','Content-Security-Policy');
      csp.setAttribute('content',"default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self' data: blob:;");
      head.insertBefore(csp,head.firstChild);
    }
    return '<!DOCTYPE html>\n'+clone.outerHTML;
  }
  function rewriteStyles(state,text,item){
    const replace=(raw)=>{
      const abs=resolveURL(raw,item.finalUrl||item.url);
      const target=abs&&state.list.get(abs);
      if(target?.status!=='captured')return raw;
      // Every captured CSS file lives directly inside assets/.
      return target.path.replace(/^assets\//,'');
    };
    return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
      (match,q,url)=>'url('+q+replace(url)+q+')')
      .replace(/@import\s+(["'])([^"']+)\1/gi,
        (_m,q,url)=>'@import '+q+replace(url)+q);
  }
  // ZIP32, STORE method (no external compression library). Entries are
  // standard ZIP files, but contents are stored rather than deflated.
  const crcTable=Array.from({length:256},(_,i)=>{
    let crc=i;for(let n=0;n<8;n++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;
    return crc>>>0;
  });
  function crc32(bytes) {
    let crc=0xffffffff;
    for(let i=0;i<bytes.length;i++)
      crc=(crc>>>8)^crcTable[(crc^bytes[i])&255];
    return (crc^0xffffffff)>>>0;
  }
  function zip(files) {
    const local=[],central=[];
    let offset=0,centralSize=0;
    const write16=(view,pos,num)=>view.setUint16(pos,num,true);
    const write32=(view,pos,num)=>view.setUint32(pos,num,true);
    for(const [name,value] of files) {
      const filename=utf8(name);
      const data=typeof value==='string'?utf8(value):value;
      if(filename.length>65535||data.length>0xffffffff)
        throw Error('ZIP entry exceeds format limits');
      const checksum=crc32(data);
      const header=new Uint8Array(30+filename.length),h=new DataView(header.buffer);
      write32(h,0,0x04034b50);write16(h,4,20);write16(h,6,0x0800);
      write16(h,8,0);write32(h,14,checksum);write32(h,18,data.length);
      write32(h,22,data.length);write16(h,26,filename.length);
      header.set(filename,30);
      local.push(header,data);
      const directory=new Uint8Array(46+filename.length),d=new DataView(directory.buffer);
      write32(d,0,0x02014b50);write16(d,4,20);write16(d,6,20);
      write16(d,8,0x0800);write16(d,10,0);
      write32(d,16,checksum);write32(d,20,data.length);
      write32(d,24,data.length);write16(d,28,filename.length);
      write32(d,42,offset);directory.set(filename,46);
      central.push(directory);centralSize+=directory.length;
      offset+=header.length+data.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);
    write32(e,0,0x06054b50);write16(e,8,central.length);
    write16(e,10,central.length);write32(e,12,centralSize);
    write32(e,16,offset);
    return new Blob([...local,...central,end],{type:'application/zip'});
  }
  async function execute() {
    if(running)return;
    running=true;cancelled=false;skipped.length=0;active.clear();
    currentLocation=location.href;
    const cancel=ui();
    try {
      if(typeof GM_xmlhttpRequest!=='function')throw Error('Tampermonkey XHR permission unavailable');
      status('Collecting rendered DOM and asset references…');
      const state=collectInitial();
      status('Found '+state.list.size+' resources; downloading…');
      const summary=await downloadResources(state);
      if(cancelled)return;
      if(location.href!==currentLocation)
        throw Error('Page navigation occurred; snapshot cancelled');
      const manifest={
        format:'firefox-page-snapshot-v1',version:'1.0.1',
        page:currentLocation,capturedAt:new Date().toISOString(),
        title:document.title,origin:location.origin,
        limits:LIMIT,summary,assetCount:state.list.size,
        captured:[...state.list.values()].filter(x=>x.status==='captured')
          .map(x=>({url:x.url,finalUrl:x.finalUrl,path:x.path,mime:x.mime,bytes:x.bytes.length})),
        missing:skipped,
        limitations:[
          'Rendered DOM, not server-side application source.',
          'Cross-origin frames and shadow DOM may be incomplete.',
          'Browser-generated blob/data resources and uncached network responses may be missing.',
          'An offline preview is non-executable; source-dom.html retains client-side markup and scripts.',
          'Some CDN assets require Tampermonkey cross-domain approval.',
          'ZIP uses STORE method; files are not compressed.'
        ]
      };
      const files=[
        ['index.html',offlineHTML(state)],
        ['source-dom.html',state.html],
        ['manifest.json',JSON.stringify(manifest,null,2)],
        ['README.txt','Firefox Page Snapshot\nPage: '+currentLocation+
          '\n\nindex.html: non-executable offline best-effort preview'+
          '\nsource-dom.html: original rendered DOM with inline scripts/styles'+
          '\nassets/: fetched resources, including JS/CSS/media/fonts where accessible'+
          '\nmanifest.json: captured URLs, missing resources and limits'+
          '\n\nWARNING: Archive may include private page content and tokenized URLs.'+
          '\nDo not publish unreviewed snapshots.\n']
      ];
      for(const asset of state.list.values())if(asset.status==='captured'){
        const isCSS=/\.css(?:$|\?)/i.test(asset.url)||/text\/css/i.test(asset.mime);
        files.push([asset.path,isCSS?rewriteStyles(state,decode(asset.bytes),asset):asset.bytes]);
      }
      status('Building local ZIP ('+summary.downloaded+' assets)…');
      const blob=zip(files);
      if(cancelled)return;
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      link.href=url;link.download='page-snapshot-'+
        safeName(location.hostname)+'-'+stamp+'.zip';
      link.style.display='none';document.body.append(link);
      link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      status('ZIP requested: '+summary.downloaded+' assets, '+
        skipped.length+' unavailable. Review manifest.json.');
    } catch(error) {
      status('Snapshot failed: '+(error?.message||String(error)));
    } finally {
      running=false;active.clear();cancel.disabled=true;
      setTimeout(()=>panel?.remove(),12000);
    }
  }
  if(typeof GM_registerMenuCommand==='function')
    GM_registerMenuCommand('Download current page snapshot (ZIP)',execute);
})();
