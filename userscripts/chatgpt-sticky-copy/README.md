# ChatGPT Sticky Copy Button

Keeps a copy control available for long copyable blocks in ChatGPT without covering the message composer.

ChatGPT normally places a block's native **Copy** control in its header. On a long code block or newer writing block, that control can scroll away even while most of the block is still on screen. This userscript adds a small floating proxy near the block's lower-right edge whenever the native Copy control is offscreen.

## Behavior

- Supports the older gray code/copy blocks and the newer rich/writing-block UI.
- Detects ChatGPT block-level Copy controls near the top of a substantial block.
- Does **not** replace the normal native control while that control is visible.
- When the block header scrolls away, shows a `Copy` button near the lower-right of the visible portion of the same block.
- Leaves a bottom breathing margin instead of hugging the viewport or block edge.
- Treats the ChatGPT message composer as a hard exclusion zone. The floating button is never intentionally placed over the prompt textbox, attachment area, or send controls.
- Uses the live composer position as the lower boundary, so a growing multiline prompt or attachment area reduces the available space automatically.
- If there is not enough safe block area above the composer for the button, the floating control hides instead of overlapping the composer.
- Clicking the floating control delegates to ChatGPT's own native Copy button, preserving ChatGPT's copy semantics.
- If ChatGPT removes the native control from the DOM, falls back to copying the block's rendered text through Tampermonkey.
- Ignores ordinary `Copy response` / `Copy message` actions at the bottom of assistant turns.
- Watches ChatGPT's dynamic DOM so newly streamed or newly opened blocks are discovered without a reload.

## Install

Install the userscript directly in Tampermonkey from:

`https://raw.githubusercontent.com/sguzman/script-monkey/main/userscripts/chatgpt-sticky-copy/chatgpt-sticky-copy.user.js`

Tampermonkey should recognize the `.user.js` metadata and offer installation/update handling.

## Expected interaction

1. Open a ChatGPT conversation containing a long gray code block or a long writing block.
2. At the top of the block, use ChatGPT normally; the script stays out of the way while ChatGPT's own Copy control is visible.
3. Scroll downward until that original Copy control leaves the viewport while the block is still visible.
4. A compact `Copy` button should remain available near the lower-right edge of the block's visible area, with a small margin below it.
5. As the block approaches the message composer, the floating button should stay above the composer. If there is no safe room left, it should disappear.
6. Press it. It should perform the same copy action as ChatGPT's native control and briefly read `Copied`.

## Scope

Matches only `chatgpt.com` / `www.chatgpt.com`.

Version: `0.2.0`
