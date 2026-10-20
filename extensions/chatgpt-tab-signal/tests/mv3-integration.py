#!/usr/bin/env python3
"""Actual Manifest V3 automatic per-request lazy-tab test in disposable Chromium.

All ChatGPT pages and conversation requests are synthetic route fixtures.
No existing browser profile, account, or real conversation is accessed.
"""
import contextlib
import os
import pathlib
import re
import tempfile
import time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

EXTENSION = pathlib.Path(__file__).resolve().parents[1]
BROWSER_CHANNEL = os.environ.get("TAB_SIGNAL_BROWSER_CHANNEL", "chromium")
BROWSER_EXECUTABLE = os.environ.get("TAB_SIGNAL_BROWSER_EXECUTABLE", "")
assert BROWSER_CHANNEL in ("chromium", "msedge", "chrome"), "Unsupported test browser"
TAB_COUNT = int(os.environ.get("TAB_SIGNAL_MV3_TABS", "24"))
assert 3 <= TAB_COUNT <= 32
HEAD_CHURN = 200
ICON_SOURCE = (EXTENSION / 'content-script.js').read_text()
PNG_ICONS = {
    name: 'data:image/png;base64,' + data
    for name, data in re.findall(
        r"(generating|unread|finished): 'data:image/png;base64,([A-Za-z0-9+/=]+)'",
        ICON_SOURCE
    )
}
assert set(PNG_ICONS) == {'generating', 'unread', 'finished'}
COLOR_STATES = {'94a3b8':'generating', '2563eb':'unread', '16a34a':'finished'}

def fixture(index):
    old = ''.join('<article data-testid="conversation-turn-old-%d">'
                  'Historical text</article>' % n for n in range(8000 if index == 0 else 40))
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

def marker(page):
    return page.evaluate("""() => {
      const icons = [...document.querySelectorAll('link[rel~="icon"]')];
      const hrefs = icons.map(icon => icon.getAttribute('href')||'');
      return {count:hrefs.filter(h => h.startsWith('data:image/png;base64,')).length,
              iconCount:icons.length, href:hrefs[0]||'', hrefs,
              title:document.title};
    }""")

def has_color(page, color):
    return marker(page)["href"] == PNG_ICONS[COLOR_STATES[color]]

def browser_favicon(worker, page, label):
    # The native browser-reported favIconUrl verifies what the tab strip
    # displays. A DOM <link rel="icon"> alone is not proof of a visible icon.
    target_url = page.url
    candidates = worker.evaluate("""async url => {
      const all = await chrome.tabs.query({url:'https://chatgpt.com/*'});
      return all.filter(tab => tab.url===url).map(tab => ({
        id:tab.id, favIconUrl:tab.favIconUrl||''
      }));
    }""", target_url)
    if len(candidates) != 1:
        raise AssertionError(f"{label}: native tab lookup ambiguous: {candidates}")
    return candidates[0]['favIconUrl']

def wait_color(page, color, label):
    try:
        page.wait_for_function("""value => {
            const icons=[...document.querySelectorAll('link[rel~="icon"]')];
            return icons.length===2 &&
                icons.every(icon => icon.getAttribute('href')===value);
        }""", arg=PNG_ICONS[COLOR_STATES[color]], timeout=8500)
    except PlaywrightTimeout as exc:
        raise AssertionError(f'{label}: color {color} missing, {marker(page)}') from exc

def post(page, label):
    page.evaluate("""label => {
       fetch('/backend-api/f/conversation?case='+encodeURIComponent(label),{
         method:'POST',headers:{'content-type':'application/json'},
         body:'{"prompt":"synthetic"}'
       }).catch(()=>{});
    }""", label)

def head_churn(page):
    return page.evaluate("""async () => {
      const original=document.querySelector('link[rel="icon"]:not([data-chatgpt-tab-signal])');
      const t0=performance.now();
      for(let i=0;i<200;i++){
        original.href='/synthetic-favicon-'+i+'.ico';
        const meta=document.createElement('meta');
        meta.name='synthetic';
        document.head.appendChild(meta);
        meta.remove();
      }
      await new Promise(done=>setTimeout(done,20));
      return performance.now()-t0;
    }""")

def main():
    t0=time.monotonic()
    print(f"Testing actual unpacked MV3 extension in {BROWSER_CHANNEL}" +
          (" (Chrome for Testing)" if BROWSER_EXECUTABLE else ""), flush=True)
    crashed=[]
    requests=[]
    with tempfile.TemporaryDirectory(prefix='tab-signal-mv3-private-') as tmp:
        with sync_playwright() as playwright:
            launch_browser = (
                {'executable_path': BROWSER_EXECUTABLE} if BROWSER_EXECUTABLE
                else {'channel': BROWSER_CHANNEL}
            )
            context=playwright.chromium.launch_persistent_context(
                tmp,headless=True,**launch_browser,
                args=['--disable-extensions-except='+str(EXTENSION),
                      '--load-extension='+str(EXTENSION),'--disable-sync',
                      '--no-first-run','--no-default-browser-check',
                      '--no-sandbox','--disable-gpu'])
            def route(r):
                u=urlparse(r.request.url)
                if u.scheme=='chrome-extension':
                    r.continue_()
                elif u.hostname != 'chatgpt.com':
                    r.abort()
                elif u.path.startswith('/backend-api/'):
                    requests.append((r.request.method,u.path))
                    r.fulfill(status=200,content_type='application/json',body='{"ok":true}')
                elif u.path.startswith('/c/synthetic-'):
                    i=int(u.path.rsplit('-',1)[-1])
                    r.fulfill(status=200,content_type='text/html',body=fixture(i))
                elif u.path.endswith('.ico'):
                    r.fulfill(status=404,body='')
                else:
                    r.abort()
            context.route('**/*',route)
            pages=[]
            try:
                for i in range(TAB_COUNT):
                    page=context.new_page()
                    page.on('crash',lambda _=None,i=i:crashed.append(i))
                    page.goto(f'https://chatgpt.com/c/synthetic-{i}',
                              wait_until='domcontentloaded')
                    pages.append(page)

                worker=context.service_workers[0] if context.service_workers else (
                    context.wait_for_event('serviceworker',timeout=10000))
                assert 'service-worker.js' in worker.url
                assert all(marker(p)['count']==0 for p in pages), (
                    'Color-only injection must not touch favicon before a POST')

                # No popup, switch, or tab-by-tab setup. A ChatGPT POST from
                # a tab is the sole trigger for lazy activation.
                # CI-only event trace to diagnose ChatGPT's SPA transitions.
                # No logging or instrumentation is added to the extension.
                worker.evaluate("""() => {
                    globalThis.__signalTrace=[];
                    chrome.tabs.onUpdated.addListener((id,info) => {
                        globalThis.__signalTrace.push({type:'tab-update',id,info});
                    });
                    const filter={urls:['https://chatgpt.com/backend-api/f/conversation*']};
                    chrome.webRequest.onBeforeRequest.addListener(d => {
                        globalThis.__signalTrace.push({type:'start',id:d.tabId,requestId:d.requestId});
                    },filter);
                    chrome.webRequest.onCompleted.addListener(d => {
                        globalThis.__signalTrace.push({type:'complete',id:d.tabId,requestId:d.requestId,status:d.statusCode});
                    },filter);
                    chrome.webRequest.onErrorOccurred.addListener(d => {
                        globalThis.__signalTrace.push({type:'abort',id:d.tabId,requestId:d.requestId});
                    },filter);
                }""")
                assert all(marker(p)['count']==0 for p in pages), (
                    'Installation changed an idle favicon')

                active=pages[:12]
                # First-message flow: ChatGPT can transition / -> /c/<id>
                # without changing the document. A URL-only tabs.onUpdated
                # event must not silently discard the response notification.
                pages[0].evaluate("history.replaceState({}, '', '/')")
                for i,p in enumerate(active):
                    post(p,f'active-{i}')
                pages[0].evaluate("history.replaceState({}, '', '/c/new-conversation')")
                for i,p in enumerate(active):
                    try:
                        p.wait_for_function("""values => {
                            const icons=[...document.querySelectorAll('link[rel~="icon"]')];
                            return icons.length===2 &&
                              icons.every(icon => values.includes(icon.getAttribute('href')||''));
                        }""", arg=[PNG_ICONS['unread'],PNG_ICONS['finished']], timeout=13000)
                    except PlaywrightTimeout as exc:
                        raise AssertionError(
                            f'Automatic activation failed on tab {i}: {marker(p)}') from exc
                assert all(marker(p)['count']==2 and marker(p)['iconCount']==2
                           for p in active), (
                    'All existing favicon candidates must be replaced in place')
                assert all(marker(p)['count']==0 for p in pages[12:]), (
                    'Conversation activity in other tabs touched idle tabs')
                # Colored emoji prefixes are separate from the status favicon;
                # every chat gets one even before sending a request.
                assert all(marker(p)['title'].endswith(f'Fixture {i} - ChatGPT')
                           and marker(p)['title'] != f'Fixture {i} - ChatGPT'
                           for i,p in enumerate(pages)), (
                    'Every chat title must have a deterministic color marker')
                assert all(marker(p)['iconCount']==2 for p in pages), (
                    'Title color must never add or remove favicon links')
                print('PASS 24 idle/active conversation title colors without favicon changes',flush=True)
                # Assert real browser tab state, not merely a marker link
                # inserted in the document. Dynamic favicons may be ignored.
                for i,p in enumerate(active):
                    actual=browser_favicon(worker,p,f'active-{i}')
                    if actual not in (PNG_ICONS['unread'], PNG_ICONS['finished']):
                        raise AssertionError(f'Native tab favicon missing state for active-{i}: {actual[:180]!r}')
                print('PASS browser native PNG favicons: 12 tabs, two existing link candidates each, no new links',flush=True)
                print('PASS automatic activation: 12 responding tabs, 12 untouched idle tabs', flush=True)

                notifications=worker.evaluate('chrome.notifications.getAll()')
                assert len(notifications)>=1, 'Real MV3 native notification absent'
                first_tab_id=worker.evaluate("""async () => {
                    const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
                    return tabs.find(t => t.title.endsWith('Fixture 0 - ChatGPT'))?.id ?? -1;
                }""")
                assert first_tab_id > 0, 'New conversation tab ID not found'
                first_notification_found=any(
                    key.startswith(f'chatgpt-prompt-bound:{first_tab_id}:')
                    for key in notifications
                )
                if not first_notification_found:
                    print('SPA DEBUG tab:', first_tab_id,flush=True)
                    print('SPA DEBUG alerts:', list(notifications),flush=True)
                    print('SPA DEBUG injected:', worker.evaluate(
                        """async id => chrome.storage.session.get('chatgptTabSignalInjected:'+id)""",
                        first_tab_id),flush=True)
                    print('SPA DEBUG events:', worker.evaluate(
                        'globalThis.__signalTrace.slice(0,140)'),flush=True)
                assert first_notification_found, (
                    'First-chat completion notification was dropped on SPA URL promotion')
                print('PASS SPA first-chat URL transition retained completion notification',flush=True)
                offscreen=worker.evaluate("""() => chrome.runtime.getContexts({
                    contextTypes:['OFFSCREEN_DOCUMENT']})""")
                assert offscreen, 'Offscreen audio context absent'
                # Force one audio-only playback in the already-open offscreen
                # document and require a completed, advancing Web Audio clock.
                # A created AudioContext alone does not establish playback.
                audio_result=worker.evaluate("""async () =>
                    await chrome.runtime.sendMessage({type:'PLAY_COMPLETION_SOUND'})
                """)
                assert audio_result.get('ok') and audio_result.get('rendered') and (
                    audio_result.get('contextState')=='running'
                ), 'Audio rendering failed: '+str(audio_result)
                print('PASS Web Audio: two-tone playback rendered to running audio context',flush=True)
                print('PASS native notification and offscreen audio rendering',flush=True)

                # Send another request in an already injected tab.
                post(pages[1],'second-request')
                time.sleep(3)
                assert marker(pages[1])['count']==2 and marker(pages[1])['iconCount']==2, (
                    'Already-active tab duplicated or dropped a favicon declaration')

                manual=pages[0]
                post(manual,'manual-stop')
                wait_color(manual,'94a3b8','manual stop generation')
                manual.locator('#stop').click()
                time.sleep(3)
                assert not has_color(manual,'16a34a') and not has_color(manual,'2563eb'), (
                    'Manual Stop was incorrectly treated as a completion')

                for i in range(80):
                    post(manual,f'storm-{i}')
                time.sleep(4)
                assert not any(has_color(manual,c) for c in
                               ('94a3b8','2563eb','16a34a')), (
                    'Request storm did not fail closed')
                assert all(marker(p)['count']==0 for p in pages[12:]), (
                    'Request storm touched another idle tab')
                print('PASS manual Stop and 80-POST storm',flush=True)

                # All 24 tabs are eligible with zero setup actions. The
                # previously idle twelve activate only upon their own POSTs.
                for i,p in enumerate(pages[12:],12):
                    post(p,f'newly-active-{i}')
                for i,p in enumerate(pages[12:],12):
                    try:
                        p.wait_for_function("""values => {
                            const icons=[...document.querySelectorAll('link[rel~="icon"]')];
                            return icons.length===2 &&
                              icons.every(icon => values.includes(icon.getAttribute('href')||''));
                        }""",arg=[PNG_ICONS['unread'],PNG_ICONS['finished']],timeout=13000)
                    except PlaywrightTimeout as exc:
                        raise AssertionError(
                            f'Previously idle tab {i} failed activation: {marker(p)}') from exc
                # Tab 0 deliberately exceeded the request-event budget,
                # so it must remain idle with its two original favicon links.
                assert marker(pages[0])['count']==0 and marker(pages[0])['iconCount']==2, (
                    'Stormed tab did not restore its original favicon candidates')
                assert all(marker(p)['count']==2 and marker(p)['iconCount']==2
                           for p in pages[1:]), (
                    'Every non-stormed active tab must override both icon candidates')
                assert not crashed,crashed

                print(f'PASS MV3 automatic activation: {len(pages)} tabs, '
                      f'{len(requests)} POSTs, no popup, no setup controls, '
                      'no renderer crashes',flush=True)

                times=[head_churn(p) for p in pages]
                assert max(times)<3000, max(times)
                print(f'PASS head churn: {200*len(pages)} modifications, zero crashes, '
                      f'max {max(times):.1f} ms, elapsed {time.monotonic()-t0:.1f}s',
                      flush=True)
            finally:
                for page in pages:
                    with contextlib.suppress(Exception):page.close()
                context.close()

if __name__=='__main__':
    main()
