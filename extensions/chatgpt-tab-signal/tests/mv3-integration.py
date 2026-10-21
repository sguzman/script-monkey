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
          "interrupted":"🔌 ", "error":"⚠️ ", "limit":"🛑 ",
          "response_load_failed":"❌ ", "conversation_load_failed":"🚫 "}

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
    # Only read a color after the bounded worker has allocated this active
    # chat's swatch. Do not accidentally sample a momentary fallback icon.
    page.wait_for_function("""() =>
      document.documentElement.dataset.chatgptTabSignalColorResolved === 'v2'
    """,timeout=15000)
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

def post(page,label,intent=False):
    page.evaluate("""({label,intent}) => {
      if (intent) {
        let button=document.getElementById('synthetic-send-button');
        if (!button) {
          button=document.createElement('button');
          button.id='synthetic-send-button';
          button.dataset.testid='send-button';
          button.textContent='Send';
          document.body.appendChild(button);
        }
        button.click();
      }
      fetch('/backend-api/f/conversation?case='+encodeURIComponent(label),{
        method:'POST', headers:{'content-type':'application/json'},
        body:'{"prompt":"synthetic"}'
      }).catch(()=>{});
    }""",{'label':label,'intent':intent})

def browser_favicon(worker,page):
    return worker.evaluate("""async url => {
      const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
      return tabs.find(t=>t.url===url)?.favIconUrl||'';
    }""",page.url)

def banner(page,content,cls='rounded-lg border-red-500 text-red-500'):
    page.evaluate("""({message,cls}) => {
       const elem=document.createElement('div');
       elem.setAttribute('role','status');
       elem.className=cls;
       elem.textContent=message;
       document.body.appendChild(elem);
    }""",{'message':content,'cls':cls})

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
                elif u.path == '/c/failure-synthetic':
                    r.fulfill(status=200,content_type='text/html',
                      body='<!doctype html><html><head><title>Failed page - ChatGPT</title>'
                      '</head><body><main><h1>Could not load this ChatGPT conversation'
                      '</h1><button>Retry</button></main></body></html>')
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
                assert len(set(original_icons))==len(original_icons), (
                    'All simultaneously open synthetic chats require distinct favicons')
                colors=[p.evaluate("""() => document.documentElement.style.getPropertyValue(
                    '--chatgpt-tab-signal-identity-hex-v2')""") for p in pages]
                assert len(set(colors))==len(colors) and all(c.startswith('#') for c in colors), (
                    'Each browser page publishes the same assigned hex as its PNG identity')
                assert all(snapshot(p)['title']==f'Fixture {i} - ChatGPT'
                           for i,p in enumerate(pages))
                assert all(snapshot(p)['icons'][0]==original_icons[i]
                           for i,p in enumerate(pages))
                print('PASS 24 perceptually selected, collision-free idle colors and public hex',flush=True)

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
                # The completion notification must use the matching tab color,
                # rather than the previous generic ChatGPT notification icon.
                second_tab_id=worker.evaluate("""async () => {
                   const all=await chrome.tabs.query({url:'https://chatgpt.com/*'});
                   return all.find(t=>t.url.endsWith('/c/synthetic-1'))?.id||-1;
                }""")
                assert second_tab_id>0
                matching=[v for k,v in notifications.items() if
                          k.startswith(f'chatgpt-prompt-bound:{second_tab_id}:')]
                assert matching, 'Synthetic tab 1 never emitted a completion alert'
                # Chromium's notifications.getAll() returns id -> boolean,
                # not NotificationOptions. The iconUrl argument is verified
                # separately in the worker API simulation, not invented here.
                assert all(v is True for v in matching), (
                    'Native notification did not remain registered')
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

                # Repeated incidental POSTs after a completed answer must
                # not demote the status to thinking or notify again.
                stable=pages[10]
                stable_title=snapshot(stable)['title']
                stable_icon=snapshot(stable)['icons']
                stable_id=worker.evaluate("""async url => {
                  const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
                  return tabs.find(t=>t.url===url)?.id;
                }""",stable.url)
                notice_before=worker.evaluate('chrome.notifications.getAll()')
                for i in range(6):
                    post(stable,f'incidental-{i}')
                time.sleep(6)
                assert snapshot(stable)['title']==stable_title, (
                    'Incidental POST demoted a finished chat to thinking')
                assert snapshot(stable)['icons']==stable_icon, (
                    'Incidental POST changed the completed conversation favicon')
                notice_after=worker.evaluate('chrome.notifications.getAll()')
                assert not any(k not in notice_before and
                  k.startswith(f'chatgpt-prompt-bound:{stable_id}:')
                  for k in notice_after), (
                    'Incidental request generated duplicate notification')
                post(stable,'explicit-new-prompt',intent=True)
                try:
                    wait_status(stable,'generating')
                except Exception as exc:
                    info=worker.evaluate("""async id => ({
                      session: await chrome.storage.session.get(
                        'chatgptTabSignalRequest:'+id),
                      alerts: await chrome.notifications.getAll()
                    })""",stable_id)
                    raise AssertionError(
                        'Explicit Send did not start generation. '+
                        str({'tab':snapshot(stable),'worker':info})) from exc
                wait_status(stable,'unread')
                print('PASS stable completed response ignores incidental POST, allows new Send',flush=True)

                manual=pages[0]
                post(manual,'manual-stop',intent=True)
                wait_status(manual,'generating')
                manual.locator('#stop').click()
                time.sleep(3)
                assert not snapshot(manual)['title'].startswith((PREFIX['unread'],PREFIX['finished']))
                print('PASS manual Stop not treated as finished',flush=True)

                # An unprompted failed POST after a completed answer must
                # not overwrite its status. This reproduces the user's
                # completed-answer / false-warning failure mode.
                failed=pages[1]
                post(failed,'network-error')
                try:
                    failed.wait_for_function("""() =>
                        document.title.startsWith('🔔 ') ||
                        document.title.startsWith('✅ ')
                    """,timeout=13000)
                except Exception as exc:
                    raise AssertionError(
                        'Secondary failed request did not restore success status: ' +
                        snapshot(failed)['title']) from exc
                time.sleep(0.8)
                assert snapshot(failed)['title'].startswith(
                    (PREFIX['unread'],PREFIX['finished'])), (
                    'Secondary failed request incorrectly marked chat as error')

                # A genuinely new user prompt that fails still reports an
                # error even when an earlier answer was successful.
                failed.evaluate("""() => {
                    const b=document.createElement('button');
                    b.dataset.testid='send-button';
                    b.textContent='Send';
                    document.body.appendChild(b);
                }""")
                failed.locator('[data-testid="send-button"]').click()
                post(failed,'network-error',intent=True)
                failed.wait_for_function("""() =>
                  document.documentElement.dataset.chatgptTabSignalState === 'idle'
                """,timeout=13000)
                time.sleep(2.0)
                assert not snapshot(failed)['title'].startswith(PREFIX['error']), (
                  'Failed POST without visible error produced a false warning')
                # A newly rendered delivery-timeout banner still qualifies.
                failed.locator('[data-testid="send-button"]').click()
                post(failed,'network-error',intent=True)
                banner(failed,'Message delivery timed out. Please try again.')
                wait_status(failed,'error')
                assert snapshot(failed)['icons'][0]==original_icons[1]
                # Neutral connection interruption means waiting, not an answer.
                interrupted=pages[5]
                post(interrupted,'interruption-synthetic',intent=True)
                wait_status(interrupted,'generating')
                banner(interrupted,'Connection interrupted. Waiting for the complete answer',
                       'rounded-lg border-neutral-600')
                wait_status(interrupted,'interrupted')
                assert snapshot(interrupted)['icons'][0]==original_icons[5]
                print('PASS neutral connection interruption has distinct state',flush=True)

                # A single assistant-render placeholder is not a
                # whole-conversation page failure.
                response_failed=pages[6]
                response_failed.evaluate("""() => {
                    window.__signalChanges=0;
                    document.documentElement.addEventListener(
                      'chatgpt-tab-signal-change',()=>window.__signalChanges++);
                    const failed=document.createElement('div');
                    failed.setAttribute('data-message-author-role','assistant');
                    failed.id='synthetic-response-error';
                    failed.textContent='This response couldn’t load';
                    document.querySelector('main').appendChild(failed);
                    window.dispatchEvent(new Event('pageshow'));
                }""")
                wait_status(response_failed,'response_load_failed')
                assert response_failed.evaluate("""() =>
                    document.documentElement.dataset.chatgptTabSignalState ===
                      'response_load_failed' &&
                    document.documentElement.dataset.chatgptTabSignalColor &&
                    document.documentElement.dataset.chatgptTabSignalApiVersion === '1' &&
                    window.__signalChanges > 0
                """),'Missing public state/color attributes or change event'
                response_failed.evaluate("""() => {
                    document.getElementById('synthetic-response-error').remove();
                    window.dispatchEvent(new Event('pageshow'));
                }""")
                response_failed.wait_for_function("""() =>
                  document.documentElement.dataset.chatgptTabSignalState === 'idle'
                """)
                print('PASS individual response failure, recovery, public API',flush=True)

                failed_shell=context.new_page()
                failed_shell.goto('https://chatgpt.com/c/failure-synthetic',
                                  wait_until='domcontentloaded')
                wait_status(failed_shell,'conversation_load_failed')
                assert failed_shell.evaluate("""() =>
                  document.documentElement.dataset.chatgptTabSignalState ===
                    'conversation_load_failed'
                """)
                failed_shell.close()
                print('PASS fatal conversation load screen without a network POST',flush=True)

                # Conversation-length cap: distinctly terminal, overriding 413.
                cap=pages[2]
                banner(cap,"You've reached the maximum length for this conversation, but you can keep talking by starting a new chat.")
                post(cap,'cap-request',intent=True)
                wait_status(cap,'limit')
                assert snapshot(cap)['icons'][0]==original_icons[2]
                # Even with 2xx HTTP, a rendered error is not an answer.
                red=pages[3]
                post(red,'red-ui-with-2xx',intent=True)
                wait_status(red,'generating')
                banner(red,'Message delivery timed out. Please try again.')
                wait_status(red,'error')
                print('PASS network error, conversation cap, and rendered red 2xx error',flush=True)

                # Regression for the live false-positive report: an innocuous
                # red UI surface must never block a successful response,
                # especially when the conversation tab is in the foreground.
                focused=pages[4]
                focused.bring_to_front()
                assert focused.evaluate('document.hasFocus() && document.visibilityState==="visible"')
                focused_id=worker.evaluate("""async url => {
                    const all=await chrome.tabs.query({url:'https://chatgpt.com/*'});
                    return all.find(t=>t.url===url)?.id||-1;
                }""",focused.url)
                assert focused_id>0
                prior=set(worker.evaluate('chrome.notifications.getAll()'))
                banner(focused,'Benign red styled status without an actual error')
                post(focused,'foreground-red-decoy',intent=True)
                wait_status(focused,'generating')
                wait_status(focused,'finished')
                # Wait for the notification from THIS request, not the prior
                # successful response's pre-existing checked title.
                deadline=time.monotonic()+8
                latest={}
                while time.monotonic()<deadline:
                    latest=worker.evaluate('chrome.notifications.getAll()')
                    if any(k not in prior and
                           k.startswith(f'chatgpt-prompt-bound:{focused_id}:')
                           for k in latest):
                        break
                    time.sleep(.15)
                assert any(k not in prior and
                           k.startswith(f'chatgpt-prompt-bound:{focused_id}:')
                           for k in latest), (
                    f'Focused completion missed new alert: {snapshot(focused)["title"]}, '
                    f'prior={list(prior)}, latest={list(latest)}')
                assert snapshot(focused)['icons'][0]==original_icons[4]
                print('PASS foreground completion + harmless red UI: viewed emoji and native alert',flush=True)

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
                # In-place update: reinject the current scripts without
                # navigating the tab. The two versioned owners must be
                # idempotent and title churn must not cause a repair storm.
                upgraded=pages[18]
                url_before=upgraded.url
                title_before=snapshot(upgraded)['title']
                upgraded_id=worker.evaluate("""async url => {
                    const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
                    return tabs.find(t=>t.url===url)?.id;
                }""",url_before)
                assert upgraded_id, 'Could not find synthetic tab to hot-upgrade'
                upgraded.evaluate("""() => {
                    window.__upgradeTitleWrites=[];
                    const node=document.head.querySelector('title');
                    new MutationObserver(() =>
                      window.__upgradeTitleWrites.push(document.title))
                      .observe(node,{childList:true,characterData:true,subtree:true});
                }""")
                worker.evaluate("""async id => {
                    for(let i=0;i<2;i++) await chrome.scripting.executeScript({
                      target:{tabId:id},
                      files:['conversation-color.js','chat-color-title.js','content-script.js']
                    });
                }""",upgraded_id)
                assert upgraded.url==url_before, 'Update navigated existing tab'
                assert snapshot(upgraded)['title']==title_before, (
                    'Same-build update changed a settled conversation title')
                # Explicitly put this tab in a non-idle status to ensure
                # the title repair path has work to do.
                post(upgraded,'hot-upgrade-response')
                wait_status(upgraded,'generating')
                upgraded.wait_for_function("""() =>
                    /^(?:🔔|✅) /u.test(document.title)""",timeout=14000)
                upgraded.evaluate("""() => {
                    window.__upgradeTitleWrites=[];
                    for(let i=0;i<70;i++)document.title='React rapid '+i;
                }""")
                upgraded.wait_for_function("""() =>
                    document.title.includes('React rapid 69') &&
                    /^(?:🔔|✅) /u.test(document.title)
                """,timeout=5000)
                writes=upgraded.evaluate('window.__upgradeTitleWrites')
                repairs=sum(x.startswith(('🔔 ', '✅ ')) for x in writes)
                assert repairs<=2, (
                    f'Title observer fought React repeatedly: {repairs} repairs')
                assert upgraded.url==url_before
                print('PASS hot reinjection without tab reload and debounced title repair',flush=True)

                # Switching between healthy chats must not mutate their
                # title or assigned favicon repeatedly.
                focusPair=pages[16:18]
                for target in focusPair:
                    target.bring_to_front()
                stable=[snapshot(target) for target in focusPair]
                for _ in range(12):
                    for idx,target in enumerate(focusPair):
                        target.bring_to_front()
                        current=snapshot(target)
                        assert current['title']==stable[idx]['title'], (
                            'Tab focus changed a stable title')
                        assert current['icons']==stable[idx]['icons'], (
                            'Tab focus changed a confirmed favicon color')
                assert stable[0]['icons'][0]!=stable[1]['icons'][0], (
                    'Distinct neighboring chats acquired the same swatch')
                print('PASS repeat tab focus keeps titles and colors stable',flush=True)

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
