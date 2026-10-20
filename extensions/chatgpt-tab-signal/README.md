# ChatGPT Tab Signal

Small Manifest V3 Edge/Chromium extension for a ChatGPT response chime,
desktop notification, and per-tab favicon states. **Explicit one-tab opt-in,
disabled by default.** Other tabs do not receive injected scripts.

## Local Edge QA (v0.1.7)

This build is a **single-tab QA candidate**, not a guarantee that Edge or the
live ChatGPT site will never crash. The prior multi-tab Edge incident motivated
an explicit isolation gate.

No separate browser profile, login, daemon, browser restart, or refresh of
existing ChatGPT tabs is required.

1. Update your local `script-monkey/main` checkout. In `edge://extensions`,
   reload the existing **ChatGPT Tab Signal** unpacked extension after the
   files are updated, then enable the extension itself if it is switched off.
   **This does not opt any ChatGPT tab in.**
2. Choose **one noncritical ChatGPT tab** in your regular Edge window.
3. Open the extension's toolbar popup and click **Enable only this tab**.
4. Send one short request. Gray favicon means generating; green means finished
   while focused, blue means finished in the background. A completed response
   should also send a short chime and desktop notification.
5. When done, use the same popup's **Disable this tab** control. It cancels
   pending notification work, removes its favicon link and revokes the tab's
   session permission. You may select a different tab only after disabling
   the previous one.

**Do not refresh, restart, or mass-open existing ChatGPT tabs for this QA.**
If anything behaves unusually, turn the extension off in `edge://extensions`.
Do not increase the scope of QA until the selected-tab test succeeds.

The optional `qa-isolated-edge.fish` developer launcher is still available
but is **not** required for ordinary one-tab QA.

## Isolation contract

- **The manifest has no `content_scripts`.** Installing or enabling the
  extension alone does not inject JavaScript into any ChatGPT page.
- Clicking the popup's enable control dynamically injects one content script
  **only in the selected tab**. The background worker remembers just that
  tab's ID in `chrome.storage.session` and gates every network event and
  completion notification against that ID.
- It is not possible to enable a second tab until the first is disabled.
- Reloading/navigating the selected tab, closing it, updating the extension,
  or restarting the browser revokes opt-in. Re-enable explicitly if desired.
- The background worker sees matching conversation network requests globally,
  but drops all events from nonselected tabs **before any page messaging or
  injection**. Network events can never trigger `executeScript`.
- Popup test controls only operate on the selected tab. Content scripts cannot
  grant themselves selection.
- Disabling stops notification work and the script's listeners become inert
  in that document. An ordinary reload clears that previously injected
  script, but reload is not needed to disable it.

**This does not prove zero crash risk.** Browser resource failures remain
possible, and the original October 19 renderer crash lacks a confirmed
technical cause. It does materially reduce the blast radius of one-tab QA.

## Detection and resource safety

1. Chromium `webRequest` detects a matching **POST** to
   `/backend-api/f/conversation` or `/backend-api/conversation`, **only
   for the opted-in tab**. The gray generating favicon is applied.
2. A successful 2xx network completion starts a single **cancellable 2.5-second
   timeout**. If not superseded, stopped, or aborted, it marks the selected tab
   blue unread (unfocused) or green finished (focused), then plays a chime and
   creates a notification reading **Response finished.**
3. Abort/manual Stop resets to the original favicon. Returning to an unread
   tab marks it green. Notification click activates its originating tab.

There are **no DOM mutation observers, no transcript scans, no recurring
polling timers, no answer-text extraction, no conversation-title writes, and
no automatic script reinjection**. A per-tab cap of 60 lifecycle events per
minute cancels signalling on unexpected request storms.

HTTP completion and final rendered assistant text are not guaranteed to
coincide; this deliberately simpler detector may sometimes report too early
or fail to recognize changes in ChatGPT's private endpoints. That tradeoff is
preferable to a potentially unbounded browser workload.

## Automated proof and limitations

GitHub Actions runs:

- Node syntax, manifest safety rules, and **59 content-script + 37 worker
  simulated assertions**, including default-off, single-tab scope, session
  revocation, unavailable renderer, and no transcript inspection.
- `tests/chromium-isolated.py`: synthetic DOM and head changes in real
  Chromium with no ChatGPT account.
- `tests/mv3-integration.py`: actual unpacked MV3 service worker and
  dynamically injected script across **24 synthetic ChatGPT tabs**. It verifies
  zero injections after installation, events in all unselected tabs having
  no effect, popup activation for one tab, notification and audio-context
  creation, Stop/cancellation, an 80-POST storm, disable cleanup, and head
  churn without renderer crashes.
- A mock-browser test of the optional isolated-profile Fish launcher.

These tests use fake intercepted ChatGPT pages, not authenticated real-site
requests. They cannot guarantee stability in the user's Edge profile or prove
that every ChatGPT response is detected.

Run the JS checks with
`npm --prefix extensions/chatgpt-tab-signal test`.

## Privacy

No external telemetry, no account integration, no scraping or shipping
conversation contents. The only page text sent to the worker is the
conversation's title for its desktop notification. Completion previews
are always generic. OS notifications can be visible on a shared desktop.

## License and upstream

AGPL-3.0-only, adapted from
[ramhaidar/ChatGPT-Response-Complete-Notifier](https://github.com/ramhaidar/ChatGPT-Response-Complete-Notifier).
See `LICENSE` and `UPSTREAM.md` for attribution. No license implication
for unrelated projects in `script-monkey`.
