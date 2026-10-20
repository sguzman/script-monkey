# ChatGPT Tab Signal

A lightweight Manifest V3 extension for Edge/Chromium. ChatGPT tabs display
gray while generating, blue when a response finishes in the background, and
green when the completed tab is viewed. It also provides a short completion
chime and desktop notification.

## One switch. All ChatGPT tabs.

**v0.1.8 - global switch with lazy per-request activation.**

The extension starts **off by default** after this upgrade. To use it,
update your local `script-monkey/main` checkout, reload the unpacked extension
in `edge://extensions`, then click the extension popup's
**Turn on for all ChatGPT tabs** button **once**.

That is the entire setup. There is **no login, separate profile, manual
per-tab activation, daemon, or mass tab refresh**. Previously opened
ChatGPT tabs become eligible without additional setup.

**Important distinction:** the global toggle **does not inject code into
all open ChatGPT tabs**. Idle tabs remain untouched. When an eligible tab
actually sends a conversation POST, the extension lazily loads its tiny
content script in that tab only. Once loaded, that tab's signal remains
available on subsequent responses until a page reload. Opening, reloading
or closing other idle tabs doesn't trigger work.

One click on **Turn off for all tabs** revokes the global setting and asks
previously activated tabs to remove their favicon signal and cancel
pending completion timers. No refresh or restart required.

## Workload and safety

- No automatic `content_scripts` entries in the manifest.
- No DOM mutation observers, continuous head watching, transcript scanning,
  recurring timers, or conversation-title writes.
- No response text extraction; notification preview is the fixed text
  **Response finished.** The title is used for the notification header.
- The background worker matches **POST** requests to the specific
  `chatgpt.com/backend-api/f/conversation` and
  `chatgpt.com/backend-api/conversation` endpoints, and validates origin.
- A matching request START lazily activates that **one** ChatGPT tab. A
  successful 2xx completion schedules exactly one cancellable 2.5-second
  settling timeout. Abort, newer response, manual Stop and navigation prevent
  outdated notifications.
- Activation attempts are tracked per tab/document across MV3 worker sleep.
  Failed injections are not retried on every network event. Per-tab messages
  are serialized so a fast POST completion cannot overtake activation.
- Existing content scripts are reused when a disabled tab is used again.
- Each tab handles at most 60 lifecycle messages per minute, then temporarily
  ignores further signal activity in that tab until its minute resets.
- Background work and content injection never run when the global switch
  is off. Switching it on does not touch idle tabs.
- Reloading or navigating a tab clears its per-document injection record;
  the next matching POST can activate that replacement document.

**This is risk reduction, not a crash-proof guarantee.** A previous browser
stability problem was not conclusively diagnosed. The self-observing head
watcher was removed, but synthetic-browser tests cannot establish compatibility
with every authenticated ChatGPT session.
A background signal is based on successful network completion, not checking
React's rendered final answer, so an occasional early/late/missed alert
remains possible if ChatGPT changes its network behavior.

## Developer tests

`npm --prefix extensions/chatgpt-tab-signal test` verifies the manifest,
injected script safety invariants, one global switch, simulated lifecycle
events, lazy multi-tab activation, failed-injection and cancellation
limits, and completion behavior.

The isolated GitHub Actions browser jobs run real Chromium with fake,
locally intercepted `chatgpt.com` pages and the **actual unpacked MV3
extension**. Tests verify that installing it and turning on the global
switch do **not** modify idle ChatGPT tabs; that multiple tabs can trigger
their own activation by responding; and that manual Stop, request storms,
global disable, favicon updates and resource use remain bounded.

Automated QA runs on synthetic pages in disposable browser profiles,
without accessing existing browser sessions or real conversations.

## Privacy and provenance

No telemetry, credentials, external analytics or conversation-content
collection. Response preview is generic. Native notifications may be
visible to anyone with access to the desktop.

Licensed AGPL-3.0-only, adapted from
[ramhaidar/ChatGPT-Response-Complete-Notifier](https://github.com/ramhaidar/ChatGPT-Response-Complete-Notifier).
See `LICENSE` and `UPSTREAM.md` for upstream attribution.
