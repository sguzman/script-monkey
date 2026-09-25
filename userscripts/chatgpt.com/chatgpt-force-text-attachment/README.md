# ChatGPT Force Text Attachment

Tampermonkey userscript for one deterministic ChatGPT clipboard operation:

- `Ctrl+V` keeps normal browser / ChatGPT paste behavior.
- `Alt+V` means **clipboard text -> `.txt` attachment**.
- `Alt+B` is the Linux-safe alternate for the same forced attachment action.
- There is no size threshold.
- The forced shortcut never falls back to inserting the text into the composer.

The generated file is named like `clipboard-20260925-133700.txt`.

## Install

Install `chatgpt-force-text-attachment.user.js` with Tampermonkey (or another compatible userscript manager), then reload `chatgpt.com`.

## Behavior

Focus the ChatGPT composer and press `Alt+V` or `Alt+B`. The script reads plain text from the clipboard, converts it into a browser `File`, and hands that file to ChatGPT as an attachment.

Ordinary `Ctrl+V` is untouched.

If forced attachment fails, the script leaves the composer untouched. It deliberately does **not** paste the clipboard text as a fallback.

## v0.4.0 Linux / current-ChatGPT hardening

v0.4.0 makes failure stages explicit instead of collapsing them into one generic error:

1. The hotkey handler immediately shows that ChatGPT received the shortcut.
2. Clipboard-read failures include the browser error and clipboard permission state when available.
3. The upload path prefers ChatGPT's current `#upload-files` input.
4. If no compatible file input exists yet, the script opens the current `[data-testid="composer-plus-btn"]` attachment menu and waits briefly for upload controls to appear.
5. Direct file-input injection remains the preferred path.
6. Synthetic file paste is attempted next.
7. Synthetic drag/drop is the final fallback.
8. Every path preserves the hard contract: **attach or fail; never dump clipboard text inline**.

`Alt+B` exists because browser / Linux keyboard handling can consume `Alt+V` before the page sees it. If `Alt+V` produces no "hotkey received" toast, try `Alt+B`. That distinguishes a keyboard-routing failure from a clipboard or upload failure immediately.

## Diagnostics

`CONFIG.debug` is enabled in v0.4.0. Console messages use the prefix:

`[chatgpt-force-text-attachment]`

The visible toasts are intentionally stage-specific:

- no hotkey toast: the page never received the shortcut or the script is not running;
- clipboard-read failure toast: Edge blocked or could not expose clipboard text;
- "read ... chars; attaching...": clipboard access succeeded and the failure, if any, is in ChatGPT's upload path;
- final input/paste/drop failure: every attachment handoff path was rejected.
