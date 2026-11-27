# Gemini Force Text Attachment

Experimental, independent userscript for gemini.google.com. Install [the userscript](https://raw.githubusercontent.com/sguzman/script-monkey/main/userscripts/gemini.google.com/gemini-force-text-attachment/gemini-force-text-attachment.user.js) manually in Tampermonkey.

Focus the Gemini prompt, copy plain text and press **Ctrl+Shift+V**. The script captures a real native paste in an offscreen textarea, restores the draft focus and offers one timestamped .txt file to an unambiguous existing upload input. It never sends the prompt. Ordinary Ctrl+V is unchanged. No clipboard read permission, network API, dependency, auto-update or automatic retries.

If the input is absent or ambiguous, the script refuses rather than guessing. Clipboard content remains available for retry or manual saving. A status saying "File offered" does not establish successful attachment. Check for the file chip before sending. Limit: 4 MiB UTF-8.

## Compatibility and QA
- Firefox + Tampermonkey: unverified live.
- Chrome/Edge + Tampermonkey: unverified live.
- Gemini editor and upload selectors are preliminary, informed by public references rather than an authenticated DOM capture.
- Public reference: https://github.com/YosefHayim/ai-browser-bridge/blob/main/src/features/providers/gemini/geminiPage.ts
- Google upload help: https://support.google.com/gemini/answer/14903178

Use an isolated chat: test Ctrl+V normally; Ctrl+Shift+V with short multiline text and a draft; verify the exact file chip appears and draft remains unchanged; test missing input, multiple inputs, empty clipboard and navigation. No other scripts are required.
