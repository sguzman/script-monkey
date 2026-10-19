# ChatGPT Tab Signal

Manifest V3 extension for Edge and other Chromium browsers. Each ChatGPT tab
gets an independent activity indicator, a persistent **unread** marker when a
response finishes in the background, an audible completion chime, and a native
desktop notification that opens the correct tab.

## Status

**v0.1.5: isolated-profile Edge dogfooding candidate.** Do not enable this
extension in the primary Edge profile containing existing work tabs yet.

The 2026-10-19 failure affected more than half the user's ChatGPT tabs.
The exact crash mechanism was not confirmed, but a self-observing head
MutationObserver was an avoidable risk. Its recurrence is documented privately
in Agent Adaptation (AA-0169 through AA-0171). The safety gate now bans all
persistent DOM observers.

The current build uses one bounded completion timer (3-second polling, 3-minute
hard cap), processes at most the 96 most recent conversation turns, sends at most
260 response characters to the service worker, and performs no per-keystroke or
per-click background messaging.

**Verified in CI:** 45 content-script simulations, 17 worker simulations,
source-level safety tripwires, isolated synthetic Chromium DOM tests, and
full actual-unpacked-extension Manifest V3 integration with **24 tabs**,
intercepted network requests, favicon transitions, an actual registered browser
notification, head churn and per-tab JS heap measurements. Browser-generated
audio output still requires local playback verification. These tests are not a
guarantee against a future crash or confirmation of real-site compatibility.

## Isolated Edge QA on EndeavourOS / Hyprland

**Keep ChatGPT Tab Signal disabled in your regular Edge profile.**
Do not reload or otherwise disturb existing working ChatGPT tabs.

1. Pull latest `script-monkey/main` into your local checkout.
2. From the repository root run:

   ```sh
   fish extensions/chatgpt-tab-signal/qa-isolated-edge.fish
   ```

3. The launcher opens a **separate, persistent QA browser profile** under
   `$XDG_DATA_HOME/chatgpt-tab-signal-isolated-qa` or
   `~/.local/share/chatgpt-tab-signal-isolated-qa`. It loads only the unpacked
   extension from the repository and never reuses, copies, kills or restarts
   your normal Edge profile. Sign into ChatGPT **inside that QA window** once.
4. Start with **one** noncritical ChatGPT conversation in the QA window. Confirm
   gray while generating, green when completed while focused, and sound plus
   desktop notification. Then send a second request and switch to a second QA
   tab: the first conversation should turn **blue** until you return, when it
   turns **green**.
5. If any tab hangs, crashes, or behaves abnormally, **close only the isolated
   QA browser window**. The extension in your regular profile stays disabled.
   Do not retry with your valuable existing ChatGPT tabs.

The launcher prefers `microsoft-edge-stable`, then `microsoft-edge`,
then `chromium`. It has no dependency on Tampermonkey or build tools. You can
optionally set `TAB_SIGNAL_QA_BROWSER` to an executable name for a specific
browser. The persistent isolated QA profile keeps its own cookies; it does
not share passwords or logins with the main browser.

After initial QA succeeds, expand only **within the QA profile** to two or more
simultaneous conversations. Main-profile rollout is a separate decision.

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

- No `MutationObserver` instances; in particular no head observer that can
  trigger its own favicon modifications.
- One polling timer only while checking completion after a successful network
  request; interval **3 seconds**, hard lifetime **3 minutes**.
- At most 96 recent turns processed per check; no full-conversation array copy.
- Only 260 characters of final-answer preview sent across MV3 contexts.
- No idle polling, no background traffic on pointer/keyboard interactions,
  and no title prefix additions.
- The favicon changes only on explicit state transitions.
- The prior browser crash mechanism is not conclusively established. The
  extension **cannot be guaranteed crash-free**, even after isolated tests.

To disable the extension in any Edge profile use `edge://extensions` and
switch **ChatGPT Tab Signal** off. No browser restart is required.

## Detection path

The `webRequest` listener watches successful **POST** completion of
`/backend-api/f/conversation` and `/backend-api/conversation`, not unrelated
GETs or other ChatGPT requests. A content-script watcher binds the result to
the **latest user prompt**, waits for ChatGPT's visible stop button to go away,
and allows time for final text to settle. This is deliberate: network stream
completion and React's final render may not occur at precisely the same time.

The request-start listener paints the generating state immediately. Each
request carries its own Chromium request ID, and starting another request
cancels older completion timers. This prevents an old answer from
winning the race against a newer generation. Regenerations are not suppressed
merely because ChatGPT reused the assistant element or produced identical text.

The bounded completion check sets the unread marker only after checking the final prompt-bound
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

- `npm --prefix extensions/chatgpt-tab-signal test` runs the JS syntax,
  manifest, state simulations and source safety invariants.
- `tests/chromium-isolated.py` exercises synthetic DOM in isolated Chromium,
  with no real ChatGPT network access.
- `tests/mv3-integration.py` loads the **actual MV3 extension** into a new
  disposable Chromium profile, intercepts the entire fake ChatGPT origin,
  and verifies real `webRequest` delivery, several independent tabs,
  favicon states, registered notifications, sound-context creation, repeated
  head changes, and JavaScript heap usage. It cannot authenticate to or
  retrieve any actual ChatGPT conversation.
- `tests/qa-launcher-smoke.sh` uses a fake browser binary to check that the
  fish launcher passes only an isolated user-data directory.
- GitHub Actions runs all suites on changes to the extension. They prevent
  known regressions, **not** every possible Chromium or ChatGPT-site fault.

## Local QA checklist (isolated profile only)

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
