import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('./page-snapshot.user.js',import.meta.url),'utf8');

test('v1.0.1 is manual with an inverse system theme',()=>{
  assert.match(script,/^\/\/ @version\s+1\.0\.1$/m);
  assert.match(script,/GM_registerMenuCommand\('Download current page snapshot \(ZIP\)',execute\)/);
  assert.doesNotMatch(script,/\bsetInterval\s*\(/);
  assert.doesNotMatch(script,/\b(?:eval|Function)\s*\(/);
  assert.doesNotMatch(script,/fetch\s*\(/);
  assert.doesNotMatch(script,/window\.open\s*\(/);
});

test('capture is bounded and cancelable',()=>{
  assert.match(script,/resources: 600/);
  assert.match(script,/singleBytes: 24 \* 1024 \* 1024/);
  assert.match(script,/totalBytes: 192 \* 1024 \* 1024/);
  assert.match(script,/workers: 2/);
  assert.match(script,/nestedDepth: 3/);
  assert.match(script,/GM_xmlhttpRequest\(\{/);
  assert.match(script,/for\(const req of active\)/);
  assert.match(script,/if\(cancelled\)return/);
});

test('offline preview disables active code and reports misses',()=>{
  assert.match(script,/for\(const script of clone\.querySelectorAll\('script'\)\)script\.remove\(\)/);
  assert.match(script,/Content-Security-Policy/);
  assert.match(script,/missing:skipped/);
  assert.match(script,/source-dom\.html/);
  assert.match(script,/zip\(files\)/);
});

test('ZIP uses standard CRC32 local/central directory records',()=>{
  assert.match(script,/0x04034b50/);
  assert.match(script,/0x02014b50/);
  assert.match(script,/0x06054b50/);
  assert.match(script,/crc32\(data\)/);
});

test('cross-origin capability is disclosed and not automatically triggered',()=>{
  assert.match(script,/^\/\/ @match\s+https:\/\/\*\/\*$/m);
  assert.match(script,/^\/\/ @match\s+http:\/\/\*\/\*$/m);
  assert.match(script,/^\/\/ @connect\s+\*$/m);
  assert.match(script,/ABSOLUTELY NO network access occurs until the menu command/);
});

test('HUD uses inverted system light and dark palettes',()=>{
 assert.match(script,/prefers-color-scheme:dark/);
 assert.match(script,/#1b2028/);
 assert.match(script,/#f8fafc/);
});
