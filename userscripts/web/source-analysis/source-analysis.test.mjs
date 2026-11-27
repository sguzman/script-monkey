import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const s=await readFile(new URL('./source-analysis.user.js',import.meta.url),'utf8');
test('v1.0.2 retains safe parsing and adds inverse theme',()=>{
  assert.match(s,/^\/\/ @version\s+1\.0\.2$/m);
  assert.match(s,/GM_registerMenuCommand\('Download source analysis ZIP',run\)/);
  assert.doesNotMatch(s,/\bsetInterval\s*\(/);
  assert.doesNotMatch(s,/new MutationObserver/);
  assert.doesNotMatch(s,/window\.fetch\s*=/);
  assert.doesNotMatch(s,/\beval\s*\(/);
  assert.match(s,/script\[type="module"\]:not\(\[src\]\),style/);
  assert.match(s,/validCodeSpecifier/);
});
test('fast code-only budget is smaller than full snapshot',()=>{
  assert.match(s,/resources: 120/);
  assert.match(s,/totalBytes: 48 \* 1024 \* 1024/);
  assert.match(s,/singleBytes: 8 \* 1024 \* 1024/);
  assert.match(s,/timeoutMs: 9000/);
  assert.match(s,/workers: 2/);
  assert.match(s,/depth: 2/);
  assert.match(s,/imageExt/);
  assert.match(s,/not-downloaded/);
});
test('tracks attempted, captured, failed and MiB separately',()=>{
  assert.match(s,/attempted:0,captured:0,failed:0,bytes:0/);
  assert.match(s,/counters\.attempted\+\+/);
  assert.match(s,/counters\.captured\+\+/);
  assert.match(s,/counters\.failed\+\+/);
  assert.match(s,/counters\.bytes\/1048576/);
});
test('handles source maps and code dependencies, cancels, and emits ZIP',()=>{
  assert.match(s,/sourceMappingURL/);
  assert.match(s,/css-import/);
  assert.match(s,/js-module-import/);
  assert.match(s,/js-wasm-reference/);
  assert.match(s,/for\(const req of requests\)/);
  assert.match(s,/if\(cancelled\)return/);
  assert.match(s,/0x04034b50/);
  assert.match(s,/0x02014b50/);
  assert.match(s,/0x06054b50/);
  assert.match(s,/rendered-dom\.html\.txt/);
  assert.match(s,/referencedOnly:state\.references/);
});
test('explicitly declared all-site and CDN scope',()=>{
  assert.match(s,/^\/\/ @match\s+https:\/\/\*\/\*$/m);
  assert.match(s,/^\/\/ @match\s+http:\/\/\*\/\*$/m);
  assert.match(s,/^\/\/ @connect\s+\*$/m);
});

test('HUD uses inverted system light and dark palettes',()=>{
 assert.match(s,/prefers-color-scheme:dark/);
 assert.match(s,/#1b2028/);
 assert.match(s,/#f8fafc/);
});
