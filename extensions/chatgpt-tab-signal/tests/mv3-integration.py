#!/usr/bin/env python3
"""Actual Manifest V3 global-switch lazy-tab isolation test in disposable Chromium.

All ChatGPT pages and conversation requests are synthetic route fixtures.
No user's Edge profile, real ChatGPT account or conversation is accessed.
"""
import contextlib
import os
import pathlib
import tempfile
import time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

EXTENSION = pathlib.Path(__file__).resolve().parents[1]
TAB_COUNT = int(os.environ.get("TAB_SIGNAL_MV3_TABS", "24"))
assert 3 <= TAB_COUNT <= 32
HEAD_CHURN = 200

def fixture(index):
    old = ''.join('<article data-testid="conversation-turn-old-%d">'
                  'Historical text</article>' % n for n in range(8000 if index == 0 else 40))
    return ('<!doctype html><html><head>'
            f'<title>Fixture {index} - ChatGPT</title>'
            '<link rel="icon" href="/favicon.ico" type="image/x-icon">'
            '</head><body><main>' + old +
            '<article data-testid="conversation-turn-new-user">A question</article>'
            f'<article data-testid="conversation-turn-new-assistant">Answer {index}</article>'
            '<button id="stop" data-testid="stop-button">Stop</button>'
            '</main></body></html>')

def marker(page):
    return page.evaluate("""() => {
      const icons = document.querySelectorAll('link[data-chatgpt-tab-signal="true"]');
      return {count:icons.length,href:icons[0]?.getAttribute('href')||'',
              title:document.title};
    }""")

def has_color(page, color):
    value = marker(page)["href"]
    return color in value or ("%23"+color) in value

def wait_color(page, color, label):
    try:
        page.wait_for_function("""value => {
            const icon=document.querySelector('link[data-chatgpt-tab-signal="true"]');
            return !!icon && (icon.getAttribute('href')||'').includes(value);
        }""", arg=color, timeout=8500)
    except PlaywrightTimeout as exc:
        raise AssertionError(f'{label}: color {color} missing, {marker(page)}') from exc

def post(page, label):
    page.evaluate("""label => {
       fetch('/backend-api/f/conversation?case='+encodeURIComponent(label),{
         method:'POST',headers:{'content-type':'application/json'},
         body:'{"prompt":"synthetic"}'
       }).catch(()=>{});
    }""", label)

def popup_message(popup, kind):
    return popup.evaluate("""kind => chrome.runtime.sendMessage({type:kind})""", kind)

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
    crashed=[]
    requests=[]
    with tempfile.TemporaryDirectory(prefix='tab-signal-mv3-private-') as tmp:
        with sync_playwright() as playwright:
            context=playwright.chromium.launch_persistent_context(
                tmp,channel='chromium',headless=True,
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
            popup=None
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
                    'Automatic content script detected before opt-in')

                # Exercise all 24 ChatGPT tabs BEFORE activation.
                for i,p in enumerate(pages):
                    post(p,f'before-{i}')
                time.sleep(3.0)
                assert all(marker(p)['count']==0 for p in pages), (
                    'Default-off violated: a network event changed an unselected tab')
                assert all(marker(p)['title']==f'Fixture {i} - ChatGPT'
                           for i,p in enumerate(pages))
                print(f'PASS default-off: {len(pages)} tabs, {len(pages)} POSTs, zero injected favicons',flush=True)

                # One switch makes all ChatGPT tabs eligible, but no page
                # receives an injected script until it sends a conversation POST.
                popup=context.new_page()
                popup.goto(worker.url.rsplit('/',1)[0]+'/popup.html',
                           wait_until='domcontentloaded')
                before=popup_message(popup,'CHATGPT_GLOBAL_STATUS')
                assert before.get('ok') and not before.get('enabled'),before
                turned_on=popup_message(popup,'CHATGPT_GLOBAL_ENABLE')
                assert turned_on.get('ok') and turned_on.get('enabled'),turned_on
                assert all(marker(p)['count']==0 for p in pages), (
                    'Global enable eagerly injected into idle tabs')
                print(f'PASS global enable: one click, {len(pages)} idle tabs untouched',flush=True)

                # Exercise twelve active ChatGPT tabs without twelve clicks.
                # The remaining twelve idle tabs must NEVER be injected.
                active=pages[:12]
                for i,p in enumerate(active):
                    post(p,f'active-{i}')
                for i,p in enumerate(active):
                    try:
                        p.wait_for_function("""() => {
                            const icon=document.querySelector('link[data-chatgpt-tab-signal="true"]');
                            return !!icon && /2563eb|16a34a/.test(icon.getAttribute('href')||'');
                        }""",timeout=13000)
                    except PlaywrightTimeout as exc:
                        raise AssertionError(f'Lazy response {i} did not finish: {marker(p)}') from exc
                assert all(marker(p)['count']==1 for p in active), (
                    'Active tab missing exactly one dynamic icon')
                assert all(marker(p)['count']==0 for p in pages[12:]), (
                    'Idle tabs were modified while active tabs completed')
                assert all(marker(p)['title']==f'Fixture {i} - ChatGPT'
                           for i,p in enumerate(pages)), 'Conversation title changed'
                notifications=worker.evaluate('chrome.notifications.getAll()')
                assert notifications,'Real browser notifications were not registered'
                offscreen=worker.evaluate("""() => chrome.runtime.getContexts({
                  contextTypes:['OFFSCREEN_DOCUMENT']})""")
                assert offscreen, 'Offscreen audio context was not created'
                print('PASS lazy injection: 12 simultaneous responses, 12 untouched idle tabs',flush=True)

                # A second response reuses the injected content script.
                post(pages[1],'second-request')
                time.sleep(3)
                assert marker(pages[1])['count']==1, 'Duplicate favicon link'

                # Manual Stop must suppress late completion from the POST.
                manual=pages[0]
                post(manual,'manual-stop')
                wait_color(manual,'94a3b8','manual stop generating')
                manual.locator('#stop').click()
                time.sleep(3)
                assert not has_color(manual,'16a34a') and not has_color(manual,'2563eb'), (
                    'Stop incorrectly reported completion')

                # Burst 80 requests into one active tab. The per-tab cutout
                # must discard the storm without touching other tab state.
                for i in range(80):
                    post(manual,f'storm-{i}')
                time.sleep(4)
                assert not any(has_color(manual,c) for c in ('94a3b8','2563eb','16a34a')), (
                    'Lifecycle storm left active favicon')
                assert all(marker(p)['count']==0 for p in pages[12:]), (
                    'Storm affected idle tabs')
                print('PASS manual Stop and 80-POST burst fail closed',flush=True)

                # One click disables every injected tab, no per-tab cleanup
                # workflow and no need to refresh any existing tab.
                turned_off=popup_message(popup,'CHATGPT_GLOBAL_DISABLE')
                assert turned_off.get('ok') and not turned_off.get('enabled'),turned_off
                assert all(marker(p)['count']==0 for p in pages), (
                    'Global disable left an injected favicon marker')
                for i,p in enumerate(pages):
                    post(p,f'disabled-{i}')
                time.sleep(2)
                assert all(marker(p)['count']==0 for p in pages), (
                    'Global off allowed a network request to mutate a tab')
                print('PASS global disable: all 24 tabs idle and untouched',flush=True)

                # Re-enabling does not inject idle pages; existing injected
                # content can resume only when that page sends a new POST.
                again=popup_message(popup,'CHATGPT_GLOBAL_ENABLE')
                assert again.get('enabled'),again
                assert all(marker(p)['count']==0 for p in pages)
                post(pages[1],'resume-after-global-off')
                try:
                    pages[1].wait_for_function("""() => {
                        const icon=document.querySelector('link[data-chatgpt-tab-signal="true"]');
                        return !!icon && /2563eb|16a34a/.test(icon.getAttribute('href')||'');
                    }""",timeout=12000)
                except PlaywrightTimeout as exc:
                    raise AssertionError('Existing page not reactivated after global on') from exc
                assert all(marker(p)['count']==0 for i,p in enumerate(pages) if i!=1), (
                    'Re-enabling unexpectedly touched idle tabs')
                popup_message(popup,'CHATGPT_GLOBAL_DISABLE')
                assert all(marker(p)['count']==0 for p in pages)
                assert not crashed,crashed

                times=[head_churn(p) for p in pages]
                assert max(times)<3000, max(times)
                print(f'PASS MV3 global lazy mode: {len(pages)} tabs, {len(requests)} POSTs, '
                      'twelve activated by requests, manual Stop, storm and global disable',flush=True)
                print(f'PASS head churn: {200*len(pages)} modifications, zero crashes, '
                      f'max {max(times):.1f} ms, elapsed {time.monotonic()-t0:.1f}s',
                      flush=True)
            finally:
                if popup is not None:
                    with contextlib.suppress(Exception):popup.close()
                for page in pages:
                    with contextlib.suppress(Exception):page.close()
                context.close()

if __name__=='__main__':
    main()
