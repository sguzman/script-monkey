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

The script now:

1. Searches every current `input[type="file"]` candidate rather than depending on one private ChatGPT selector.
2. Dispatches both `input` and `change` with bubbling/composition enabled.
3. Falls back to synthetic drag/drop across multiple composer/page targets.
4. Treats attachment success as visible appearance of the generated filename.

The ChatGPT DOM is private implementation detail, so future site changes can still require maintenance. Set `CONFIG.debug` to `true` for console diagnostics.
