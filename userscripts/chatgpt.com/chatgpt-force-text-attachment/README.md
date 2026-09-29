# ChatGPT Force Text Attachment

Tampermonkey userscript for one deterministic ChatGPT clipboard operation:

- `Ctrl+V` keeps normal browser / ChatGPT paste behavior.
- `Alt+V` means **clipboard text -> `.txt` attachment**.
- There is no size threshold.
- The forced shortcut never falls back to inserting the text into the composer.

The generated file is named like `clipboard-20260924-180000.txt`.

## Install

Install `chatgpt-force-text-attachment.user.js` with Tampermonkey (or another compatible userscript manager), then reload `chatgpt.com`.

## Behavior

Focus the ChatGPT composer and press `Alt+V`. The script reads plain text from the clipboard, converts it into a browser `File`, and hands that file to ChatGPT as an attachment.

Ordinary `Ctrl+V` is untouched.

If forced attachment fails, the script shows an error toast and leaves the composer untouched. It deliberately does **not** paste the clipboard text as a fallback.

## Why Alt+V changed the implementation

The old `Ctrl+Shift+V` implementation depended on the browser producing a real `paste` event so the script could read `event.clipboardData`. `Alt+V` is not a native paste shortcut, so v0.3.0 reads the clipboard directly from the user-initiated keypress via the Clipboard API.

This also removes the old arm-window / paste-event state machine entirely.

## ChatGPT upload compatibility

Current ChatGPT no longer guarantees that a usable file input is permanently mounted in the composer. v0.4.1 handles that by:

1. Looking first for a composer-local generic file input.
2. If none exists, activating ChatGPT's exact composer `+` control (`#composer-plus-btn` / `data-testid="composer-plus-btn"`) so the current upload surface is mounted.
3. Ranking the resulting file inputs so generic/multiple/composer-local inputs beat image-only or unrelated page inputs.
4. Dispatching both `input` and `change` after assigning the generated `.txt` file.
5. Requiring attachment-chip/UI evidence, or stable exact input evidence, before reporting success.
6. Falling back to synthetic drag/drop only after the native upload-input path fails.

The script deliberately avoids blindly touching unrelated page-level file inputs before the composer attachment surface has been activated.

The ChatGPT DOM is private implementation detail, so future site changes can still require maintenance. Set `CONFIG.debug` to `true` for console diagnostics.

## Current version

`0.4.1`
