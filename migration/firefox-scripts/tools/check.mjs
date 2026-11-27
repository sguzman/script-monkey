#!/usr/bin/env node
// Static, dependency-free guardrails. This does not execute userscripts.
import {readFile, readdir, access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_STATES = new Set(['candidate','approved','rebuilt','released']);
const REPO = 'https://github.com/sguzman/firefox-scripts';
const SOURCE_REPO = 'https://github.com/sguzman/script-monkey';

export function parseMetadata(source) {
  const block = source.match(/^\/\/ ==UserScript==\s*$([\s\S]*?)^\/\/ ==\/UserScript==\s*$/m);
  if (!block) return null;
  const props = new Map();
  for (const line of block[1].split(/\r?\n/)) {
    const match = line.match(/^\/\/\s+@([\w-]+)\s+(.+?)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (!props.has(key)) props.set(key, []);
    props.get(key).push(match[2]);
  }
  return props;
}

export function checkScript(entry, source) {
  const errors = [];
  const meta = parseMetadata(source);
  if (!meta) return ['missing valid userscript metadata header'];
  const first = key => meta.get(key)?.[0];
  if (!first('name')) errors.push('missing @name');
  if (!/^\d+\.\d+\.\d+$/.test(first('version') || '')) errors.push('@version must be semver');
  if (first('namespace') !== REPO) errors.push('wrong @namespace');
  if (first('run-at') !== 'document-idle') errors.push('use @run-at document-idle');
  for (const key of ['require','resource','include','exclude']) {
    if (meta.has(key)) errors.push('@'+key+' is not permitted in the baseline');
  }
  const matches = meta.get('match') || [];
  if (!matches.length) errors.push('no @match declarations');
  for (const match of matches) {
    const m = match.match(/^https?:\/\/([\w*.-]+)\/[^\s]*$/);
    if (!m || !entry.hosts.includes(m[1]))
      errors.push('host not explicitly approved: '+match);
  }
  const grants = meta.get('grant') || [];
  if (!grants.length) errors.push('must declare @grant none or explicit reviewed grants');
  if (grants.includes('none') && grants.length > 1)
    errors.push('@grant none cannot be mixed with privileged grants');
  for (const grant of grants) {
    if (!(entry.allowedGrants || ['none']).includes(grant))
      errors.push('unreviewed grant: '+grant);
  }
  for (const host of meta.get('connect') || []) {
    if (!(entry.connectHosts || []).includes(host))
      errors.push('unreviewed @connect host: '+host);
  }
  if ((meta.get('connect') || []).length &&
      !grants.includes('GM_xmlhttpRequest'))
    errors.push('@connect requires reviewed GM_xmlhttpRequest');
  for (const key of ['downloadURL','updateURL']) {
    const values = meta.get(key) || [];
    if (values.length && entry.status !== 'released')
      errors.push('@'+key+' before explicit release is prohibited');
    const expected = `https://raw.githubusercontent.com/sguzman/firefox-scripts/main/userscripts/${entry.site}/${entry.id}/${entry.id}.user.js`;
    if (values.some(value=>value!==expected))
      errors.push('@'+key+' must point at the reviewed script in this repository');
  }
  const body = source.slice(source.indexOf('// ==/UserScript==') + 18);
  const prohibited = [
    [/\bsetInterval\s*\(/,'unbounded setInterval'],
    [/\b(?:eval|Function)\s*\(/,'dynamic code evaluation'],
    [/\bdocument\.write\s*\(/,'document.write'],
    [/\b(?:window\.)?localStorage\.clear\s*\(/,'unrelated storage clearing']
  ];
  for (const [regex,why] of prohibited)
    if (regex.test(body)) errors.push(why+' is prohibited');
  return errors;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}
async function listScripts(dir, results = []) {
  if (!await exists(dir)) return results;
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    if (entry.isDirectory()) await listScripts(file,results);
    else if (entry.isFile() && entry.name.endsWith('.user.js'))
      results.push(path.relative(ROOT,file).replaceAll(path.sep,'/'));
  }
  return results;
}
export async function checkRepository(root = ROOT) {
  const errors = [];
  const data = JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
  if (data.schemaVersion!==1 || !Array.isArray(data.scripts))
    errors.push('invalid catalog schema');
  const ids = new Set(), expected = new Set();
  for (const entry of data.scripts || []) {
    const label = String(entry.id || '<missing>');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(label)) errors.push('invalid ID: '+label);
    if (ids.has(label)) errors.push('duplicate ID: '+label);
    ids.add(label);
    if (!/^[a-z0-9.]+$/.test(entry.site || '')) errors.push('invalid site: '+label);
    if (!ALLOWED_STATES.has(entry.status)) errors.push('invalid status: '+label);
    if (!Array.isArray(entry.hosts) || !entry.hosts.length ||
        entry.hosts.some(host=> !/^(?:\*\.)?[a-z0-9.*-]+$/.test(host)))
      errors.push('missing or invalid explicit allowed hosts: '+label);
    if ((entry.hosts.includes('*') || (entry.connectHosts || []).includes('*')) &&
        !(['page-snapshot','source-analysis'].includes(entry.id) && entry.scope === 'all-pages-manual'))
      errors.push('broad permissions require explicit manual snapshot review: '+label);
    const source = `${entry.origin === 'native' ? REPO : SOURCE_REPO}/blob/main/userscripts/${entry.site}/${label}/${label}.user.js`;
    if (entry.source !== source) errors.push('unverified source path: '+label);
    const rel = `userscripts/${entry.site}/${label}/${label}.user.js`;
    expected.add(rel);
    const absolute = path.join(root,rel);
    const found = await exists(absolute);
    if (entry.status === 'candidate' && found)
      errors.push('candidate must not contain executable script: '+label);
    if (['rebuilt','released'].includes(entry.status) && !found)
      errors.push('rebuilt/released script is missing: '+label);
    if (!found) continue;
    const sourceText = await readFile(absolute,'utf8');
    for (const failure of checkScript(entry,sourceText))
      errors.push(label+': '+failure);
    const folder = path.dirname(absolute);
    for (const file of ['README.md',label+'.test.mjs'])
      if (!await exists(path.join(folder,file)))
        errors.push(label+': required file missing: '+file);
  }
  for (const actual of await listScripts(path.join(root,'userscripts'))) {
    if (!expected.has(actual)) errors.push('uncataloged userscript: '+actual);
  }
  if (await exists(path.join(root,'extensions')))
    errors.push('extension code is not allowed here; use README links');
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkRepository().then(errors => {
    if (errors.length) {
      for (const error of errors) console.error('FAIL: '+error);
      process.exitCode = 1;
    } else console.log('PASS: inventory, script scopes, permissions and repository separation');
  }).catch(error=>{console.error(error);process.exitCode=1;});
}
