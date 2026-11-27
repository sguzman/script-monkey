import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const source=readFileSync(new URL('./gemini-force-text-attachment.user.js',import.meta.url),'utf8');
test('compiles and declares narrow manual-only scope',()=>{
  assert.doesNotThrow(()=>new Script(source));
  assert.match(source,/^\/\/ @match\s+https:\/\/gemini\.google\.com\/\*$/m);
  assert.match(source,/^\/\/ @grant\s+none$/m);
  assert.doesNotMatch(source,/^\/\/ @(?:require|updateURL|downloadURL|connect)\b/m);
  assert.doesNotMatch(source,/navigator\.clipboard|\bfetch\s*\(|\.click\s*\(|setInterval\s*\(/);
});
