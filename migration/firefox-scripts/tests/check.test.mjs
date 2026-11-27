import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRepository,checkScript,parseMetadata} from '../tools/check.mjs';

const entry={
  id:'small-safe-script',site:'example.com',hosts:['example.com'],
  status:'rebuilt',allowedGrants:['none']
};
function candidate(extra='') {
  return `// ==UserScript==
// @name Small Safe Script
// @namespace https://github.com/sguzman/firefox-scripts
// @version 1.0.0
// @match https://example.com/path/*
// @grant none
// @run-at document-idle
${extra}// ==/UserScript==
'use strict';
document.addEventListener('click',()=>{});
`;
}

test('five migrations and two independent manual snapshot tools; five candidates remain',async()=>{
  const errors=await checkRepository();
  assert.deepEqual(errors,[]);
  const {default:data}=await import('../catalog.json',{with:{type:'json'}});
  assert.equal(data.scripts.length,12);
  assert.equal(data.scripts.filter(s=>s.status==='rebuilt').length,7);
  assert.equal(data.scripts.filter(s=>s.status==='candidate').length,5);
  assert.deepEqual(data.scripts.slice(0,5).map(s=>s.status),
    Array(5).fill('rebuilt'));
});

test('narrow Firefox userscript metadata is accepted',()=>{
  assert.ok(parseMetadata(candidate()));
  assert.deepEqual(checkScript(entry,candidate()),[]);
});

test('global match and unapproved host are rejected',()=>{
  assert.ok(checkScript(entry,candidate().replace('https://example.com/path/*','*://*/*')).some(x=>x.includes('host')));
  assert.ok(checkScript(entry,candidate().replace('https://example.com/path/*','https://unrelated.example/*')).some(x=>x.includes('host')));
});

test('remote dependencies, broad privileges and autoplay updates are rejected',()=>{
  assert.ok(checkScript(entry,candidate('// @require https://cdn.example/script.js\n')).some(x=>x.includes('require')));
  assert.ok(checkScript(entry,candidate().replace('// @grant none','// @grant GM_xmlhttpRequest')).some(x=>x.includes('grant')));
  assert.ok(checkScript(entry,candidate('// @updateURL https://example.com/auto.user.js\n')).some(x=>x.includes('updateURL')));
});

test('intervals, dynamic evaluation and document writes are rejected',()=>{
  for(const code of ['setInterval(()=>{},100);','eval("1");','document.write("oops");'])
    assert.ok(checkScript(entry,candidate()+code).length > 0);
});

test('only both manual snapshot tools have universal site scope',async()=>{
  const {default:data}=await import('../catalog.json',{with:{type:'json'}});
  const special=data.scripts.filter(s=>s.hosts.includes('*'));
  assert.equal(special.length,2);
  assert.deepEqual(special.map(s=>s.id).sort(),['page-snapshot','source-analysis']);
  for(const item of special) {
    assert.equal(item.origin,'native');
    assert.equal(item.scope,'all-pages-manual');
    assert.deepEqual(item.connectHosts,['*']);
    assert.deepEqual(item.allowedGrants,['GM_registerMenuCommand','GM_xmlhttpRequest']);
  }
});
