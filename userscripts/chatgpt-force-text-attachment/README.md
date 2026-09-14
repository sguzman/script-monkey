# ChatGPT Force Text Attachment

Tampermonkey userscript for one deterministic paste operation in ChatGPT:

- `Ctrl+V` keeps normal browser / ChatGPT paste behavior.
- `Ctrl+Shift+V` means **clipboard text -> `.txt` attachment**.
- There is no size threshold.
- The forced shortcut never falls back to inserting the text into the composer.

The generated file is named like `clipboard-20260914-054812.txt`.

## Install

Install `chatgpt-force-text-attachment.user.js` with Tampermonkey (or another compatible userscript manager), then reload `chatgpt.com`.

## Test

1. Copy a block of plain text.
2. Focus the ChatGPT composer.
3. Press `Ctrl+Shift+V`.
4. Confirm a `.txt` attachment appears and the composer itself remains empty.
5. Press ordinary `Ctrl+V` separately and confirm normal paste behavior is unchanged.
6. Repeat with a very large clipboard payload and confirm it still never appears inline in the composer.

If forced attachment fails, the script shows an error toast and leaves the composer untouched. It deliberately does **not** paste the clipboard text as a fallback.

## Paste safety invariant

`Ctrl+Shift+V` is **attachment-or-failure**. The browser/page paste is intercepted at `window` capture phase before ChatGPT's document/React handlers can consume it. The script cancels that paste synchronously before starting any asynchronous attachment work.

A short `beforeinput` guard also blocks any trailing `insertFromPaste` insertion associated with the forced paste. This specifically protects against the regression where one shortcut produced both a `.txt` attachment and the same clipboard text inline in the composer.

The force-attachment arm is bounded rather than persistent. v0.2.0 changed the original bounded arm into an indefinitely pending one-shot while hardening large clipboard handling; v0.2.1 restores a bounded one-shot with a longer window and earlier paste interception.

## Implementation notes

The script intercepts the real browser `paste` event so it can read `event.clipboardData` without requesting persistent clipboard permissions. It converts the plain text to a browser `File`, first attempts ChatGPT's file input, then tries a synthetic file drop as a fallback.

The ChatGPT DOM is private implementation detail, so upload selectors may occasionally need maintenance when the site changes. Set `CONFIG.debug` to `true` for console diagnostics.
