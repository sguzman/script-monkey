# ChatGPT Force Text Attachment

Tampermonkey userscript that floats a **Clipboard** button **outside** ChatGPT's message composer, aligned to the left of its `+` control. It does not insert any elements into the composer or alter its layout.

Click **Clipboard** to read the current plain-text clipboard and attach it as a `.txt` file. No keyboard shortcut or size threshold is involved, and ordinary paste remains untouched.

The generated file is named like `clipboard-20261011-180000.txt`. The button is disabled during attachment so a second click cannot start a duplicate upload.

## Install or update

Open the [direct Tampermonkey install/update link](https://raw.githubusercontent.com/sguzman/script-monkey/main/userscripts/chatgpt.com/chatgpt-force-text-attachment/chatgpt-force-text-attachment.user.js), accept the installation or update prompt, then reload `chatgpt.com`. A GitHub commit does **not** itself update an installed userscript. Version 0.5.2 introduced `@updateURL` and `@downloadURL` so Tampermonkey can check future releases.

## Behavior

- The **Clipboard** button floats outside the composer, aligned vertically with the `+` control. It has a visible border and background and never takes space from the text box. If there is no room to the left, it moves above the composer without covering the text input.
- A click requests clipboard permission if necessary, creates a browser `File` and hands it to ChatGPT as an attachment.
- Upload success is reported only when the generated filename appears in the composer attachment UI; a file input merely retaining its FileList is not proof of upload.
- If attachment fails, the script displays an error toast and **does not** paste the text into the composer.
- The prior `Alt+V` shortcut was removed in v0.5.0.

## ChatGPT upload compatibility

ChatGPT does not guarantee that a file input is permanently mounted. The existing attachment engine:

1. Looks first for a composer-local generic file input.
2. If necessary, activates ChatGPT's composer `+` button to expose the upload input.
3. Ranks compatible text-file inputs, preferring composer-local inputs, and rejects image-only or other non-text accept lists.
4. Dispatches `input` and `change` events after assigning the generated text file.
5. Checks for attachment evidence instead of assuming success.
6. Tries a single synthetic drag/drop only if there is no usable upload input. It never retries after sending an upload event that could still be processing.

Upload confirmation uses a bounded, low-frequency composer-local filename check, not a page-wide mutation observer or full-document file-input scan. An unconfirmed upload is reported as **unconfirmed**, not **attached**, and no text is pasted into the composer.

The button is positioned in a body-level fixed overlay rather than inside ChatGPT's composer. CSS anchor positioning tracks the composer as the sidebar opens or closes, including position-only transitions that do not fire resize events. If there is insufficient room on the left, the button moves above the composer instead of overlapping the text input. A lightweight observer remounts it only if the composer is replaced.

The ChatGPT DOM is private implementation detail and may change. For diagnostics, set `CONFIG.debug` to `true`.

## Current version

`0.6.2`
