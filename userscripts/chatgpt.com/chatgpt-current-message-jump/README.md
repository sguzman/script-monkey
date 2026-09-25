# ChatGPT Current Message Jump

Tampermonkey userscript for jumping back to the **start of the current exchange** without manually scrolling through a huge ChatGPT response.

## Behavior

- Appears only when the current assistant message is taller than the usable viewport and its top has already scrolled well off screen.
- Treats the assistant message crossing the vertical center of the usable chat viewport as the current message, falling back to the assistant message with the largest visible area.
- Clicking `↑` jumps to the **conversation turn immediately preceding the active assistant turn**. In normal ChatGPT conversation structure, that is the user's prompt turn, including attachments or other UI/content contained inside that turn.
- Exchange-start resolution deliberately does **not** depend on `data-message-author-role="user"`; real testing showed that marker is not reliable enough on current ChatGPT user turns.
- Long chats are handled as a separate virtualization case. If the preceding turn is not currently mounted/rendered, the script first jumps to the known assistant boundary, probes slightly upward until ChatGPT mounts the adjacent predecessor, then aligns that predecessor at the top. This keeps the operation one-click even when ChatGPT has de-registered older DOM nodes.
- The active assistant turn is tracked by its `conversation-turn-*` test ID during this hydration sequence so normal scroll-triggered UI updates do not lose the target halfway through the jump.
- Uses instant scrolling rather than a long animated scroll.
- Re-evaluates on scrolling, resizing, and ChatGPT SPA DOM changes.
- Preserves the established vertical placement behavior while preferring the **right side** whenever it is actually clear.

## Hard placement rule: never cover useful UI or rendered message content

The arrow is deliberately **not** a generic floating button placed blindly over the conversation.

The preferred position is near the right edge of the viewport. ChatGPT often gives paragraph and message containers widths that are substantially wider than the text visibly rendered inside them, so container geometry alone is not treated as proof that the space is occupied.

For right-side placement, the script checks the proposed button footprint against the actual rendered line rectangles of visible message content, as well as point-level DOM hit testing for interactive UI. This means visually empty space inside an oversized paragraph/container can be used, while actual text, code/writing blocks, tables, figures, buttons, links, inputs, dialogs, and the `chatgpt-sticky-copy` overlay remain protected.

If the preferred right-edge position is unsafe, the script next tries a conventional right gutter and finally the left gutter. If no safe position exists, the arrow stays hidden. **Missing the arrow is preferable to covering content, the sticky Copy button, the composer, or another control.**

Broad layout containers such as `nav` or `aside` do **not** get to veto the arrow merely because their DOM rectangle spans otherwise empty screen space.

This is intentionally complementary to `../chatgpt-sticky-copy/`: Sticky Copy owns the lower-right area of a visible copy block, while Current Message Jump searches for a separate safe position.

## Install / update

Install `chatgpt-current-message-jump.user.js` with Tampermonkey or another compatible userscript manager. After installing or updating the script, reload any already-open ChatGPT tab before testing.

## Renderer resilience

ChatGPT has more than one live conversation renderer. The script accepts the legacy `conversation-turn-*` structure plus the newer shell/turn-key structure, recognizes role information from both `data-message-author-role` and `data-turn`, and treats repeated sections with the same `data-turn-id` as one logical assistant turn for visibility calculations.

When a logical assistant response is split across multiple native sections, the jump target skips sibling assistant fragments and resolves the preceding user turn instead. Newer shell exchanges that contain both sides in one native container are handled by targeting the whole exchange wrapper, because attachment cards/previews can sit above the inner user-message bubble. This keeps attachments visible instead of scrolling them off the top edge.

The injected control also self-heals if a ChatGPT renderer transition detaches it from the DOM.

## Current version

`0.7.1`
