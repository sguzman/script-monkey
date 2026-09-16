# ChatGPT Current Message Jump

Tampermonkey userscript for jumping back to the top of the **current long assistant message** without manually scrolling through a huge ChatGPT response.

## Behavior

- Appears only when the current assistant message is taller than the usable viewport and its top has already scrolled well off screen.
- Treats the assistant message crossing the vertical center of the usable chat viewport as the current message, falling back to the assistant message with the largest visible area.
- Clicking `↑` jumps directly to the top of that assistant message.
- Uses instant scrolling rather than a long animated scroll.
- Re-evaluates on scrolling, resizing, and ChatGPT SPA DOM changes.

## Hard placement rule: never cover useful UI

The arrow is deliberately **not** a generic floating button placed over the conversation.

It tries to live in empty horizontal gutter space just outside the visible assistant-content bounds. Candidate positions are checked with point-level DOM hit testing across the proposed button footprint. A position is rejected when an actual visible interactive element is physically under the arrow, including buttons, links, inputs, dialogs, and the `chatgpt-sticky-copy` overlay (`.sm-sticky-copy-button`).

Broad layout containers such as `nav` or `aside` do **not** get to veto the arrow merely because their DOM rectangle spans otherwise empty screen space. This replaced the over-conservative v0.1 collision logic after real testing caused the arrow to remain hidden on long messages.

If there is no safe gutter position, the arrow stays hidden. **Missing the arrow is preferable to covering content, the sticky Copy button, the composer, or another control.**

This is intentionally complementary to `../chatgpt-sticky-copy/`: Sticky Copy owns the lower-right area of a visible copy block, while Current Message Jump looks for a separate safe gutter outside message content.

## Install / update

Install `chatgpt-current-message-jump.user.js` with Tampermonkey or another compatible userscript manager. After installing or updating the script, reload any already-open ChatGPT tab before testing.

## Current version

`0.2.0`
