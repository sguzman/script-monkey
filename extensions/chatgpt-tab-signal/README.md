# ChatGPT Tab Signal

Manifest V3 extension for Edge and other Chromium browsers. Each ChatGPT tab
gets an independent activity indicator, a persistent **unread** marker when a
response finishes in the background, an audible completion chime, and a native
desktop notification that opens the correct tab.

## Status

**v0.1.1: favicon-only UX; full live browser QA ongoing.** On Edge/Hyprland,
the user has observed the preview indicator and a native desktop notification.
The automated suite now covers 40 checks (25 for tab state, 15 for worker
routing), plus syntax and manifest checks. The tests use browser mocks and do
**not** establish that every real ChatGPT completion event or audio output
works in the user's Linux environment. No browser store release has been done.

## Install on EndeavourOS / Edge

1. Check out or update `main` of `sguzman/script-monkey`.
   When updating an already-loaded unpacked extension, pull latest `main`,
   click **Reload** on its `edge://extensions` card, then refresh ChatGPT tabs.
2. Open `edge://extensions`, enable **Developer mode**, and choose
   **Load unpacked**.
3. Select **this folder**: `extensions/chatgpt-tab-signal/` (the folder
   containing `manifest.json`), not the monorepo root.
4. Refresh all already-open `https://chatgpt.com/` tabs once.
5. Click the extension toolbar action: **Test sound + notification** verifies
   Chromium's audio/notification delivery; **Preview unread tab indicator**
   verifies the blue favicon on the active ChatGPT tab.
   Click inside the page to restore the original favicon. Tab titles never change.

No Tampermonkey, Rust, compilation, local daemon, API keys, or account access
are required. It uses only local browser extension APIs. Your browser's Do Not
Disturb / notification settings and the active sound output still apply.

## Behavior

| Event | Visual signal | Audio and notification |
| --- | --- | --- |
| Answer POST begins | Gray generating favicon, title unchanged | None |
| Response finished, tab not focused | Blue checkmark favicon, title unchanged | Two-note chime and desktop notification |
| Response finished, tab focused | Original ChatGPT favicon | Two-note chime and desktop notification |
| Background tab visited | Restores ChatGPT favicon | None |
| Generation manually stopped or request fails | Original ChatGPT favicon | None |

The unread state lasts until **that tab actually becomes focused**. Dismissing
the OS notification does not mark the tab read. The favicon is the **only** visual
state cue; conversation titles are never prefixed. Rather than merely removing
a temporary icon (which Chromium can cache), the extension restores the
overlay favicon's URL and media type to the site's current favicon and follows
later updates to the site's own icon. Notification click focuses the
source tab/window. State belongs to a live page, not to the conversation across
reloads or browser restarts.

## Detection path

The `webRequest` listener watches successful **POST** completion of
`/backend-api/f/conversation` and `/backend-api/conversation`, not unrelated
GETs or other ChatGPT requests. A content-script watcher binds the result to
the **latest user prompt**, waits for ChatGPT's visible stop button to go away,
and allows time for final text to settle. This is deliberate: network stream
completion and React's final render may not occur at precisely the same time.

The request-start listener paints the generating state immediately. Each
request carries its own Chromium request ID, and starting another request
cancels older DOM watchers and their timers. This prevents an old answer from
winning the race against a newer generation. Regenerations are not suppressed
merely because ChatGPT reused the assistant element or produced identical text.

The watcher sets the unread marker only after checking the final prompt-bound
answer; an empty or failed generation cannot fabricate a success message.
The worker creates the desktop notification and schedules audio using an
offscreen document (not through a fragile background page). The offscreen
context acknowledges whether sound scheduling succeeded, and the popup reports
partial-channel failures rather than pretending both channels worked.

## Automated tests

No dependencies or build step are needed beyond Node.js 22. From the repository
root run:

```sh
npm --prefix extensions/chatgpt-tab-signal test
```

This checks all extension JavaScript for syntax, verifies the manifest and its
bundled paths, simulates content-script behavior (including stop buttons, favicon restore,
original title preservation, tab focus, regeneration, empty results,
outdated requests, and route changes),
and simulates worker network events, notifications, sounds, and click-to-focus.
A path-scoped GitHub Actions workflow runs this suite on changes to the
extension without triggering unrelated `script-monkey` projects.

The mock checks are deliberately **not** a replacement for the live manual
QA checklist below. Chromium/Edge or the operating system can still suppress
a notification despite successful extension API dispatch.

## Live browser QA (still required)

1. **Output channels:** Test sound + notification; verify a two-note chime and
   OS notification in EndeavourOS/Hyprland.
2. **Unread preview:** open ChatGPT, click Preview unread tab indicator, inspect
   the blue favicon only, click the page to restore the original favicon.
3. **One background tab:** launch a response, switch to a different tab, watch
   grey activity become a persistent blue unread badge; only one chime/notification.
4. **Many tabs:** launch responses in two different ChatGPT tabs; each tab
   finishes and marks unread independently. Visiting one must not clear the other.
5. **Long thinking/tool calls:** no premature completion before thinking and
   writing both end.
6. **Manual stop/error:** should clear generation state and not produce a
   successful completion chime.
7. **Notification click:** restores the exact originating tab, even if another
   window was active.
8. **Title/favicons:** tab title must remain unchanged. ChatGPT may update
   its favicon at runtime; the blue marker should persist until read and
   the current original icon must reliably return afterward.
9. **Extension worker suspend/reload:** state is local to each content script;
   a page reload resets it. Observe for false duplicate alerts.

## Privacy

No telemetry, analytics, background upload, credentials, or external API.
The extension reads local rendered answer text for a notification preview and
uses a short prompt-bound fingerprint to deduplicate. The content is sent only
between its own extension contexts and the browser/OS notification facility.
Any notification preview may be visible on a shared or locked desktop.

## Upstream and licensing

**This extension is an AGPL-3.0-derived adaptation** of
[ramhaidar/ChatGPT-Response-Complete-Notifier](https://github.com/ramhaidar/ChatGPT-Response-Complete-Notifier)
(version 1.1.2 as inspected on 2026-10-19), especially its request-completion
watcher, offscreen Web Audio chime, extension popup, and notification routing.
The PNG notification icon is embedded from the upstream project as a data URL.
See the included `LICENSE` and `UPSTREAM.md` for provenance. No code from
this extension is implicitly licensed for use by unrelated projects in the
`script-monkey` repository.

The upstream implementation also depends on ChatGPT's changing private
selectors and endpoints. Changes to ChatGPT may require maintenance.
