# ChatGPT Tab Signal

A small Manifest V3 extension for Edge, Chrome, and Chromium.
While ChatGPT generates a response, the tab favicon shows a gray signal.
After completion it becomes green for a focused tab or blue for an unread
background tab, accompanied by a short chime and desktop notification.

## Usage

**Version 0.1.9: automatic operation, no activation controls.**

Install the unpacked extension from this directory through your browser's
extension management page (Developer mode > Load unpacked). Once installed,
the extension works automatically for future conversation requests.

There is **no popup**, global enable switch, per-tab permission workflow,
second login, or background daemon to configure. Tabs are left untouched
until they make a matching ChatGPT conversation request.

The extension **does not auto-inject scripts into all open tabs**. A
conversation POST lazily activates only the requesting ChatGPT tab. Other
idle tabs retain their own titles and favicons. Subsequent responses in the
same document reuse the single existing script.

To stop the extension altogether, disable or remove it from the browser's
extension management page.

## Detection and safety

- Matches only POST requests to
  `https://chatgpt.com/backend-api/f/conversation` or
  `https://chatgpt.com/backend-api/conversation`.
- Validates the tab origin before inserting a script into the requesting tab.
- On a successful 2xx completion, schedules one cancellable 2.5-second
  settling timeout before showing the completed state.
- Manual Stop and aborted, superseded or stale requests cancel completion.
- Caps lifecycle handling at 60 events per tab per minute; excess traffic
  fails closed instead of creating an unbounded feedback loop.
- Records each injection attempt before trying to inject. Unreachable
  renderers are not repeatedly injected for each network request.
- Cancels or rejects stale work across tab navigation and closure.
- No DOM mutation observers, recurring polls, full transcript searches,
  conversation-content extraction, or title rewrites.
- The desktop notification uses the conversation title but fixed body text
  **Response finished.** No answer preview is read from the page.

**Testing reduces risk but cannot guarantee that no browser version or
live ChatGPT response will ever malfunction.** The ChatGPT backend API is
not a stable extension interface; changes may cause missing or premature
signals. The test harness uses synthetic network responses and pages, not
authenticated production conversations.

## Tests

Run `npm --prefix extensions/chatgpt-tab-signal test` from the repository
root for syntax, static safety constraints, and worker/content simulations.

GitHub Actions also tests the unpacked extension with intercepted synthetic
ChatGPT pages in disposable profiles of **Google Chrome Stable**, **Microsoft
Edge Stable**, and **Chromium**. Tests cover simultaneous independent
responses across many tabs, untouched idle pages, notifications, sound
context creation, a manual Stop, high request load, favicon updates, and
absence of renderer crashes in those controlled scenarios.

## Privacy and attribution

No telemetry, password handling, external analytics, or conversation-text
collection. Native desktop notifications may be visible to others using
the same desktop.

AGPL-3.0-only. Adapted from
[ramhaidar/ChatGPT-Response-Complete-Notifier](https://github.com/ramhaidar/ChatGPT-Response-Complete-Notifier).
See `LICENSE` and `UPSTREAM.md` for attribution and provenance.
