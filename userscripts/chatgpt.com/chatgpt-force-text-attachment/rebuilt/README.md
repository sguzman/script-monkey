# ChatGPT Force Text Attachment

Firefox userscript, **v1.3.0**. This release removes **all programmatic clipboard reading**, including from the floating Clipboard button. No `navigator.clipboard.readText()`, userscript clipboard-read grants, or other clipboard-read API exists in this script.

## How to attach without a Firefox Paste permission dialog

- **Ctrl+Shift+V** anywhere on the ChatGPT page: a genuine native paste event supplies the clipboard text directly to the script, which turns it into a timestamped `.txt` attachment. The native paste is intercepted before it can overwrite the message draft. Ordinary **Ctrl+V** works normally.
- **Clipboard button**: click **Clipboard**, then press **Ctrl+V**. This two-step route is necessary for the userscript to access text without calling Firefox's permission-gated clipboard-read API. The button cannot read the clipboard silently from a single click. The capture expires after 12 seconds.

Both routes use a disposable offscreen paste target and restore prior editor focus, text selection, and contenteditable caret. On upload failure, the script never pastes text into the composer, submits a ChatGPT message, or retries automatically.

## Upload constraints

Text is capped at 4 MiB. ChatGPT can mount several file inputs, so the script ranks a known documents input (`#upload-files` or `data-testid="upload-files"`), current-composer inputs, labeled file/document inputs, and accept-type eligibility. Indistinguishable inputs are rejected rather than guessed.

Input discovery checks up to eight times at 125 ms. It may open the ChatGPT `+` menu **once**, but does not choose unknown menu items. Existing selected files are never replaced. After dispatching a single upload `change` event, it polls eighteen times at 200 ms for the generated filename; otherwise it reports an unconfirmed attachment.

## Install/update

**[Install or replace the userscript](https://raw.githubusercontent.com/sguzman/firefox-scripts/main/userscripts/chatgpt.com/chatgpt-force-text-attachment/chatgpt-force-text-attachment.user.js)**.

The new script retains the same `@name` and `@namespace` as v1.2.0. **Reload ChatGPT after updating.** Tampermonkey can have another similarly named userscript installed from the older `sguzman/script-monkey` repository: **ChatGPT - Force Text Attachment** (v0.6.2). That legacy script still calls the permission-gated clipboard API. Disable it if both are installed, so only **ChatGPT Force Text Attachment (Firefox)** v1.3.0 remains enabled for ChatGPT.

The newer script has no clipboard-read code, but an older userscript or another extension can independently invoke Firefox's permission-gated API and show the same dialog. The repository's automated synthetic Firefox tests do not prove that this local browser configuration has no competing script.

The button mounts beside the ChatGPT composer and is styled inversely to the browser theme.
