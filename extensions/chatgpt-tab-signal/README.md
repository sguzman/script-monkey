# ChatGPT Tab Signal

A small Manifest V3 extension for Microsoft Edge, Chrome, and Chromium.
Each conversation gets a **stable, deterministic color favicon**. A title emoji
communicates response state. Successful responses still have the familiar
two-note chime, desktop notification, and click-to-focus behavior.

## Title statuses

| Prefix | Status |
| --- | --- |
| None | Idle: no generation or pending alert |
| ⏳ | Generating |
| 🔔 | Finished in background; unread |
| ✅ | Finished and viewed |
| ⚠️ | Request/network failure or visible error banner |
| 🛑 | Conversation reached its maximum-length limit |

A network failure and a terminal conversation-length limit have different
indicators. Neither produces a false "Response finished" notification.
Manual Stop returns to idle rather than showing a network error.

Error detection is **best effort**, not an omniscient network monitor. It
recognizes failed conversation POSTs and a limited set of red alert/toast
banners, including "Message delivery timed out" and "You've reached the
maximum length for this conversation". New or substantially different site
wording may require updating the detector.

## Installation and operation

**Version 0.1.15.** Load the unpacked extension from this directory in the
browser extension-management page using Developer mode > Load unpacked.
No popup, toolbar button, global switch, login, or companion service.

The lightweight identity decorator loads on normal, project, and custom-GPT
conversation URLs, even for idle chats. On install/update a **one-time, bounded**
pass decorates up to 40 already-open conversation tabs without reloading them.
The heavier response watcher only loads for a conversation tab after its own
matching POST. Unrelated ChatGPT pages and other websites are not decorated.

A 32×32 **PNG** favicon is rendered once per conversation identity.
Normal chats and custom-GPT chats use a square; project chats use a circle.
Existing favicon links are updated in place. Their original attributes are
restored when navigating away. Status changes never recolor the favicon.

## Public color algorithm: v1

The reference implementation is conversation-color.js, a dependency-free
JavaScript file suitable for reuse by any program. Identical inputs yield
identical hex colors across browser extensions and native programs, without
interprocess communication, network requests, entropy, or storage.

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

## Safety

- Watches only matching ChatGPT conversation POST endpoints.
- Uses actual Chrome document IDs to distinguish reloads from SPA route
  changes; only the requesting tab receives an update.
- Caps lifecycle work at 60 events per tab per minute. Overflow fails
  closed and cancels pending status timers.
- Uses one cancellable 2.5-second completion timer and, only on a failed
  request, one additional cancellable 1.6-second delayed error-banner check.
- Error-banner checks run on activation/focus and response/failure lifecycle,
  not on streamed tokens. They examine no more than 36 candidates, reject
  candidate text over 320 characters, and exclude conversation-turn/code
  elements. They do not extract or send a transcript.
- There is no body/head MutationObserver or polling. The **only** persistent
  observer is on the tiny title element to preserve status as React changes
  titles, with a strict budget of 24 extension title writes per minute.
  Favicon writes are also bounded.
- The notification body uses only fixed text "Response finished." Web Audio
  renders a two-tone chime; native OS notification sounds remain enabled.
  Clicking the notification activates the originating browser tab.
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
responses, actual native tab-strip PNGs, idle identity, project distinction,
both error statuses, manual Stop, request storms, sound, notifications,
and thousands of benign head changes. It never opens a personal profile.

## Privacy and attribution

No personal sessions, conversation bodies or account IDs are needed to
test this extension. Public test fixtures must use synthetic identifiers.

AGPL-3.0-only. Adapted from
[ramhaidar/ChatGPT-Response-Complete-Notifier](https://github.com/ramhaidar/ChatGPT-Response-Complete-Notifier).
See LICENSE and UPSTREAM.md for attribution and provenance.
