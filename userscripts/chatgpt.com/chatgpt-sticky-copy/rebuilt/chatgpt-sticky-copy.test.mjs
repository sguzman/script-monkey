import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const s=await readFile(new URL('./chatgpt-sticky-copy.user.js',import.meta.url),'utf8');
test('single overlay and bounded block registry',()=>{
 assert.match(s,/const button=document\.createElement\('button'\)/);
 assert.match(s,/if\(blocks\.size>300\)/);
 assert.match(s,/slice\(-200\)/);
 assert.match(s,/requestAnimationFrame\(paint\)/);
 assert.doesNotMatch(s,/setInterval\s*\(/);
});
test('copy is explicit; composer collision hides proxy',()=>{
 assert.match(s,/button\.addEventListener\('click'/);
 assert.match(s,/composerTop\(\)/);
 assert.match(s,/if\(top<choice\.visibleTop\+12\|\|top\+32>=bottom\)/);
 assert.match(s,/observer\.disconnect\(\)/);
});
