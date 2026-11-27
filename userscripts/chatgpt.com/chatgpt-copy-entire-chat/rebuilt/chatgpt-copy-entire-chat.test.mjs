import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./chatgpt-copy-entire-chat.user.js',import.meta.url),'utf8');

function setup(historyPages) {
  let menu,copied=null;
  const statuses=[];
  const element=()=>({id:'fx-copy-all-status',style:{},setAttribute(){},
    set textContent(s){statuses.push(s);},get textContent(){return statuses.at(-1)}});
  let created=null;
  const document={
    title:'Sample Chat - ChatGPT',body:{append(el){created=el}},
    getElementById(){return created},createElement:element
  };
  const req=[];
  const context={
    document,location:{pathname:'/c/123e4567-e89b-12d3-a456-426614174000',
      href:'https://chatgpt.com/c/123e4567-e89b-12d3-a456-426614174000'},
    GM_registerMenuCommand(_title,fn){menu=fn},
    GM_setClipboard(value){copied=value},
    fetch:async(url)=>{
      req.push(String(url));
      let body;
      if(url==='/api/auth/session')body={accessToken:'private-test-token'};
      else body=historyPages.shift();
      if(!body)return {ok:false,status:404,headers:{get(){return null}}};
      return {ok:true,status:200,headers:{get(){return null}},json:async()=>body};
    },
    AbortController,Promise,Date,URL,setTimeout,clearTimeout,console
  };
  vm.runInNewContext(source,context,{timeout:1000});
  return {invoke:()=>menu(),copied:()=>copied,requests:req,statuses};
}
const msg=(id,role,text)=>({id,author:{role},content:{parts:[text]}});

test('server-proven pagination copies complete ordered history',async()=>{
 const first={messages:[msg('b','assistant','second')],title:'Sample',
   page_info:{has_previous_page:true,start_cursor:'older'}};
 const older={messages:[msg('a','user','first')],page_info:{has_previous_page:false}};
 const h=setup([first,older]);await h.invoke();
 assert.match(h.copied(),/USER\nfirst\n\nASSISTANT\nsecond/);
 assert.equal(h.requests.length,3);
 assert.ok(!h.copied().includes('private-test-token'));
});

test('broken pagination never copies partial transcript',async()=>{
 const h=setup([{messages:[msg('b','assistant','only newest')],
   page_info:{has_previous_page:true}}]);
 await h.invoke();
 assert.equal(h.copied(),null);
 assert.match(h.statuses.at(-1),/no partial transcript copied/i);
});

test('no interval, observer or scroll mutation path',()=>{
 assert.doesNotMatch(source,/\b(?:setInterval|MutationObserver|scrollTo|scrollIntoView)\b/);
 assert.match(source,/has_previous_page!==false/);
 assert.match(source,/LIMITS\.textChars/);
});
