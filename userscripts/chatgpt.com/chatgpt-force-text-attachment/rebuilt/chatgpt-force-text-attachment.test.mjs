import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const s=await readFile(new URL('./chatgpt-force-text-attachment.user.js',import.meta.url),'utf8');

test('Firefox v1.3.0 attaches only from real native paste data',()=>{
  assert.match(s,/^\/\/ @version\s+1\.3\.0$/m);
  assert.match(s,/button\.addEventListener\('click',\(\)=>armButtonPaste\(\)\)/);
  assert.match(s,/event\.clipboardData\?\.getData\('text\/plain'\)/);
  assert.match(s,/void attach\(text\)/);
  assert.match(s,/window\.addEventListener\('keydown',onKeydown,true\)/);
  assert.match(s,/window\.addEventListener\('paste',onPaste,true\)/);
  assert.match(s,/ensurePasteSink\(\)\.focus/);
  assert.match(s,/mode==='button'\?12000:1000/);
});

test('no code path may request clipboard permission',()=>{
  assert.doesNotMatch(s,/navigator\.clipboard/);
  assert.doesNotMatch(s,/readText\s*\(/);
  assert.doesNotMatch(s,/clipboardRead/);
  assert.doesNotMatch(s,/GM_getClipboard/);
  assert.doesNotMatch(s,/document\.execCommand\('paste'\)/);
});

test('file selection cannot guess a tied input or replace an existing attachment',()=>{
  assert.match(s,/id==='upload-files'/);
  assert.match(s,/candidates\[0\]\.score===candidates\[1\]\.score/);
  assert.match(s,/if\(input\.files\?\.length\)/);
  assert.match(s,/if\(!succeeded\)throw Error/);
  assert.match(s,/input\.dispatchEvent\(new Event\('change'/);
  assert.doesNotMatch(s,/\.submit\s*\(|send-button.*click\s*\(/);
});

test('limited work, editor restoration and guarded button placement',()=>{
  assert.match(s,/MAX_TEXT=4\*1024\*1024/);
  assert.match(s,/i<8;i\+\+/);
  assert.match(s,/i<18;i\+\+/);
  assert.doesNotMatch(s,/setInterval\s*\(/);
  assert.match(s,/selection\?\.addRange\(arm\.range\)/);
  assert.match(s,/if\(!plus&&!prompt\)return null/);
  assert.match(s,/observer\.observe\(document\.body/);
  assert.match(s,/prefers-color-scheme:dark/);
});
