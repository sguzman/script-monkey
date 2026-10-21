#!/usr/bin/env python3
"""Disposable Chromium, Edge, and Chrome Manifest V3 integration.

Synthetic ChatGPT pages only: never access an existing browser profile,
session, private conversation, or authenticated ChatGPT account.
"""
import contextlib
import os
import pathlib
import tempfile
import time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

EXTENSION = pathlib.Path(__file__).resolve().parents[1]
CHANNEL = os.environ.get("TAB_SIGNAL_BROWSER_CHANNEL", "chromium")
EXECUTABLE = os.environ.get("TAB_SIGNAL_BROWSER_EXECUTABLE", "")
TABS = int(os.environ.get("TAB_SIGNAL_MV3_TABS", "24"))
assert CHANNEL in ("chromium", "msedge", "chrome")
assert 3 <= TABS <= 32

PREFIX = {"generating":"⏳ ", "unread":"🔔 ", "finished":"✅ ",
          "error":"⚠️ ", "limit":"🛑 "}

def fixture(index):
    old = ''.join('<article data-testid="conversation-turn-old-%d">'
                  'Historical synthetic turn</article>' % i
                  for i in range(8000 if index == 0 else 40))
    return ('<!doctype html><html><head>'
            f'<title>Fixture {index} - ChatGPT</title>'
            '<link rel="icon" href="/favicon.ico" sizes="16x16" type="image/x-icon">'
            '<link rel="icon" href="/favicon-dark.ico" sizes="32x32" '
            'media="(prefers-color-scheme: dark)" type="image/x-icon">'
            '</head><body><main>' + old +
            '<article data-testid="conversation-turn-new-user">A question</article>'
            f'<article data-testid="conversation-turn-new-assistant">Answer {index}</article>'
            '<button id="stop" data-testid="stop-button">Stop</button>'
            '</main></body></html>')

def snapshot(page):
    return page.evaluate("""() => ({
      title:document.title,
      icons:[...document.querySelectorAll('link[rel~="icon"]')]
        .map(x=>x.getAttribute('href')||'')
    })""")

def wait_identity(page):
    page.wait_for_function("""() => {
      const icons=[...document.querySelectorAll('link[rel~="icon"]')];
      return icons.length===2 &&
        icons.every(x=>(x.getAttribute('href')||'').startsWith('data:image/png;base64,'));
    }""",timeout=15000)
    found = snapshot(page)
    assert len(set(found['icons'])) == 1, found['title']
    return found['icons'][0]

def wait_status(page, kind, timeout=13000):
    page.wait_for_function("""prefix => document.title.startsWith(prefix)""",
                           arg=PREFIX[kind],timeout=timeout)

def post(page,label):
    page.evaluate("""label => {
      fetch('/backend-api/f/conversation?case='+encodeURIComponent(label),{
        method:'POST', headers:{'content-type':'application/json'},
        body:'{"prompt":"synthetic"}'
      }).catch(()=>{});
    }""",label)

def browser_favicon(worker,page):
    return worker.evaluate("""async url => {
      const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
      return tabs.find(t=>t.url===url)?.favIconUrl||'';
    }""",page.url)

def banner(page,content):
    page.evaluate("""message => {
       const elem=document.createElement('div');
       elem.setAttribute('role','alert');
       elem.className='rounded-lg border-red-500 text-red-500';
       elem.textContent=message;
       document.body.appendChild(elem);
    }""",content)

def head_churn(page):
    return page.evaluate("""async () => {
      const icon=document.querySelector('link[rel="icon"]');
      const before=performance.now();
      for(let i=0;i<200;i++){
        icon.href='/synthetic-favicon-'+i+'.ico';
        const meta=document.createElement('meta');
        document.head.appendChild(meta);meta.remove();
      }
      await new Promise(done=>setTimeout(done,20));
      return performance.now()-before;
    }""")

def main():
    t0=time.monotonic()
    crashed=[]
    requests=[]
    with tempfile.TemporaryDirectory(prefix='tab-signal-disposable-') as tmp:
        with sync_playwright() as playwright:
            launch = {'executable_path':EXECUTABLE} if EXECUTABLE else {'channel':CHANNEL}
            context=playwright.chromium.launch_persistent_context(
                tmp,headless=True,**launch,
                args=['--disable-extensions-except='+str(EXTENSION),
                      '--load-extension='+str(EXTENSION),'--disable-sync',
                      '--no-first-run','--no-default-browser-check',
                      '--no-sandbox','--disable-gpu'])
            def route(r):
                u=urlparse(r.request.url)
                if u.scheme=='chrome-extension':
                    r.continue_()
                elif u.hostname!='chatgpt.com':
                    r.abort()
                elif u.path.startswith('/backend-api/'):
                    case=parse_qs(u.query).get('case',[''])[0]
                    status = 413 if case=='cap-request' else 503 if case=='network-error' else 200
                    requests.append((r.request.method,u.path,status))
                    r.fulfill(status=status,content_type='application/json',body='{"ok":true}')
                elif u.path.startswith('/c/synthetic-'):
                    index=int(u.path.rsplit('-',1)[-1])
                    r.fulfill(status=200,content_type='text/html',body=fixture(index))
                elif u.path.startswith('/g/g-p-synthetic-project/c/'):
                    r.fulfill(status=200,content_type='text/html',body=fixture(90))
                elif u.path.endswith('.ico'):
                    r.fulfill(status=404,body='')
                else:
                    r.abort()
            context.route('**/*',route)
            pages=[]
            project=None
            try:
                for i in range(TABS):
                    p=context.new_page()
                    p.on('crash',lambda _=None,index=i:crashed.append(index))
                    p.goto(f'https://chatgpt.com/c/synthetic-{i}',wait_until='domcontentloaded')
                    pages.append(p)
                project=context.new_page()
                project.goto('https://chatgpt.com/g/g-p-synthetic-project/c/project-chat-90',
                             wait_until='domcontentloaded')
                project_icon=wait_identity(project)
                assert snapshot(project)['title']=='Fixture 90 - ChatGPT'
                assert project_icon!=wait_identity(pages[0])
                project.close()
                project=None
                print('PASS project chat has distinct round PNG favicon; idle title unchanged',flush=True)

                worker=context.service_workers[0] if context.service_workers else (
                    context.wait_for_event('serviceworker',timeout=10000))
                original_icons=[wait_identity(p) for p in pages]
                assert len(set(original_icons))>=12, 'Too many deterministic color collisions'
                assert all(snapshot(p)['title']==f'Fixture {i} - ChatGPT'
                           for i,p in enumerate(pages))
                assert all(snapshot(p)['icons'][0]==original_icons[i]
                           for i,p in enumerate(pages))
                print('PASS deterministic idle colors on 24 tabs with no status prefix',flush=True)

                # First-chat / -> /c/<id> History API promotion is not a reload.
                pages[0].evaluate("history.replaceState({}, '', '/')")
                for i,p in enumerate(pages[:12]):
                    post(p,'active-'+str(i))
                pages[0].evaluate("history.replaceState({}, '', '/c/new-conversation')")
                for p in pages[:12]:
                    p.wait_for_function("""() => /^(?:🔔|✅) /u.test(document.title)""",timeout=14000)
                assert all(snapshot(p)['title']==f'Fixture {i} - ChatGPT'
                           for i,p in enumerate(pages[12:],12))
                assert all(snapshot(p)['icons'][0]==original_icons[i]
                           for i,p in enumerate(pages[1:12],1))
                assert all(snapshot(p)['icons'][0]==original_icons[i]
                           for i,p in enumerate(pages[12:],12))
                print('PASS 12 completions with fixed favicon colors and 12 idle untouched tabs',flush=True)

                for i,p in enumerate(pages[1:12],1):
                    actual=browser_favicon(worker,p)
                    assert actual==original_icons[i], f'Native tab-strip PNG missing on tab {i}'
                print('PASS native browser tab favicons, not merely DOM link candidates',flush=True)
                notifications=worker.evaluate('chrome.notifications.getAll()')
                assert notifications, 'Native completion notification absent'
                first_tab_id=worker.evaluate("""async () => {
                   const all=await chrome.tabs.query({url:'https://chatgpt.com/*'});
                   return all.find(t=>t.url.endsWith('/c/new-conversation'))?.id||-1;
                }""")
                assert first_tab_id>0
                assert any(k.startswith(f'chatgpt-prompt-bound:{first_tab_id}:')
                           for k in notifications), 'First-chat completion dropped'
                offscreen=worker.evaluate("""() => chrome.runtime.getContexts({
                    contextTypes:['OFFSCREEN_DOCUMENT']})""")
                assert offscreen, 'Offscreen sound document missing'
                audio=worker.evaluate("""async () => chrome.runtime.sendMessage({
                    type:'PLAY_COMPLETION_SOUND'})""")
                assert audio.get('ok') and audio.get('rendered') and audio.get('contextState')=='running'
                print('PASS notifications, first-chat URL promotion, Web Audio chime',flush=True)

                manual=pages[0]
                post(manual,'manual-stop')
                wait_status(manual,'generating')
                manual.locator('#stop').click()
                time.sleep(3)
                assert not snapshot(manual)['title'].startswith((PREFIX['unread'],PREFIX['finished']))
                print('PASS manual Stop not treated as finished',flush=True)

                # Synthetic non-2xx network failure.
                failed=pages[1]
                post(failed,'network-error')
                wait_status(failed,'error')
                assert snapshot(failed)['icons'][0]==original_icons[1]
                # Conversation-length cap: distinctly terminal, overriding 413.
                cap=pages[2]
                banner(cap,"You've reached the maximum length for this conversation, but you can keep talking by starting a new chat.")
                post(cap,'cap-request')
                wait_status(cap,'limit')
                assert snapshot(cap)['icons'][0]==original_icons[2]
                # Even with 2xx HTTP, a rendered error is not an answer.
                red=pages[3]
                banner(red,'Message delivery timed out. Please try again.')
                post(red,'red-ui-with-2xx')
                wait_status(red,'error')
                print('PASS network error, conversation cap, and rendered red 2xx error',flush=True)

                for i in range(80):
                    post(manual,f'storm-{i}')
                time.sleep(4)
                assert snapshot(manual)['icons'][0]!= '/favicon.ico'
                assert not snapshot(manual)['title'].startswith(
                    (PREFIX['generating'],PREFIX['unread'],PREFIX['finished']))
                print('PASS event storm fails closed without dropping conversation color',flush=True)

                for i,p in enumerate(pages[12:],12):
                    post(p,'newly-active-'+str(i))
                for i,p in enumerate(pages[12:],12):
                    p.wait_for_function("""() => /^(?:🔔|✅) /u.test(document.title)""",timeout=14000)
                    assert snapshot(p)['icons'][0]==original_icons[i]
                assert not crashed,crashed
                delays=[head_churn(p) for p in pages]
                assert max(delays)<3000,max(delays)
                assert not crashed,crashed
                print(f'PASS {len(pages)} tabs, {len(requests)} POSTs, '
                      f'{200*len(pages)} favicon head edits, no renderer crashes, '
                      f'{time.monotonic()-t0:.1f}s',flush=True)
            finally:
                if project:
                    with contextlib.suppress(Exception):project.close()
                for p in pages:
                    with contextlib.suppress(Exception):p.close()
                context.close()

if __name__=='__main__':
    main()
