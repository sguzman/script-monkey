# ChatGPT Copy Entire Chat

Tampermonkey userscript for copying the entire current ChatGPT conversation into one ordered plain-text transcript.

The problem this project is specifically designed around is ChatGPT's long-conversation virtualization: older turns can be de-registered from the DOM until the page is scrolled back through them. A one-shot DOM scrape is therefore not considered correct behavior.

## Behavior

Run **Copy entire current ChatGPT chat** from the Tampermonkey menu while a ChatGPT conversation is open.

The script:

1. Captures the currently mounted conversation turns.
2. Repeatedly drives the conversation to the top so older turns can register/load.
3. Accumulates captured turns in memory before ChatGPT can virtualize them away again.
4. Walks from the oldest loaded position back toward the newest messages, continuously capturing mounted batches.
5. Orders turns by ChatGPT's `conversation-turn-N` identifiers where available.
6. Copies a single transcript to the clipboard with `USER`, `ASSISTANT`, and other detected role headings.
7. Restores the user's approximate original scroll position; if invoked near the live end, it returns to the bottom.

A small status overlay reports capture progress and the final number of turns/characters copied.

## Install

Install `chatgpt-copy-entire-chat.user.js` with Tampermonkey (or another compatible userscript manager), then reload `chatgpt.com`.

## Test

1. Open a short ChatGPT conversation and run the Tampermonkey command.
2. Paste the clipboard into a text editor and confirm all visible turns are present and ordered correctly.
3. Open a long conversation where older messages disappear from the DOM during ordinary scrolling.
4. Start near the bottom and run the command.
5. Confirm the page walks through the conversation, reports increasing capture counts, and returns to the original area afterward.
6. Paste the result into a text editor and verify the first and last turns plus several known messages from the middle.
7. Repeat on a conversation containing code blocks, attachments/filenames, citations, and unusually long turns.

## Correctness invariants

- **Virtualization-safe:** already captured turns remain in the script's in-memory store even after ChatGPT unmounts them.
- **No private ChatGPT API dependency:** the script operates through the rendered conversation rather than undocumented backend conversation endpoints.
- **Stable ordering first:** `conversation-turn-N` is preferred over DOM position whenever ChatGPT exposes it.
- **No silent empty success:** failure to locate or extract conversation turns produces an explicit error status instead of copying an empty transcript.
- **User position preservation:** traversal is temporary and the script restores the user's approximate prior location.

## Known limitations / iteration targets

ChatGPT's DOM is private implementation detail and can change. Unusual message renderers may require additional extraction logic. The initial version deliberately favors a small, inspectable traversal/extraction core so failures can be reproduced and fixed in this repository rather than hidden behind a large selector pile.

The script currently copies visible rendered text, not hidden model metadata or deleted/branched content that is not represented in the active conversation UI.

Set `CONFIG.debug` to `true` for console diagnostics while investigating a regression.
