# ChatGPT Tab Signal

Manifest V3 extension for Edge and other Chromium browsers. Each ChatGPT tab
gets an independent activity indicator, a persistent **unread** marker when a
response finishes in the background, an audible completion chime, and a native
desktop notification that opens the correct tab.

## Status

**v0.1.0: first implementation; browser integration QA pending.** No publishing
or store release has been done. The packaged tests exercise the upstream
completion watcher indirectly; the user must validate against live ChatGPT.

## Install on EndeavourOS / Edge

1. Check out the branch `feat/chatgpt-tab-signal` of `sguzman/script-monkey`.
2. Open `edge://extensions`, enable **Developer mode**, and choose
   **Load unpacked**.
3. Select **this folder**: `extensions/chatgpt-tab-signal/` (the folder
   containing `manifest.json`), not the monorepo root.
4. Refresh all already-open `https://chatgpt.com/` tabs once.
5. Click the extension toolbar action: **Test sound + notification** verifies
   Chromium's audio/notification delivery; **Preview unread tab indicator**
   verifies the blue favicon and `●` title prefix on the active ChatGPT tab.
   Click inside the page to clear the preview.

No Tampermonkey, Rust, compilation, local daemon, API keys, or account access
are required. It uses only local browser extension APIs. Your browser's Do Not
Disturb / notification settings and the active sound output still apply.

## Behavior

| Event | Visual signal | Audio and notification |
| --- | --- | --- |
| Answer POST begins | Grey icon and `◌` title | None |
| Response finished, tab not focused | Blue icon and `●` title | Two-note chime and desktop notification |
| Response finished, tab focused | Normal tab | Two-note chime and desktop notification |
| Background tab visited | Restores site's own favicon and title | None |
| Generation manually stopped or request fails | Restores normal tab | None |

The unread state lasts until **that tab actually becomes focused**. Dismissing
the OS notification does not mark the tab read. Notification click focuses the
source tab/window. State belongs to a live page, not to the conversation across
reloads or browser restarts.

## Detection path

The `webRequest` listener watches successful **POST** completion of
`/backend-api/f/conversation` and `/backend-api/conversation`, not unrelated
GETs or other ChatGPT requests. A content-script watcher binds the result to
the **latest user prompt**, waits for ChatGPT's visible stop button to go away,
and allows time for final text to settle. This is deliberate: network stream
completion and React's final render may not occur at precisely the same time.

The new request-start listener paints the generating state immediately. The
watcher sets the unread marker only after it has actually confirmed final
completion. The worker creates the desktop notification and plays audio via an
offscreen document (not through a fragile background page).

## Tests / expected QA

1. **Output channels:** Test sound + notification; verify a two-note chime and
   OS notification in EndeavourOS/Hyprland.
2. **Unread preview:** open ChatGPT, click Preview unread tab indicator, inspect
   the title prefix and icon, click the page to clear.
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
8. **Page title/favicons:** ChatGPT may update both at runtime; marker should
   remain until read and original icon must return afterward.
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
