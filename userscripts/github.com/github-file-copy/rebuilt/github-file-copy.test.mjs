import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const s=await readFile(new URL('./github-file-copy.user.js',import.meta.url),'utf8');
test('raw link is same-origin and uses bounded privileged request',()=>{
 assert.match(s,/url\.origin!==location\.origin/);
 assert.match(s,/url\.pathname\.replace\('\/blob\/',\s*'\/raw\/'\)/);
 assert.match(s,/const request=GM_xmlhttpRequest/);
 assert.match(s,/rows:400,cache:8,bytes:2\*1024\*1024,timeout:12000/);
});
test('only file rows, explicit click, and cancellation cleanup',()=>{
 assert.match(s,/const links=root\.querySelectorAll\('a\[href\*="\/blob\/"\]'\)/);
 assert.match(s,/b\.addEventListener\('click',async e=>/);
 assert.match(s,/request\.abort\?\.\(\)/);
 assert.doesNotMatch(s,/setInterval\s*\(/);
});

test('v1.0.4 retains redirect permissions and adds inverse themes',()=>{
 assert.match(s,/^\/\/ @version\s+1\.0\.4$/m);
 assert.match(s,/^\/\/ @connect\s+github\.com$/m);
 assert.match(s,/^\/\/ @connect\s+raw\.githubusercontent\.com$/m);
 assert.doesNotMatch(s,/^\/\/ @connect\s+\*$/m);
});
test('copy icon is local SVG; Copying state is visible and temporary',()=>{
 assert.match(s,/document\.createElementNS\(ns,'svg'\)/);
 assert.match(s,/setButtonState\(b,'idle'\)/);
 assert.match(s,/setButtonState\(b,'copying','Copying…'\)/);
 assert.match(s,/setButtonState\(b,'copied','Copied'\)/);
 assert.match(s,/setButtonState\(b,'error','Error'\)/);
 assert.match(s,/if\(!b\.isConnected\)return/);
});

test('HUD uses inverted system light and dark palettes',()=>{
 assert.match(s,/prefers-color-scheme:dark/);
 assert.match(s,/#1b2028/);
 assert.match(s,/#f8fafc/);
});

test('React hydration, navigation and updated links keep every file row eligible',()=>{
 assert.match(s,/function validFileLink\(link\)/);
 assert.match(s,/host\.insertBefore\(b,link\)/);
 assert.match(s,/observer\.observe\(document\.documentElement/);
 assert.match(s,/record\.target\.closest\?\.\(/);
 assert.match(s,/document\.addEventListener\('turbo:render',navigate\)/);
 assert.match(s,/existing\.dataset\.rawUrl=raw/);
 assert.match(s,/getText\(b\.dataset\.rawUrl\)/);
 assert.match(s,/if\(!isDirectoryPage\(\)\)/);
 assert.match(s,/const end=Math\.min\(cursor\+LIMIT\.rows,links\.length\)/);
 assert.match(s,/if\(cursor<links\.length\)/);
 assert.doesNotMatch(s,/^\/\/ @(?:updateURL|downloadURL)\s/m);
});
