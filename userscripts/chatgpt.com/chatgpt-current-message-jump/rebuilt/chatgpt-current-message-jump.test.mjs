import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const s=await readFile(new URL('./chatgpt-current-message-jump.user.js',import.meta.url),'utf8');
test('bounded tail traversal, rAF and no idle polling',()=>{
 assert.match(s,/tailNodes:1800/);
 assert.match(s,/turns:240/);
 assert.match(s,/walked\+\+<LIMIT\.tailNodes/);
 assert.match(s,/requestAnimationFrame\(paint\)/);
 assert.doesNotMatch(s,/setInterval\s*\(|document\.querySelectorAll\(SELECTOR\)/);
});
test('safe placement and graceful virtualized fallback',()=>{
 assert.match(s,/document\.elementFromPoint/);
 assert.match(s,/const xy=place\(height\)/);
 assert.match(s,/target\.scrollIntoView/);
 assert.match(s,/observer\.disconnect\(\)/);
});

test('v1.0.1 supports late hydration and inverse system palette',()=>{
 assert.match(s,/^\/\/ @version\s+1\.0\.1$/m);
 assert.match(s,/^\/\/ @match\s+https:\/\/chatgpt\.com\/\*$/m);
 assert.match(s,/prefers-color-scheme:dark/);
 assert.match(s,/observer\.observe\(document\.body/);
});
