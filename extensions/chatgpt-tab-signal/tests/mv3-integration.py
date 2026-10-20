#!/usr/bin/env python3
"""Actual Manifest V3 single-tab opt-in isolation test in disposable Chromium.

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

                # The extension popup is a real chrome-extension:// page.
                # Keep the site tab active before sending commands from it.
                popup=context.new_page()
                popup.goto(worker.url.rsplit('/',1)[0]+'/popup.html',
                           wait_until='domcontentloaded')
                pages[0].bring_to_front()
                before=popup_message(popup,'CHATGPT_TAB_STATUS')
                assert before.get('ok') and not before.get('enabled'), before
                chosen=popup_message(popup,'CHATGPT_ENABLE_ACTIVE_TAB')
                assert chosen.get('ok') and chosen.get('tabId')==before.get('tabId'), (
                    'Popup failed to activate the intended ChatGPT tab',chosen,before)
                assert popup_message(popup,'CHATGPT_TAB_STATUS').get('enabled')

                # All other 23 tabs are still entirely untouched.
                assert all(marker(p)['count']==0 for p in pages[1:]), (
                    'A nonselected tab was injected during activation')
                for i,p in enumerate(pages[1:],1):
                    post(p,f'unselected-{i}')
                time.sleep(1.0)
                assert all(marker(p)['count']==0 for p in pages[1:]), (
                    'Network events touched a nonselected tab')
                print('PASS popup-only activation: 23 other ChatGPT tabs untouched',flush=True)

                post(pages[0],'selected')
                wait_color(pages[0],'94a3b8','selected generation')
                wait_color(pages[0],'16a34a','selected completion')
                notifications=worker.evaluate('chrome.notifications.getAll()')
                assert len(notifications)>=1, 'Actual MV3 notification absent'
                offscreen=worker.evaluate("""() => chrome.runtime.getContexts({
                  contextTypes:['OFFSCREEN_DOCUMENT']})""")
                assert offscreen, 'Actual offscreen audio context absent'
                assert all(marker(p)['count']==0 for p in pages[1:]), (
                    'Other tabs modified after selected tab completion')

                # Clicking Stop suppresses that network request's notification.
                post(pages[0],'manual-stop')
                wait_color(pages[0],'94a3b8','manual stop start')
                pages[0].locator('#stop').click()
                time.sleep(3)
                assert not has_color(pages[0],'16a34a') and not has_color(pages[0],'2563eb'), (
                    'Manually stopped request was reported finished')

                # Storm fails closed on the opted-in tab only.
                for i in range(80):
                    post(pages[0],f'storm-{i}')
                time.sleep(4)
                assert marker(pages[0])['count']<=1
                assert not any(has_color(pages[0],c) for c in ('94a3b8','2563eb','16a34a')), (
                    'Event storm did not fail closed')

                pages[0].bring_to_front()
                disabled=popup_message(popup,'CHATGPT_DISABLE_ACTIVE_TAB')
                assert disabled.get('ok') and not disabled.get('enabled'),disabled
                assert marker(pages[0])['count']==0, (
                    'Disabled tab still has extension favicon')
                post(pages[0],'after-disable')
                time.sleep(3)
                assert marker(pages[0])['count']==0, (
                    'Disabled tab reacted to another network event')
                assert all(marker(p)['count']==0 for p in pages), (
                    'Other tabs were modified')
                assert not crashed,crashed

                times=[head_churn(p) for p in pages]
                assert max(times)<3000, max(times)
                print(f'PASS MV3 isolation: {len(pages)} tabs, {len(requests)} POSTs, '
                      'one opted-in tab, manual Stop, 80-request storm, disable',flush=True)
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
