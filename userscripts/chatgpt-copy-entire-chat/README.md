# ChatGPT Copy Entire Chat

Tampermonkey userscript for copying the entire current ChatGPT conversation into one ordered plain-text transcript.

The problem this project is specifically designed around is ChatGPT's long-conversation virtualization: older turns can be de-registered from the DOM until the page is scrolled back through them. A one-shot DOM scrape is therefore not considered correct behavior.

## Behavior

Run **Copy entire current ChatGPT chat** from the Tampermonkey menu while a ChatGPT conversation is open.

The script:

1. Captures the currently mounted conversation turns.
2. Drives the conversation to the top and keeps waiting for older history to arrive.
3. Uses ChatGPT's `conversation-turn-N` numbering as an oldest-boundary proof; it does not treat a temporarily stable scroll position as proof that history is exhausted.
4. If older history stops appearing before the beginning is proven, periodically scrolls slightly away from the top and returns to retrigger top-boundary loading.
5. Resets its quiet timer every time earlier turns appear, which makes slow connections safe rather than prematurely terminal.
6. Accumulates captured turns in memory before ChatGPT can virtualize them away again.
7. Once the beginning is proven, walks from oldest to newest while continuously capturing mounted batches.
8. Orders turns by ChatGPT's `conversation-turn-N` identifiers where available.
9. Copies a single transcript to the clipboard with `USER`, `ASSISTANT`, and other detected role headings.
10. Restores the user's approximate original scroll position; if invoked near the live end, it returns to the bottom.

A small status overlay reports capture progress and whether the script is still waiting for earlier history.

## Slow-connection correctness

The script must not silently confuse "nothing changed for a moment" with "this is the oldest message." On current ChatGPT pages, the first rendered conversation turn is numbered at the beginning of the `conversation-turn-N` sequence. The script therefore requires an earliest captured turn index at the beginning of that sequence before it will claim success.

If the beginning cannot be proven within the safety window, the command fails visibly and **does not copy a partial transcript**. This is intentional: a deceptively complete-looking clipboard is worse than an explicit failure.

## Install

Install `chatgpt-copy-entire-chat.user.js` with Tampermonkey (or another compatible userscript manager), then reload `chatgpt.com`.

## Test

1. Open a short ChatGPT conversation and run the Tampermonkey command.
2. Paste the clipboard into a text editor and confirm all visible turns are present and ordered correctly.
3. Open a long conversation where older messages disappear from the DOM during ordinary scrolling.
4. Start near the bottom and run the command.
5. Confirm the status overlay can remain in **Loading oldest history** while older chunks continue arriving; it should not immediately assume the first top position is the real beginning.
6. Confirm the reported first turn index moves downward as older history loads until the true beginning is reached.
7. Paste the result into a text editor and verify the actual first message, the actual last message, and several known messages from the middle.
8. Repeat on a deliberately slow or unstable connection if possible.
9. Repeat on a conversation containing code blocks, attachments/filenames, citations, and unusually long turns.

## Correctness invariants

- **Virtualization-safe:** already captured turns remain in the script's in-memory store even after ChatGPT unmounts them.
- **Oldest-boundary proof:** reaching `scrollTop = 0` is not sufficient; the beginning of the turn-number sequence must be observed before successful copy.
- **Slow-network-safe:** every newly discovered earlier chunk resets the oldest-history quiet period.
- **No deceptive partial success:** if the beginning cannot be proven, nothing is copied and an explicit failure is shown.
- **No private ChatGPT API dependency:** the script operates through the rendered conversation rather than undocumented backend conversation endpoints.
- **Stable ordering first:** `conversation-turn-N` is preferred over DOM position whenever ChatGPT exposes it.
- **No silent empty success:** failure to locate or extract conversation turns produces an explicit error status instead of copying an empty transcript.
- **User position preservation:** traversal is temporary and the script restores the user's approximate prior location.

## Known limitations / iteration targets

ChatGPT's DOM is private implementation detail and can change. The oldest-boundary proof currently depends on ChatGPT continuing to expose stable `conversation-turn-N` numbering whose sequence begins at the start of the active conversation. If OpenAI changes that convention, the script should fail conservatively rather than silently emit a partial transcript.

Unusual message renderers may require additional extraction logic. The project deliberately favors a small, inspectable traversal/extraction core so failures can be reproduced and fixed in this repository rather than hidden behind a large selector pile.

The script copies visible rendered text, not hidden model metadata or deleted/branched content that is not represented in the active conversation UI.

Set `CONFIG.debug` to `true` for console diagnostics while investigating a regression.
