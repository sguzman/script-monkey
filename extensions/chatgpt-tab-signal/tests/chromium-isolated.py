#!/usr/bin/env python3
"""Disposable Chromium safety smoke test. No real ChatGPT navigation or login.

This is genuine Chromium DOM/timer behavior with the content script injected
into synthetic pages. It is NOT an end-to-end Edge/ChatGPT extension test.
Requires: python -m pip install playwright; python -m playwright install chromium
"""
import os
import pathlib
import tempfile
import time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "content-script.js").read_text(encoding="utf-8")
MAX_TABS = int(os.environ.get("TAB_SIGNAL_QA_TABS", "8"))
assert 1 <= MAX_TABS <= 12, "QA must remain within the bounded 1-12 tab range"

SETUP = """
(() => {
  window.__signalMessages = [];
  window.__observerCreations = 0;
  const OriginalObserver = window.MutationObserver;
  window.MutationObserver = class extends OriginalObserver {
    constructor(callback) {
      window.__observerCreations++;
      super(callback);
    }
  };
  const savedChrome = window.chrome || {};
  savedChrome.runtime = {
    onMessage: {addListener(handler) {window.__dispatchSignal = handler;}},
    sendMessage(message) {window.__signalMessages.push(message); return Promise.resolve({ok:true});}
  };
  window.chrome = savedChrome;
})();
"""

def fixture(turns=0):
    # Older turns are deliberately numerous but contain no confidential data.
    history = "".join(
        f'<section data-testid="conversation-turn-old-{i}" data-turn="assistant">Old reply</section>'
        for i in range(turns)
    )
    return (
        '<!doctype html><html><head><title>Synthetic conversation - ChatGPT</title>'
        '<link rel="icon" type="image/x-icon" href="/favicon.ico"></head>'
        '<body><main>' + history
        + '<section data-testid="conversation-turn-final-user" data-turn="user">Question</section>'
        '<section data-testid="conversation-turn-final-assistant" data-turn="assistant">'
        '<div class="markdown">Completed answer</div></section></main></body></html>'
    )

def begin(page, n):
    page.set_content(fixture(n))
    page.evaluate(SETUP)
    page.add_script_tag(content=SOURCE)
    page.evaluate("""() => {
       __dispatchSignal({type:'CHATGPT_GENERATION_STARTED', requestId:'synthetic-1'});
       __dispatchSignal({type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId:'synthetic-1'});
    }""")

def main():
    started = time.monotonic()
    crashes = []
    with tempfile.TemporaryDirectory(prefix="tab-signal-isolated-") as tempdir:
        # The temporary profile is not the user's Edge profile.
        with sync_playwright() as playwright:
            executable = os.environ.get("CHROMIUM_BIN")
            kwargs = {"headless": True, "args": ["--no-sandbox", "--disable-gpu"]}
            if executable:
                kwargs["executable_path"] = executable
            browser = playwright.chromium.launch(**kwargs)
            browser.on("disconnected", lambda: crashes.append("browser disconnected"))
            pages = []
            try:
                for i in range(MAX_TABS):
                    page = browser.new_page()
                    page.on("crash", lambda _=None, idx=i: crashes.append(f"renderer {idx} crashed"))
                    begin(page, 1200 if i == 0 else 120)
                    pages.append(page)

                # Exercise normal page/head churn on live Chromium DOM. There
                # must be no installed extension MutationObservers to feed back.
                for page in pages:
                    metrics = page.evaluate("""async () => {
                       const original = document.querySelector('link[rel="icon"]');
                       for (let j = 0; j < 150; j++) {
                         original.setAttribute('href', '/favicon-' + j + '.ico');
                         const marker = document.createElement('meta');
                         marker.name = 'unrelated-page-change';
                         document.head.appendChild(marker);
                         marker.remove();
                       }
                       const before = performance.now();
                       await new Promise(resolve => setTimeout(resolve, 40));
                       return {latency: performance.now() - before,
                               observers: window.__observerCreations,
                               title: document.title};
                    }""")
                    assert metrics["observers"] == 0, metrics
                    assert metrics["title"] == "Synthetic conversation - ChatGPT", metrics
                    assert metrics["latency"] < 2000, metrics

                # Actual timer scheduling: completion must not create a
                # permanently active full-document watcher.
                deadline = time.monotonic() + 15
                pending = pages[:]
                while pending and time.monotonic() < deadline:
                    pending = [
                        page for page in pending
                        if page.evaluate("""() => !window.__signalMessages.some(
                            m => m.type === 'CHATGPT_RESPONSE_COMPLETE')""")
                    ]
                    if pending:
                        time.sleep(.5)
                assert not pending, f"{len(pending)} of {len(pages)} fixtures never completed"
                for page in pages:
                    report = page.evaluate("""() => ({
                       completed: __signalMessages.filter(m => m.type === 'CHATGPT_RESPONSE_COMPLETE').length,
                       title: document.title,
                       observers: __observerCreations
                    })""")
                    assert report["completed"] == 1, report
                    assert report["observers"] == 0, report
                    assert report["title"] == "Synthetic conversation - ChatGPT", report

                assert not crashes, crashes
                print(f"PASS isolated Chromium: {len(pages)} tabs, 150 head edits/tab, zero observers, one completion/tab")
                print(f"Elapsed: {time.monotonic() - started:.1f}s")
            finally:
                for page in pages:
                    if not page.is_closed():
                        page.close()
                browser.close()

if __name__ == "__main__":
    main()
