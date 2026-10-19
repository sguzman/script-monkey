#!/usr/bin/env python3
"""Actual unpacked MV3 extension in an isolated Chromium browser.

Navigates only to intercepted, locally fulfilled https://chatgpt.com fixtures.
No user accounts, cookies, real ChatGPT network requests or existing profiles.
Tests real content-script injection + background webRequest routing, not mocks.
"""
import contextlib
import os
import pathlib
import tempfile
import time
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

EXTENSION = pathlib.Path(__file__).resolve().parents[1]
TAB_COUNT = int(os.environ.get("TAB_SIGNAL_MV3_TABS", "12"))
assert 2 <= TAB_COUNT <= 32, "Constrain synthetic tab count to 2-32"
TIMEOUT_MS = 18000
HEAD_CHURN = 200

def fixture(index, old_turns=50):
    previous = "".join(
        f'<article data-testid="conversation-turn-{j}" data-turn="assistant">'
        'An older reply</article>' for j in range(old_turns)
    )
    return f"""<!doctype html><html><head>
      <title>Fixture {index} - ChatGPT</title>
      <link rel="icon" href="/favicon.ico" type="image/x-icon">
      </head><body><main>{previous}
      <article data-testid="conversation-turn-new-user" data-turn="user">
        A new question</article>
      <article data-testid="conversation-turn-new-assistant" data-turn="assistant">
        <div class="markdown">The final answer for fixture {index}.</div>
      </article>
      <button data-testid="stop-button" id="stop">Stop generation</button>
      </main></body></html>"""

def status(page):
    return page.evaluate("""() => {
      const signal = document.querySelector('link[data-chatgpt-tab-signal="true"]');
      return {
        href: signal?.getAttribute('href') || '',
        title: document.title,
        links: document.querySelectorAll('link[data-chatgpt-tab-signal]').length,
        stop: !!document.getElementById('stop')
      };
    }""")

def wait_color(page, color, label, timeout=TIMEOUT_MS):
    try:
        page.wait_for_function("""hex => {
          const el = document.querySelector('link[data-chatgpt-tab-signal="true"]');
          return !!el && decodeURIComponent(el.getAttribute('href') || '').includes(hex);
        }""", arg="#" + color, timeout=timeout)
    except PlaywrightTimeout as exc:
        raise AssertionError(f"{label} did not display {color}: {status(page)}") from exc

def fire_post(page, name="request-1", success=True):
    # Route handler returns 200/500. Do not wait for fetch completion so the
    # network-start and network-complete transitions can be independently seen.
    return page.evaluate("""([name, success]) => {
      const url = '/backend-api/f/conversation?case=' +
        encodeURIComponent(name) + '&ok=' + (success ? '1' : '0');
      fetch(url, {method:'POST', body:'{"prompt":"synthetic"}',
        headers:{'content-type':'application/json'}}).catch(() => {});
      return true;
    }""", [name, success])

def head_churn(page):
    return page.evaluate("""async count => {
      const icon = document.querySelector('link[rel="icon"]:not([data-chatgpt-tab-signal])');
      let extra = 0;
      const t0 = performance.now();
      for (let i = 0; i < count; i++) {
        icon.href = '/favicon-' + i + '.ico';
        const meta = document.createElement('meta');
        meta.name = 'head-qa';
        document.head.appendChild(meta);
        meta.remove();
        extra++;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
      return {elapsed: performance.now() - t0, count:extra, icon:status};
    }""".replace("icon:status", "title:document.title"), HEAD_CHURN)

def main():
    started = time.monotonic()
    crashes = []
    requests = []
    with tempfile.TemporaryDirectory(prefix="tab-signal-mv3-") as profile:
        with sync_playwright() as playwright:
            # channel='chromium' opts into true modern headless Chrome with
            # extension support, rather than Chromium's legacy headless shell.
            context = playwright.chromium.launch_persistent_context(
                profile,
                channel="chromium",
                headless=True,
                args=[
                    "--disable-extensions-except=" + str(EXTENSION),
                    "--load-extension=" + str(EXTENSION),
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-sync",
                    "--no-sandbox",
                    "--disable-gpu",
                ],
            )
            context.on("close", lambda: crashes.append("context closed"))
            def route(request):
                url = request.request.url
                parsed = urlparse(url)
                if parsed.hostname != "chatgpt.com":
                    request.abort()
                    return
                if parsed.path.startswith("/backend-api/"):
                    requests.append((request.request.method, parsed.path))
                    if parsed.query.endswith("ok=0"):
                        request.fulfill(status=500, content_type="application/json", body="{}")
                    else:
                        request.fulfill(status=200, content_type="application/json", body='{"ok":true}')
                elif parsed.path.startswith("/c/"):
                    slug = parsed.path.rsplit("/", 1)[-1]
                    n = int(slug.split("-")[-1])
                    request.fulfill(status=200, content_type="text/html",
                                    body=fixture(n, old_turns=8000 if n == 0 else 60))
                elif parsed.path.endswith(".ico"):
                    request.fulfill(status=404, body="")
                else:
                    request.abort()
            context.route("**/*", route)
            pages = []
            try:
                for i in range(TAB_COUNT):
                    page = context.new_page()
                    page.on("crash", lambda _=None, i=i: crashes.append(f"renderer {i} crashed"))
                    page.goto(f"https://chatgpt.com/c/synthetic-{i}", wait_until="domcontentloaded")
                    assert page.title() == f"Fixture {i} - ChatGPT"
                    pages.append(page)
                workers = context.service_workers
                if not workers:
                    try:
                        context.wait_for_event("serviceworker", timeout=6000)
                    except PlaywrightTimeout:
                        pass
                assert context.service_workers, "Unpacked Manifest V3 service worker did not load"
                print("MV3 worker:", context.service_workers[0].url, flush=True)
                # Single-tab network state with real background event listeners.
                main_page = pages[0]
                fire_post(main_page, "one")
                wait_color(main_page, "94a3b8", "network start")
                main_page.locator("#stop").evaluate("(node) => node.remove()")
                # Some headless platforms never focus a background tab, so
                # completion may be blue (unread) or green (active/finished).
                try:
                    wait_color(main_page, "2563eb", "background completion", timeout=9500)
                    color = "blue"
                except AssertionError:
                    wait_color(main_page, "16a34a", "focused completion", timeout=9500)
                    color = "green"
                assert main_page.title() == "Fixture 0 - ChatGPT"
                assert status(main_page)["links"] == 1
                print("MV3 request-to-favicon roundtrip:", color, flush=True)
                # Notifications must originate from the real extension worker;
                # synthetic tests previously mocked this entire API.
                worker = context.service_workers[0]
                notifications = worker.evaluate("chrome.notifications.getAll()")
                assert any(key.startswith("chatgpt-prompt-bound:")
                           for key in notifications.keys()), (
                    "No completion notification registered in real MV3 worker",
                    notifications
                )
                print("MV3 native notification registered:", len(notifications), flush=True)
                contexts = worker.evaluate("""() => chrome.runtime.getContexts({
                  contextTypes:['OFFSCREEN_DOCUMENT']
                })""")
                assert contexts, "Audio offscreen document was not created"
                print("MV3 offscreen sound context present:", len(contexts), flush=True)

                # Independently start requests in two other tabs. Worker must
                # deliver the signal to the correct tab, no title prefix.
                for i in (1, 2):
                    fire_post(pages[i], f"concurrent-{i}")
                    wait_color(pages[i], "94a3b8", f"concurrent start {i}")
                    pages[i].locator("#stop").evaluate("(node) => node.remove()")
                for i in (1, 2):
                    try:
                        wait_color(pages[i], "2563eb", f"unread {i}", timeout=9500)
                    except AssertionError:
                        wait_color(pages[i], "16a34a", f"viewed {i}", timeout=9500)
                assert pages[1].title() == "Fixture 1 - ChatGPT"
                assert pages[2].title() == "Fixture 2 - ChatGPT"

                # Failure should be reported to content script as abort,
                # with no success icon and no retained completion timer.
                failure = pages[3]
                fire_post(failure, "http-fail", success=False)
                # Initial start and failure may be too fast for gray observation.
                failure.wait_for_timeout(400)
                assert not any(x in status(failure)["href"]
                               for x in ("%2316a34a", "%232563eb")), status(failure)

                # Exercise actual MV3 request routing for every tab, rather
                # than merely having 24 tabs idle together. All requests are
                # dispatched before checking completions.
                stress_started = time.monotonic()
                for i, page in enumerate(pages):
                    fire_post(page, f"burst-{i}")
                    if page.locator("#stop").count():
                        page.locator("#stop").evaluate("(node) => node.remove()")
                pending = set(range(len(pages)))
                deadline = time.monotonic() + 24
                while pending and time.monotonic() < deadline:
                    for i in tuple(pending):
                        favicon = status(pages[i])["href"]
                        if "16a34a" in favicon or "2563eb" in favicon:
                            pending.discard(i)
                    if pending:
                        time.sleep(.35)
                assert not pending, (
                    "Not all concurrent tabs completed within bounded time",
                    sorted(pending)
                )
                print(f"PASS concurrent completion: {len(pages)} MV3 POSTs "
                      f"resolved within {time.monotonic() - stress_started:.1f}s",
                      flush=True)

                elapsed = []
                heap_sizes = []
                for page in pages:
                    metric = head_churn(page)
                    assert metric["title"].startswith("Fixture "), metric
                    assert metric["elapsed"] < 3000, metric
                    elapsed.append(metric["elapsed"])
                    devtools = context.new_cdp_session(page)
                    devtools.send("Performance.enable")
                    measurements = devtools.send("Performance.getMetrics")["metrics"]
                    metrics = {x["name"]: x["value"] for x in measurements}
                    heap_sizes.append(metrics.get("JSHeapUsedSize", 0))
                    devtools.detach()
                assert not crashes, crashes
                assert max(heap_sizes) < 64 * 1024 * 1024, (
                    "Unexpected per-tab JS heap usage",
                    max(heap_sizes) / 1024 / 1024
                )
                assert len([r for r in requests if r[0] == "POST"]) >= 4, requests
                assert not any("● " in page.title() or "◌ " in page.title() for page in pages)
                print(f"PASS MV3 integration: {len(pages)} isolated tabs, "
                      f"{len([r for r in requests if r[0] == 'POST'])} POSTs, "
                      f"{HEAD_CHURN} head edits per tab; no crashes", flush=True)
                print(f"max head-churn latency: {max(elapsed):.1f} ms; "
                      f"max JS heap: {max(heap_sizes)/1024/1024:.1f} MiB; "
                      f"elapsed: {time.monotonic()-started:.1f}s", flush=True)
            finally:
                for page in pages:
                    with contextlib.suppress(Exception):
                        page.close()
                context.close()

if __name__ == "__main__":
    main()
