# ChatGPT Tab Signal

Manifest V3 extension for Edge and other Chromium browsers. Each ChatGPT tab
gets an independent activity indicator, a persistent **unread** marker when a
response finishes in the background, an audible completion chime, and a native
desktop notification that opens the correct tab.

## Status

**v0.1.4: development quarantine / not cleared for installation in the
primary Edge browser.** Following the October 19 multi-tab incident, the
extension must remain disabled in the user's real ChatGPT session.

Risk-reduction changes on main include removal of all persistent DOM/head
observers, one bounded three-second post-network timer per active completion,
a maximum three-minute watcher lifetime, a 96-turn recent-history limit for
JavaScript processing, a 260-character completion IPC preview, and removal
of unnecessary click/keystroke IPC. These are implemented constraints, not
proof that the previous crashes can no longer recur.

45 content-script and 17 worker simulations pass. A source-level invariant
test fails on reintroduction of a MutationObserver or budget expansion.
An isolated Playwright Chromium smoke test is committed and wired to CI,
but its successful completion has **not been independently confirmed** here.
It uses synthetic pages, not the user's ChatGPT account or Edge profile.

**Do not enable or refresh existing ChatGPT tabs for this work.**
Browser-profile safety and the original incident's precise failure cause
remain unresolved; source changes, synthetic tests and documentation
do not establish live deployment safety.

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
   verifies the blue unread favicon on the active ChatGPT tab.
   Click inside the page to mark it viewed (green checkmark). No title prefix
   is added; an obsolete prefix from v0.1.0 is removed automatically.

No Tampermonkey, Rust, compilation, local daemon, API keys, or account access
are required. It uses only local browser extension APIs. Your browser's Do Not
Disturb / notification settings and the active sound output still apply.

## Behavior

| Event | Visual signal | Audio and notification |
| --- | --- | --- |
| Answer POST begins | Gray generating favicon, title unchanged | None |
| Response finished, tab not focused | Blue checkmark favicon, title unchanged | Two-note chime and desktop notification |
| Response finished, tab focused | Green finished checkmark favicon | Two-note chime and desktop notification |
| Background tab visited | Blue unread changes to green finished | None |
| Generation manually stopped or request fails | Original ChatGPT favicon | None |

The unread state lasts until **that tab actually becomes focused**, when the blue
checkmark becomes green. The green finished indicator persists until another
generation begins, a canceled/failed response resets the tab, or the page
reloads. Dismissing the OS notification does not mark the tab read.

The favicon is the **only** tab/window visual state cue. No title prefixes
are created. Older prefixes from v0.1.0 are stripped when detected. When
returning to idle, the extension restores the overlay favicon's URL and media
type to ChatGPT's current favicon, rather than simply removing a link that
Chromium might continue caching. Notification click still focuses the source
tab/window, but the desktop notification contains **no** redundant
"Click to return" instruction.

State belongs to a live page, not to the conversation across page reloads
or browser restarts.

## Safety and resource budget

- No permanent `MutationObserver` on the page head or entire conversation.
- Exactly one 750 ms polling timer when a network-completed response needs
  settling; canceled or successful watchers always clear it.
- A maximum 10-minute watcher lifetime, including long-thinking responses.
- Only the first 260 characters of the final answer are sent from a ChatGPT
  page into the background notification logic.
- No page activity timer when idle or after a response is resolved.
- Favicon updates are performed only on state transitions, not on each DOM
  mutation. Since ChatGPT can dynamically replace favicons, this prioritizes
  browser stability over forcing the icon to stay visible.
- The extension cannot issue Linux signals directly, but excessive renderer
  work could contribute to a crash. Root cause of the reported `SIGKILL`
  remains unknown.

To disable immediately, use `edge://extensions` and switch **ChatGPT Tab
Signal** off. Disabling the extension requires no ChatGPT tab refresh.

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
title-prefix migration, gray/blue/green state transitions, tab focus,
regeneration, empty results, large response limits, single-timer bounded
execution, and route changes),
and simulates worker network events, notifications, sounds, and click-to-focus.
A path-scoped GitHub Actions workflow runs this suite on changes to the
extension without triggering unrelated `script-monkey` projects.

The mock checks are deliberately **not** a replacement for the live manual
QA checklist below. Chromium/Edge or the operating system can still suppress
a notification despite successful extension API dispatch.

## Browser resource-safety gates

- **No permanent DOM observers:** the content script must not construct a
  `MutationObserver`, especially on `document.head` while writing favicons.
- **Bounded work:** one completion timer only, at least three seconds between
  checks, at most three minutes of watchdog life, and a 96-turn JavaScript
  traversal cap. No background click/keystroke telemetry.
- **Small messages:** only the first 260 characters of response text are
  sent to the extension worker; no whole-answer IPC.
- **Mandatory regression checks:** `npm test` includes
  `tests/safety-invariants.cjs` alongside lifecycle simulations.
- **Real Chromium fixture:** `tests/chromium-isolated.py` loads the actual
  content script into disposable synthetic pages and performs repeated head
  mutations across up to 12 tabs (8 by default). It requires Playwright and
  a Chromium binary, but **never navigates to or authenticates with ChatGPT**.
  This is a resource-safety smoke test, **not** a demonstration of actual
  `webRequest` integration or notification delivery in Edge.
- **Release hold:** passing these tests does not permit immediate reactivation
  in the user's primary profile. Do not ask the user to discover crashes.

Run the isolated smoke test in a disposable environment with:

```sh
python -m pip install playwright
python -m playwright install chromium
python extensions/chatgpt-tab-signal/tests/chromium-isolated.py
```

The test script's Chrome profile is created by Playwright, independent of the
user's Edge data. It is deliberately absent from the default `npm test`
because it needs an actual Chromium executable; GitHub Actions has a
dedicated browser-safety job.

## Live browser QA (still required)

1. **Output channels:** Test sound + notification; verify a two-note chime and
   OS notification in EndeavourOS/Hyprland.
2. **Unread preview:** open ChatGPT, click Preview unread tab indicator,
   inspect the blue favicon, then click the page to turn it green.
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
8. **Title/favicons:** the tab title must never gain a prefix. The gray
   activity, blue unread, and green finished icons must follow the state
   transitions. A failed/stopped request restores ChatGPT's current icon.
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
