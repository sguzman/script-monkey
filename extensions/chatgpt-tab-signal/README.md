# ChatGPT Tab Signal

A small Manifest V3 extension for Microsoft Edge, Chrome, and Chromium.
Each open conversation gets a **perceptually differentiated color favicon**. A title emoji
communicates response state. Successful responses still have the familiar
two-note chime, desktop notification, and click-to-focus behavior.

## Title statuses

| Prefix | Status |
| --- | --- |
| None | Idle: no generation or pending alert |
| ⏳ | Generating |
| 🔔 | Finished in background; unread |
| ✅ | Finished and viewed |
| 🔌 | Connection interrupted; waiting for the answer (not confirmed failure) |
| ❌ | Individual ChatGPT response could not load |
| 🚫 | ChatGPT conversation page could not load |
| ⚠️ | Newly observed visible ChatGPT failure banner |
| 🛑 | Conversation reached its maximum-length limit |

A visible "Connection interrupted. Waiting for the complete answer"
message is a distinct **indeterminate** waiting state. ChatGPT may recover
or require another submission; that wording alone does not establish which.
It never produces a misleading completion notification.
Manual Stop returns to idle rather than showing a network error.

Error detection is **best effort**, not an omniscient network monitor.
A failed conversation POST alone is not classified as a failed conversation.
Only newly observed, explicitly recognizable failure UI qualifies for
the warning. Transport failures still cause a bounded follow-up check for
delayed errors and conversation limits. The text color or CSS class alone never
signals an error: benign red UI previously caused false errors and
suppressed successful-response notifications. Pre-existing banners are
not grounds for vetoing a new successful response. A true length-limit
message takes precedence over generic failures. Unknown site wording
can be missed until the detector is updated.

## Installation and operation

**Version 0.1.27.** Load the unpacked extension from this directory in the
browser extension-management page using Developer mode > Load unpacked.
No popup, toolbar button, global switch, login, or companion service.

The lightweight identity decorator loads on normal, project, and custom-GPT
conversation URLs, even for idle chats. On extension install/update/reload, a **one-time, bounded** pass upgrades
scripts in up to 72 already-open conversation tabs **without navigating or
reloading those pages**. This pass also installs the lightweight response
watcher in those open tabs, so the next request uses the updated logic.
On ordinary browsing, the response watcher remains request-activated.
Older versions (before v0.1.24) had no script-disposal protocol: their
existing orphaned callbacks cannot always be retired without a page reload.
From v0.1.24 forward, the observer/watcher lifecycle includes an explicit
versioned handoff that disposes the previous cooperating instance.
The heavier response watcher only loads for a conversation tab after its own
matching POST. Unrelated ChatGPT pages and other websites are not decorated.

A 32×32 **PNG** favicon is rendered once per conversation identity.
Normal chats and custom-GPT chats use a square; project chats use a circle.
Existing favicon links are updated in place. Their original attributes are
restored when navigating away. Status changes never recolor the favicon.

## Visible favicon color: perceptual palette v2

The tab strip uses **v2**. The original v1 reference function is still
available unchanged for applications that already depend on it.

v2 exposes **assignFromUrl(url, occupiedHexColors)** in the same
dependency-free conversation-color.js file. It constructs 72 candidate
colors spanning 24 hues and three distinct luminance bands. It converts
them to **OKLab**, then selects the swatch with the greatest minimum
OKLab distance from other occupied chat colors. A fixed FNV-1a hash of
the conversation key supplies an initial choice and deterministic
tie-breaks. This is *not* random at runtime, and two programs given
the same URL and occupied colors compute the same result.

To distinguish open tabs rather than theoretical future chats, the
extension serializes color registration through its existing MV3 worker.
It assigns an available perceptually distant swatch when a chat opens,
keeps that swatch **stable for the active tab's lifetime**, and
releases it when the tab closes. Two tabs showing the same conversation
reuse its color. Only the requesting tab is updated: there is **no
polling, recurring enumeration, broadcast, or recoloring of other tabs**.
Current assignments are kept in browser-session extension storage, not
uploaded or written to a public repository.

A small swatch is not a proof of universal visual uniqueness, especially
at very large tab counts or for viewers with color-vision differences.
The v2 algorithm is tested across 40 synthetic open chats with 40
different swatches and an OKLab pairwise distance threshold.

**Using the exact active swatch in another extension:** reading the
CSS custom property
--chatgpt-tab-signal-identity-hex-v2
from the page's document element returns the allocated hex. The
element also has data-chatgpt-tab-signal-color-resolved="v2" after the
worker has assigned it. These values expose only the color, not a
conversation ID or privileged extension callback. An independent
extension can instead bundle the public JavaScript and call
assignFromUrl(url, occupiedHexColors) when it knows the occupied set.
Because the live allocation depends on the *currently occupied set and
registration order*, simply hashing a URL independently without that
context cannot guarantee a match to its session's assigned swatch.

Native completion notifications reuse **the exact tab PNG favicon**.
The status emoji and fixed notification text remain independent of color.
No response text, chat ID, or tab URL is sent with the icon.

## Public color algorithm: v1

The original reference implementation is conversation-color.js, a
 dependency-free JavaScript file suitable for reuse by any program. v1
 hashes one URL without other active-tab context. It remains reproducible
 independently, but **v2** is used for visible live tab identities.

1. Parse HTTPS ChatGPT URLs into a canonical, namespaced key:
   chat:<chat-id>, project:<project-id>/chat:<chat-id>, or
   gpt:<gpt-id>/chat:<chat-id>. Project IDs include their g-p- prefix.
2. Prefix the exact key with the ASCII string chatgpt-tab-color-v1/.
3. Compute **FNV-1a unsigned 32-bit**: initial hash 2166136261; XOR each
   JavaScript UTF-16 code unit and multiply by 16777619 modulo 2^32.
4. Hue = hash % 360 (integer), saturation = 0.72, lightness = 0.55.
   Convert HSL to RGB using hexFromHsl in conversation-color.js; round
   each channel using Math.round(value * 255).
5. Emit lowercase #rrggbb. For project chats only the favicon geometry is
   circular; the color is derived from the project and chat namespace.

The same exact algorithm already existed in v0.1.14 and was retained.
The golden vectors in tests/conversation-color.cjs use **synthetic IDs only**,
including hex #dfab3a for one example. Do not change v1 without creating a
new explicitly versioned algorithm. Different identities may still generate
identical or visually similar colors.

In Node, require('./conversation-color.js').fromUrl(url) returns a frozen
object containing kind, chatId, scopeId, key, hash, hue, hex, and emoji.
In browser scripts that separately load the file, call
ChatGPTConversationColor.fromUrl(url). The old six-color emoji output is
preserved for API compatibility, but is no longer a tab title prefix.

**Isolated world clarification:** Chrome/Edge extension content scripts
have their own JS world. This extension's global
ChatGPTConversationColor is accessible to its own scripts, not automatically
to page JavaScript or a different extension. Other programs can copy or
independently implement the small public v1 function; exposing privileged
callbacks into the web page is intentionally avoided.

## Public state and color interface (v1)

Other userscripts and browser extensions can read the live status and
identity color directly from `document.documentElement.dataset`:

```js
const root = document.documentElement;
const state = root.dataset.chatgptTabSignalState;
const color = root.dataset.chatgptTabSignalColor;
const colorReady = root.dataset.chatgptTabSignalColorResolved === 'v2';
root.addEventListener('chatgpt-tab-signal-change', () => {
  console.log(root.dataset.chatgptTabSignalState,
              root.dataset.chatgptTabSignalColor);
});
```

The corresponding HTML attributes are `data-chatgpt-tab-signal-state`,
`data-chatgpt-tab-signal-color`, `data-chatgpt-tab-signal-api-version="1"`,
and the existing `data-chatgpt-tab-signal-color-resolved="v2"`.
`color` reflects the actual rendered favicon swatch even before the final
active-tab allocation; wait for `colorReady` to use the allocated swatch.
The existing CSS custom property `--chatgpt-tab-signal-identity-hex-v2`
continues to provide the same current color.

The change event is emitted on the root element only when published values
change. It has **no payload**; reading these attributes works across isolated
extension worlds, without access to privileged functions, user text, session
identifiers or storage. Values are observable state, not an API for controlling
the extension. State strings are `idle`, `generating`, `unread`,
`finished`, `interrupted`, `error`, `limit`,
`response_load_failed`, and `conversation_load_failed`.

A displayed `This response couldn’t load` placeholder is distinguished from
the page-level `Could not load this ChatGPT conversation` retry screen.
The latter is detectable even without a conversation POST. Two bounded
one-time checks after page activation handle delayed rendering of the failed
shell. Recovery can clear a failed-load or interrupted state to `idle`
without falsely asserting that an answer completed. These checks are
best-effort: the interface can change, and retry behavior is controlled by
ChatGPT, not this extension.

## Safety

- Watches only matching ChatGPT conversation POST endpoints.
- Uses actual Chrome document IDs to distinguish reloads from SPA route
  changes; only the requesting tab receives an update.
- Caps lifecycle work at 60 events per tab per minute. Overflow fails
  closed and cancels pending status timers.
- A successful conversation HTTP POST means only that *transport* completed.
  It never means the user-visible response is done. A new completed-response
  Copy action must appear after that request starts, and the Stop control
  must not be visible. Only then can a 2.5-second settle check announce
  completion. If ChatGPT is still thinking, executing tools, or rendering,
  the tab stays ⏳ with no sound or native notification.
- A request-scoped MutationObserver watches `main` and, if needed,
  the current Stop control's immediate parent after successful transport.
  Its callback ignores unrelated mutations and only rechecks when a
  response-copy control appears or a Stop control disappears. It disconnects
  on completion, cancellation, failure, navigation or version handoff.
  No transcript text is read; no idle observer, continuous timer or polling.
- The one-shot 4.5-second background-worker fallback now also requires
  the same fresh Copy action and absent visible Stop control, checked through
  one isolated-world DOM probe. It cannot announce HTTP-only completion.
- A **successful** conversation POST emits a network-settled candidate,
  chime and desktop notification whether the ChatGPT tab is foreground
  or background, unless a **new, recognized failure message** is observed.
  The fallback uses the same colored PNG and deduplicates late page callbacks.
  Foreground only changes the title emoji from 🔔 to ✅. An old error
  message or unrelated red UI cannot silence a new successful response.
- Once the same request produces an announced response, any delayed failure
  or preview event for that request is ignored. A separate auxiliary request
  that fails after a confirmed answer no longer overwrites that answer with
  an error *unless* a recognized error is visible. A fresh user send/retry
  gesture identifies a new prompt whose network failure still counts.
  Programmatic requests without such a gesture or visible error remain
  best-effort classifications; the extension does not read transcripts.
- Canceled streams (ERR_ABORTED) are not falsely labeled as outages;
  confirmed transport failures and non-2xx responses remain errors.
- Two one-time delayed failed-shell checks (2 and 7 seconds) complement
  activation, page-load and network checks. They are not a recurring poll.
- Interruption matches the exact diagnostic phrase in short, bounded
  status elements even with neutral styling. Detection runs at page
  activation, page load/navigation and network lifecycle checkpoints;
  UI-only changes without a lifecycle event may not register immediately.
  Tab focus alone does not trigger state reclassification. No page-wide
  observers or polling were added.
- Failed requests without a newly visible error return to idle, or preserve
  an existing completed/unread state if the failed POST was incidental.
  Stale failure banners cannot cause new warnings, and warnings clear on
  focus/navigation after the banner disappears. This deliberately favors
  avoiding false warnings when only transport evidence is available.
- Error-banner checks run only on limited activation, navigation or
  response/failure lifecycle events, not on streamed tokens. Generic
  errors are not inferred merely from loading or focusing a chat. They
  examine no more than 36 candidates, reject
  candidate text over 320 characters, and exclude conversation-turn/code
  elements. They do not extract or send a transcript.
- There is no permanently attached body/head observer or recurring polling.
  The **only persistent observer** watches the tiny title element. A second,
  short-lived observer of `main` is allowed only while a successful POST
  awaits affirmative response-completion controls. React's repeated title
  mutations are coalesced with a 350 ms trailing debounce, rather than
  fighting every write; explicit status changes still publish immediately.
  A strict budget of 24 extension title writes per minute remains.
- After a verified completion, incidental conversation POSTs cannot
  restart `generating` without a fresh Send/Retry user action.
  Ignored request IDs are skipped by the page watcher; the worker
  receives an explicit veto and persists that request state to avoid
  delayed background notifications or sounds. Genuine user submissions
  still show the hourglass and notify **after the finished response is
  positively verified**. This closes a
  `✅` -> `⏳` regression caused by unrelated endpoint traffic.
- Focus and visibility events never recolor a settled conversation or
  rewrite its title when the route has not changed. Favicons update in
  place; confirmed swatches remain visible during worker allocation.
  A bounded one-time startup pass recovers confirmed colors from open
  tabs and corrects duplicate reservations. Palette allocation excludes
  every reserved swatch, not just the first 40.
- Old conversation turns containing error phrases are ignored, including
  nested status elements. "Try again" on a failed-load page maps to
  `conversation_load_failed`, never a generic warning.
- Extension upgrades perform a one-time in-place reinjection. Versioned
  title/response owners detach listeners, cancel pending checks, and retire
  observers before taking over from cooperating prior builds.
  Existing tabs are not navigated/reloaded by the extension.
  A document still running the v0.1.24 decorator may need one
  final page reload to retire its older event listeners. Beginning with
  v0.1.25, a DOM owner lease also makes superseded decorators inert
  across separate isolated extension worlds on future updates.
  Favicon writes are also bounded.
- The notification body uses only fixed text "Response finished." Web Audio
  renders a two-tone chime; native OS notification sounds remain enabled.
  Clicking the notification activates the originating browser tab.
- Native completion notifications use the same color PNG as their source
  tab, with no conversation ID or answer text embedded in the icon.
- No telemetry, third-party analytics, password handling, private
  conversation identifiers in tests, or conversation-text storage/uploads.

The upstream ChatGPT HTML and backend are not a stable public API. Synthetic
tests reduce risk but cannot guarantee a future production site version
will always be detected correctly.

## Tests

From the repository root, run npm --prefix extensions/chatgpt-tab-signal test
for Node tests, golden color vectors, simulations, and safety checks.

GitHub Actions additionally exercises the real unpacked extension in
disposable Chromium, Microsoft Edge Stable, and Chrome for Testing profiles
on *synthetic intercepted ChatGPT pages*. It checks 24 tabs, simultaneous
responses, 24 distinct allocated colors, actual native tab-strip PNGs, idle
identity, project distinction,
both error statuses, manual Stop, request storms, sound, notifications,
and thousands of benign head changes. It never opens a personal profile.

## Privacy and attribution

No personal sessions, conversation bodies or account IDs are needed to
test this extension. Public test fixtures must use synthetic identifiers.

AGPL-3.0-only. Adapted from
[ramhaidar/ChatGPT-Response-Complete-Notifier](https://github.com/ramhaidar/ChatGPT-Response-Complete-Notifier).
See LICENSE and UPSTREAM.md for attribution and provenance.
