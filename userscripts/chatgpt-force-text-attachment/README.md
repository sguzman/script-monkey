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

If forced attachment fails, the script shows an error toast and leaves the composer untouched. It deliberately does **not** paste the clipboard text as a fallback.

## Implementation notes

The script intercepts the real browser `paste` event so it can read `event.clipboardData` without requesting persistent clipboard permissions. It converts the plain text to a browser `File`, first attempts ChatGPT's file input, then tries a synthetic file drop as a fallback.

The ChatGPT DOM is private implementation detail, so upload selectors may occasionally need maintenance when the site changes. Set `CONFIG.debug` to `true` for console diagnostics.
