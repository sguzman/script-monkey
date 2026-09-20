# ChatGPT Sticky Copy Button

Keeps a copy control available for long copyable blocks in ChatGPT without covering the message composer.

ChatGPT uses two relevant block styles here:

- Older gray code/copy blocks have a normal header Copy control that eventually scrolls away.
- Newer writing blocks use `data-testid="writing-block-container"` and keep their own header sticky at the top of the viewport, including the native Copy button.

The userscript handles those two surfaces differently while keeping the same lower-right proxy behavior.

## Behavior

- Supports the older gray code/copy blocks and the newer writing-block UI.
- Old gray blocks preserve the existing rule: while ChatGPT's native Copy control is visible, the floating proxy stays hidden. Once the native control scrolls away, the lower-right proxy appears.
- Writing blocks are recognized explicitly through `data-testid="writing-block-container"`.
- Writing blocks intentionally ignore the usual "native Copy is visible" suppression after the original block top scrolls offscreen, because ChatGPT keeps that native Copy button permanently visible inside a sticky header.
- At the natural top of a writing block, the proxy stays hidden to avoid an unnecessary duplicate. Once the writing block top scrolls above the viewport, the lower-right proxy can appear even though ChatGPT's own sticky Copy remains at the top.
- The floating button stays near the lower-right of the visible portion of the block and leaves a bottom breathing margin.
- The ChatGPT message composer is a hard exclusion zone. The floating button is never intentionally placed over the prompt textbox, attachment area, or send controls.
- The live composer position is used as the lower boundary, so a growing multiline prompt or attachment area reduces available space automatically.
- If there is not enough safe block area above the composer, the floating control hides instead of overlapping the composer.
- Clicking the floating control delegates to ChatGPT's own native Copy button when available, preserving ChatGPT's copy semantics.
- If ChatGPT hides or removes the native control, rich blocks can fall back to copying their rendered/editable text through Tampermonkey.
- Ordinary `Copy response` / `Copy message` actions at the bottom of assistant turns are ignored.
- ChatGPT's dynamic DOM and hover-created controls are rescanned without requiring a page reload.

## Install

Install the userscript directly in Tampermonkey from the `chatgpt-sticky-copy.user.js` file in this directory.

## Expected interaction

1. Open a ChatGPT conversation containing a long gray code block or a long writing block.
2. For an old gray block, the script stays out of the way while ChatGPT's own Copy control is visible, then exposes the lower-right proxy after the native control scrolls away.
3. For a writing block, the script stays out of the way while the original top of the block is still onscreen. After that top edge scrolls above the viewport, the lower-right proxy can appear even though ChatGPT's sticky header remains visible at the top.
4. As either block approaches the message composer, the floating button stays above the composer. If there is no safe room left, it disappears.
5. Press the proxy. It should perform the same copy action as ChatGPT's native control when possible and briefly read `Copied`.

## Scope

Matches only `chatgpt.com` / `www.chatgpt.com`.

Version: `0.3.1`
