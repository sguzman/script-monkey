# ChatGPT Copy Entire Chat

Firefox userscript, **v1.0.0 rebuild**. Launch the **Copy entire current ChatGPT chat** userscript-manager command on an open conversation.

- The authenticated ChatGPT history API is the source of truth. It loads older pages sequentially until `has_previous_page === false`, or walks the legacy mapping tree all the way to a root.
- Only visible user/assistant messages are exported; tool/reasoning payloads are excluded.
- Network work is bounded to 200 pages, 20,000 messages, and a 12-million-character clipboard result. Each request has a 16-second timeout and at most two retries.
- The access token remains in memory only; it is never logged or stored. No external service receives the transcript.
- On API incompatibility, **nothing is copied**. The original scrolling fallback has deliberately not been ported because it can disturb long conversations and cannot always prove completeness.

Requires userscript-manager `GM_setClipboard` and `GM_registerMenuCommand`. No background work, DOM observer, or tab reload. ChatGPT private APIs may change. Firefox live compatibility is not yet established.
