# ChatGPT Tab Signal

Manifest V3 extension for Edge and other Chromium browsers. Each ChatGPT tab
gets an independent activity indicator, a persistent **unread** marker when a
response finishes in the background, an audible completion chime, and a native
desktop notification that opens the correct tab.

## Status

**v0.1.6: zero-transcript-read candidate, still not approved for primary
Edge profile deployment.** Following the October 19 multi-tab crash report,
the extension has been redesigned to avoid the entire detection class that
could consume enormous resources on long chats.

The injected content script contains:
- **zero MutationObservers and zero other DOM observers**;
- **zero recurring timers and zero transcript queries**, even on 8,000-turn
  conversations;
- a single **2.5-second cancellable timeout** created only after Chromium
  confirms a successful conversation POST;
- explicit request-ID cancellation for abort, manual Stop, stale responses,
  navigation and replacement by a newer request;
- **no changes to conversation titles**; only the favicon is updated on
  accepted state transitions, never in a head-watching feedback loop;
- a per-tab ceiling of **60 network lifecycle events per minute**. Excess
  traffic temporarily disables signalling for that tab and clears its timer
  rather than allowing unbounded work.

The desktop notification is now deliberately **generic** (`Response finished.`).
No answer text is read or sent anywhere. This removes the old answer-preview
feature in exchange for a much smaller and safer workload.

The main-worker request filter is restricted to POST requests against
`/backend-api/f/conversation` or `/backend-api/conversation`. A 2xx
completion plus the short settle delay is the completion condition; it does
**not** independently verify React's final assistant-text DOM. False or
premature indicators remain possible if ChatGPT changes the behavior of
those endpoints.

GitHub Actions validates syntax, lifecycle simulations, static safety
invariants, isolated DOM fixtures, and full actual-unpacked-extension MV3
integration with network interception and many concurrent synthetic tabs.
No test proves absolute crash immunity or replaces compatibility testing on
the live site. Do not enable the extension across existing important tabs
based solely on this README.

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

The favicon is the **only** tab/window visual state cue. The extension **never
writes to document.title**, including for legacy-prefix cleanup. When
returning to idle, the extension restores the overlay favicon's URL and media
type to ChatGPT's current favicon, rather than simply removing a link that
Chromium might continue caching. Notification click still focuses the source
tab/window, but the desktop notification contains **no** redundant
"Click to return" instruction.

State belongs to a live page, not to the conversation across page reloads
or browser restarts.

## Safety and resource budget

- No `MutationObserver`, other DOM observer, interval, or transcript scan.
- One delayed completion `setTimeout` at most, after the network stream ends.
  Delay: **2.5 seconds**. A newer request, abort, manual Stop, or navigation
  cancels or invalidates the delayed action.
- No response content is extracted, scanned, fingerprinted, or sent across IPC.
- No idle monitoring, pagewide DOM scan, recurrent polling, or keyboard-driven
  background IPC.
- Only explicit generation/read/abort state transitions can alter the favicon.
  The favicon link is **written** in the head, but the head is never watched.
  No DOM title writes.
- More than 60 network lifecycle messages in one minute for a single tab
  causes temporary fail-closed behavior: cancel the pending timeout, restore
  the idle favicon, and ignore later request events until the minute resets.
- Failed delivery to an old/unreachable tab permits at most **one** fallback
  content-script injection attempt per tab during a service-worker lifetime.
  A repeated failure cannot trigger unbounded re-injections.
- This design removes the known self-observing head feedback pattern;
  the previous Edge crash's precise cause remains unproven.

To disable the extension in a browser profile visit `edge://extensions`.
No browser restart is required to switch it off.

## Detection path

1. Edge's `webRequest.onBeforeRequest` fires on a matching conversation POST:
   state becomes generating and the favicon becomes gray.
2. `webRequest.onCompleted` fires for a successful response (HTTP 2xx):
   the content script schedules **one** 2.5-second timeout. There is no
   inspection of ChatGPT's transcript, final assistant message, or stop button.
3. If the request wasn't aborted, manually stopped, superseded, or invalidated
   by navigation, the timeout marks that tab **blue** (unread) or **green**
   (already focused), sends a single fixed-message notification, and clears
   itself. A regenerated request gets a distinct Chromium request ID.
4. `webRequest.onErrorOccurred`, a non-2xx status, a newer generation, or
   a manual Stop click cancels a pending completion.
5. Return/focus changes blue unread to green viewed. The preview button in
   the extension popup remains available.

The request's successful HTTP completion is used as the signal of stream
completion. This has less semantic richness than reading the rendered
response, but it removes the old costly DOM dependency entirely. Notification
click still activates the originating browser tab.

## Automated tests

No dependencies or build step are needed beyond Node.js 22. From the repository
root run:

```sh
npm --prefix extensions/chatgpt-tab-signal test
```

This checks all extension JavaScript for syntax, verifies the manifest and its
bundled paths, simulates content-script behavior (including manual Stop cancellation,
read-only titles, gray/blue/green favicon state, focus, regeneration,
duplicates, aborts, no transcript reads, zero polling, single-timeout
cleanup, event-storm limits, and navigation),
and simulates worker network events, notifications, sounds, and click-to-focus.
A path-scoped GitHub Actions workflow runs this suite on changes to the
extension without triggering unrelated `script-monkey` projects.

The mock checks are deliberately **not** a replacement for the live manual
QA checklist below. Chromium/Edge or the operating system can still suppress
a notification despite successful extension API dispatch.

## Browser resource-safety gates

- `npm --prefix extensions/chatgpt-tab-signal test` covers syntax, manifest,
  **52 content-script + 19 worker simulations**, and CI tripwires that reject
  DOM observers, recurring timers, full-document selectors, answer-text
  extraction, document-title writes, unlimited reinjection, and removal of
  the per-tab event ceiling.
- `tests/chromium-isolated.py` injects the actual content script into fake
  Chromium pages; no login, network traffic to ChatGPT or user's Edge profile.
- `tests/mv3-integration.py` loads the full unpacked Manifest V3 extension in
  a disposable Chromium profile and validates request routing, favicon
  transitions, real notification registration, sound-context creation,
  concurrent tab completion and head-change stress.
- `tests/qa-launcher-smoke.sh` validates that the optional Fish QA launcher
  does not point at a normal browser profile.

These controls prevent a repeat of the specific known architecture failure
but are not a claim that Chromium, Edge, or the website can never crash.

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
The extension does not read rendered answer text. It uses the Chromium
request ID to deduplicate. The content is sent only
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
