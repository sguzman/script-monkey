# ChatGPT Current Message Jump

Tampermonkey userscript for navigating long ChatGPT exchanges with a **two-button floating stack**: **↑** to the start of the current exchange and **↓** to the next message below (or the end of the current response if it is the last message).

## Behavior

- The **↑** button appears on long assistant messages after their start scrolls offscreen. The **↓** button appears beneath it (8px gap) only while useful downward navigation remains. At the bottom of a conversation, or when the final response has ended, **↓** disappears independently while **↑** remains available.
- Treats the assistant message crossing the vertical center of the usable chat viewport as the current message, falling back to the assistant message with the largest visible area.
- Clicking `↑` jumps to the **conversation turn immediately preceding the active assistant turn**. In normal ChatGPT conversation structure, that is the user's prompt turn, including attachments or other UI/content contained inside that turn.
- Clicking `↓` jumps to the **next logical conversation turn below the active assistant turn**, skipping duplicate sections that belong to the same logical message. When there is no next turn, it jumps to the end of the current response instead.
- Exchange-start resolution deliberately does **not** depend on `data-message-author-role="user"`; real testing showed that marker is not reliable enough on current ChatGPT user turns.
- Long chats are handled as a separate virtualization case. If the preceding turn is not currently mounted/rendered, **↑** jumps to the known assistant boundary and probes upward to hydrate the predecessor. Similarly, **↓** uses the assistant's end boundary and probes downward for a virtualized next turn. Once a target is available, the relevant turn is aligned to the top.
- The active assistant turn is tracked by its `conversation-turn-*` test ID during this hydration sequence so normal scroll-triggered UI updates do not lose the target halfway through the jump.
- Uses instant scrolling rather than a long animated scroll.
- Re-evaluates on scrolling, resizing, and ChatGPT SPA DOM changes.
- Preserves the established vertical placement behavior while preferring the **right side** whenever it is actually clear.

## Hard placement rule: never cover useful UI or rendered message content

The arrows are deliberately **not** generic floating controls placed blindly over the conversation. When both are needed, collision checks cover the entire 88px stack. When **↓** is unnecessary or no safe space exists for the pair, **↑** can appear alone in a safe 40px space.

The preferred position is near the right edge of the viewport. ChatGPT often gives paragraph and message containers widths that are substantially wider than the text visibly rendered inside them, so container geometry alone is not treated as proof that the space is occupied.

For right-side placement, the script checks the proposed **stack footprint** against the actual rendered line rectangles of visible message content, as well as point-level DOM hit testing for interactive UI at both button positions. This means visually empty space inside an oversized paragraph/container can be used, while actual text, code/writing blocks, tables, figures, buttons, links, inputs, dialogs, and the `chatgpt-sticky-copy` overlay remain protected.

If the preferred right-edge position is unsafe, the script next tries a conventional right gutter and finally the left gutter. When the pair does not fit, it retries with **↑** alone; if no safe position exists, the controls remain hidden. **Missing an arrow is preferable to covering content, the sticky Copy button, the composer, or another control.**

Broad layout containers such as `nav` or `aside` do **not** get to veto the arrow merely because their DOM rectangle spans otherwise empty screen space.

This is intentionally complementary to `../chatgpt-sticky-copy/`: Sticky Copy owns the lower-right area of a visible copy block, while Current Message Jump searches for a separate safe position.

## Install / update

Open the [direct Tampermonkey install/update link](https://raw.githubusercontent.com/sguzman/script-monkey/main/userscripts/chatgpt.com/chatgpt-current-message-jump/chatgpt-current-message-jump.user.js), accept the update, then reload any already-open ChatGPT tab. GitHub commits alone do not update an installed userscript; v0.8.1 adds `@updateURL` and `@downloadURL` for future Tampermonkey update checks.

## Renderer resilience

ChatGPT has more than one live conversation renderer. The script accepts the legacy `conversation-turn-*` structure plus the newer shell/turn-key structure, recognizes role information from both `data-message-author-role` and `data-turn`, and treats repeated sections with the same `data-turn-id` as one logical assistant turn for visibility calculations.

When a logical assistant response is split across multiple native sections, the jump target skips sibling assistant fragments and resolves the preceding user turn instead. Newer shell exchanges that contain both sides in one native container are handled by targeting the whole exchange wrapper, because attachment cards/previews can sit above the inner user-message bubble. This keeps attachments visible instead of scrolling them off the top edge.

Both injected controls self-heal if a ChatGPT renderer transition detaches either one from the DOM.

## Current version

`0.8.2`
