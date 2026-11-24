# ChatGPT Auto-Continue

Standalone Tampermonkey userscript. No build, npm, Chat Queue dependency, or modifications to Chat Signals. This is an experimental initial implementation, **not yet tested on authenticated ChatGPT in Firefox**.

[Install the userscript](https://raw.githubusercontent.com/sguzman/script-monkey/main/userscripts/chatgpt.com/chatgpt-auto-continue/chatgpt-auto-continue.user.js)

## Start

1. Install/enable the existing Chat Signals extension and the userscript in a test browser profile. Open a disposable existing conversation (not a new-chat landing page).
2. Give the assistant an approved bounded plan and the status protocol below.
3. Click **Start** while a response is actively generating, or arm the script on a live idle/completed conversation and manually submit the first message. Historical restored or unknown state cannot start the loop. Do not put a pending draft or attachment in the composer.
4. Subsequent automatic sends are the literal message `continue`, only after a fresh matching assistant reply, observed generation, stable Signals completion and an exact final continuation marker. Click **Stop** at any time. Reloading does not restart a loop.

The settings gear controls the maximum automatic sends (default 30, range 1–100), inter-iteration delay (default 3 seconds), and independent desktop notification and sound toggles for each event. Settings apply to the next run. Existing Chat Signals alerts are independent and may still sound on each response; this script cannot suppress them. No stop condition is disabled by a notification preference.

## Project protocol (global custom instructions)

Apply only to approved ongoing projects. A message of "continue" authorizes the next unfinished part of the approved plan, not expansion of scope. Execute meaningful work, do not repeat completed steps, and never invent work, artifacts, commits, test results or verification. Maintain accurate accounting, persist artifacts promptly in the designated durable source of truth, verify persistence, and make the project resumable. Batch human QA. Stop when the approved acceptance criteria are met. If already done, report completion without inventing further work.

End each project-related response with exactly one plain, standalone final paragraph:

| Marker | Meaning |
| --- | --- |
| `[[CONTINUE]]` | Actionable unfinished work remains |
| `[[ALL_DONE]]` | Approved scope complete; available verification performed |
| `[[QA_REQUIRED]]` | Human inspection/test needed |
| `[[INPUT_REQUIRED]]` | Human input/decision needed |
| `[[BLOCKED]]` | Cannot proceed |
| `[[WAITING]]` | External dependency pending |
| `[[CONTEXT_LIMIT]]` | Preserve work and hand off to a new chat |

Optionally emit a separate plain paragraph `[[MILESTONE]]` immediately before the final status. Put a blank line before each marker so Markdown creates separate paragraphs. Do not quote, bold, or put markers in code. Explain the required human action before the marker. Do not claim you know the exact context budget if unavailable. Marker claims are model assertions, not independent proof of completed work.

## Safety / limits

- Per-conversation Web Lock; no automatic restart or retry. Same-conversation competing runs fail closed.
- Requires existing Signals page metadata and title agreement; page metadata is not browser-attested. Not equivalent to Signals' authenticated extension bridge. Only local UI signals and marker-shaped paragraphs are inspected; no API interception, transcript storage or network transmission by this script.
- Requires a fresh observed generation and matching user/assistant message IDs. Unknown/mismatched states, timeouts, unexpected navigation or composer interaction stop the loop. A missed short response may stop safely. Composer insertion is experimental and may leave an unsent `continue` draft if verification fails.
- Browser throttling, suspended tabs, DOM changes, notification permissions, audio policies and composer variants can prevent operation. This does not bypass ChatGPT usage limits.
- OpenAI's [consumer terms](https://openai.com/policies/terms-of-use/) restrict programmatic extraction of output. Personal automated marker inspection is not explicitly exempted; assess that before use. The API is the supported programmatic route.

## Initial QA checklist

Use a disposable chat and set the limit to 2:
- [ ] Start during generation; one exact continuation is submitted only after the first fresh `[[CONTINUE]]`.
- [ ] Repeat with a terminal status; observe no further submission and configured alert.
- [ ] Test missing marker, two markers, existing draft, disabled send, error and navigation; no automated send.
- [ ] Start on a finished conversation; verify no automatic send until the first manual turn.
- [ ] Open the same conversation twice; only one active loop is allowed.
- [ ] Stop manually during a delay; confirm nothing sends.
- [ ] Reload; no active loop resumes.
- [ ] Check background tab completion, notification permission and audio on Firefox Developer Edition.

Initial isolated checks: 11 parser/Signals classification cases passed during authoring. No DOM integration, syntax tooling or real browser QA has been performed yet. 
