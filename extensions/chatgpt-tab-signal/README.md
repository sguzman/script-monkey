# ChatGPT Tab Signal

A small Manifest V3 extension for Edge, Chrome, and Chromium.
While ChatGPT generates a response, the tab favicon shows a gray signal.
After completion it becomes green for a focused tab or blue for an unread
background tab, accompanied by a short chime and desktop notification.
Chat conversation tab titles also show a stable color emoji derived from the
conversation URL. The favicon remains reserved for generation status.
There is no toolbar button, popup or configuration UI.

## Usage

**Version 0.1.14: automatic operation, no activation controls.**

Install the unpacked extension from this directory through your browser's
extension management page (Developer mode > Load unpacked). Once installed,
the extension works automatically for future conversation requests.

There is **no popup**, global enable switch, per-tab permission workflow,
second login, or background daemon to configure. Tabs are left untouched
until they make a matching ChatGPT conversation request.

Only the **small title-color decorator** loads on ordinary and project chat
pages, including idle conversations. On install/update it also makes a
**one-time, bounded pass** over up to 40 already-open chat tabs, without
reloading them. Non-chat pages are left alone. The response watcher and
favicon modifications are still lazily activated **only** by a matching
conversation POST; idle tab favicons remain unchanged. Subsequent response
requests in the same document reuse the existing watcher.

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
- Uses Chrome's actual request `documentId` to distinguish a real
  page reload from ChatGPT's same-document `/` to `/c/<id>` transition.
  This preserves the first response's completion notification while allowing
  a fresh, bounded injection after an actual document replacement.
- Cancels or rejects stale work on tab closure and superseded requests.
- State favicons use pre-rendered PNGs by temporarily updating ChatGPT's
  existing <link rel="icon"> declarations in place, then restoring the
  original links on idle or abort. No competing favicon link or extension
  toolbar button is introduced; no DOM observers or polling are used.
- The status watcher has no DOM observers, polling, full transcript searches,
  conversation-content extraction or title writes. A separate, narrowly scoped
  `<title>`-only observer maintains the color prefix when ChatGPT changes its
  own title, with a maximum of 24 extension title writes per minute. It never
  observes the whole `<head>` or changes the favicon.
- The desktop notification uses the conversation title but fixed body text
  **Response finished.** No answer preview is read from the page.
- Offscreen Web Audio produces a two-tone chime (740 Hz then 988 Hz, about
  0.7 seconds). It reports success only after both tones render and its
  audio clock advances. The notification also permits any desktop-managed
  alert sound instead of forcing silent mode.
- Successful browser-side audio rendering does not guarantee the user's
  speakers are audible: browser or system mute, output routing and notification
  daemon settings remain controlled by the operating system.

**Testing reduces risk but cannot guarantee that no browser version or
live ChatGPT response will ever malfunction.** The ChatGPT backend API is
not a stable extension interface; changes may cause missing or premature
signals. The test harness uses synthetic network responses and pages, not
authenticated production conversations.

## Stable conversation color API

`conversation-color.js` is a dependency-free JavaScript module for reuse in
browser scripts or Node programs. In Node:

```js
const { fromUrl } = require('./conversation-color.js');
const color = fromUrl('https://chatgpt.com/c/12345678-1234-4234-8234-1234567890ab');
// {kind:'chat', key:'chat:...', hue:41, hex:'#dfab3a', emoji:'🟧', ...}
```

In the browser, include `conversation-color.js` and call
`ChatGPTConversationColor.fromUrl(url)`. The API also exposes `parse(url)` and
`hash32(key)`, plus `version: 1`. Hash inputs and color conversion are frozen
in `tests/conversation-color.cjs` so other projects can generate matching hues
without depending on a background service, storage, or this extension.

- Normal conversations: `/c/<chat-id>`, square emoji marker.
- Project conversations: `/g/g-p-<project-id>/c/<chat-id>`, round emoji marker.
- Custom GPT conversations: `/g/g-<gpt-id>/c/<chat-id>`, square emoji marker.
- Non-chat URLs, including project homepages and shared links: no color.

The precise color is generated from the namespaced identity using FNV-1a
32-bit + HSL-to-RGB (72% saturation, 55% lightness). The title emoji is a
**six-color approximation**: browser tab titles cannot contain arbitrary RGB
swatches. Different chats can share the same emoji or similar hues; uniqueness
is not guaranteed. The stable `hex` and `key` are available to future tools.

## Tests

Run `npm --prefix extensions/chatgpt-tab-signal test` from the repository
root for syntax, static safety constraints, and worker/content simulations.

GitHub Actions also tests the unpacked extension with intercepted synthetic
ChatGPT pages in disposable profiles of **Google Chrome for Testing**, **Microsoft
Edge Stable**, and **Chromium**. Tests cover simultaneous responses across many tabs, idle-title coloring,
project-chat route isolation, notifications, sound context creation, manual
Stop, request storms, favicon updates and renderer safety in synthetic pages.

## Privacy and attribution

No telemetry, password handling, external analytics, or conversation-text
collection. Native desktop notifications may be visible to others using
the same desktop.

AGPL-3.0-only. Adapted from
[ramhaidar/ChatGPT-Response-Complete-Notifier](https://github.com/ramhaidar/ChatGPT-Response-Complete-Notifier).
See `LICENSE` and `UPSTREAM.md` for attribution and provenance.
