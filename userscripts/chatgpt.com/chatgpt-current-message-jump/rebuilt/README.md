# ChatGPT Current Message Jump

Firefox userscript, **v1.0.1**. Shows inverse-theme up/down controls near the viewport edge whenever there is a navigable visible conversation turn.

- Up jumps to the preceding mounted turn, or the current assistant turn when older history is virtualized away.
- Down jumps to the next mounted turn, or the end of the current response.
- Uses a viewport-edge placement with fallback gutters, avoiding interactive controls. Hides only when there is no safe placement or no navigation available.
- Caches up to 240 turns from a reverse walk of at most 1,800 DOM elements. Scrolls are handled with one animation frame rather than repeated transcript queries.
- A bounded structural observer allows controls to appear after ChatGPT mounts a conversation or navigates from its home page, without polling. Navigation and pagehide clean up state.

**Intentional limitation:** unlike the original, it does not drive virtualized history to hydrate missing earlier turns. Its conservative fallback is safe but may not reach an offscreen unmounted user prompt. No high-frequency polling.

Visual controls use the inverse system theme: **dark in light mode, light in dark mode**. Theme changes apply automatically without a refresh.
