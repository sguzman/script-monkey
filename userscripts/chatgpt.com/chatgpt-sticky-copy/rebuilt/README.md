# ChatGPT Sticky Copy

Firefox userscript, **v1.0.1**. Shows at most one floating **Copy** proxy for a long visible code or writing block.

- Reuses the native Copy action when available. If unavailable, copies a bounded text fallback (2 MiB maximum) with `GM_setClipboard`.
- Hides while the native code Copy is visible. For writing blocks, the overlay can appear after the block top scrolls out of view.
- Excludes the active composer and hides rather than covering other UI.
- Tracks at most 300 candidate blocks and reacts to structural block changes, not every streaming text mutation.
- Single animation-frame layout updates on scroll/resize; cleaned up on pagehide.

The legacy shadow-root deep scanner is deliberately not copied. Unsupported block types are left untouched. Live Firefox/ChatGPT compatibility requires isolated QA.

Visual controls use the inverse system theme: **dark in light mode, light in dark mode**. Theme changes apply automatically without a refresh.
