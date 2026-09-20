# ChatGPT Copy Entire Chat

Tampermonkey userscript for copying the entire current ChatGPT conversation into one ordered plain-text transcript.

The project is designed around ChatGPT's long-conversation virtualization: older turns may not exist in the live DOM at all until history is fetched again. A one-shot DOM scrape is therefore not considered correct behavior.

## Architecture

The exporter is now deliberately **API-first, DOM-enriched, scroll-fallback**.

1. Read the current authenticated ChatGPT session from `/api/auth/session`.
2. Fetch the current conversation from ChatGPT's own private web backend.
3. Prefer `/backend-api/conversations/{id}?num_turns=100` and follow `page_info.start_cursor` with `before=...` until `has_previous_page` is explicitly `false`.
4. If the current plural endpoint returns 404, try the legacy `/backend-api/conversation/{id}` mapping-tree route and linearize the active branch from `current_node` back to the root.
5. Treat the API result as the canonical history source. Currently mounted DOM messages may replace matching API text so the transcript can retain rendered/UI presentation where useful.
6. Only if the server-history path fails after retries does the script use the rendered-history scrolling implementation.
7. The scrolling fallback still refuses partial success: it must prove that the beginning of the rendered turn-number sequence was reached before copying anything.

This means normal successful runs should not scroll the page at all.

## Completeness contract

For the current paginated API shape, reaching the top is not inferred from timing. Successful completion requires the server pagination state itself to reach:

`page_info.has_previous_page === false`

If a response claims that older history exists but omits a cursor, pagination stops making progress, pagination metadata changes shape, or a page repeatedly fails, the API path is rejected rather than silently copied as complete.

The legacy mapping endpoint is accepted only if following `current_node -> parent` reaches a real root node without a missing parent/cycle.

## Slow / unstable connections

The API path retries transient network failures and HTTP 408/425/429/5xx responses with backoff. It also respects `Retry-After` when ChatGPT returns one. Conversation pages are requested sequentially rather than fanned out.

If the API path eventually fails, the script visibly announces that it is switching to **scroll fallback**. The old slow-network safeguards remain there: older rendered chunks are accumulated in memory, the wait resets whenever older turns appear, and the script fails instead of copying if it cannot prove the beginning was reached.

## Authentication / privacy

The userscript runs on `chatgpt.com` and uses the same authenticated session as the page.

- The access token obtained from `/api/auth/session` is held only in memory for the current export.
- It is not persisted by this script.
- It is not written into the transcript.
- It is not logged, including when debug logging is enabled.
- No external service receives conversation data.

The ChatGPT backend endpoints used here are private implementation details, not a supported public OpenAI API. They can change without notice. That is why the project keeps both the legacy endpoint adapter and the independent scrolling fallback.

## Output filtering

The API parser keeps visible user and assistant conversation content and excludes obvious internal/non-conversation payloads such as hidden messages, tool-directed assistant messages, `thoughts`, reasoning payloads, model/user editable context, and browsing-display chrome.

Prompt attachment names are preserved when exposed in message metadata. Matching currently rendered messages can enrich the API-derived transcript.

## Install

Install `chatgpt-copy-entire-chat.user.js` with Tampermonkey (or another compatible userscript manager), then reload `chatgpt.com`.

Run **Copy entire current ChatGPT chat** from the Tampermonkey menu while a conversation is open.

## Test

### API-first happy path

1. Open a very long ChatGPT conversation near the bottom.
2. Run the command.
3. Confirm the page does **not** automatically scroll.
4. The status should report server-history loading and may show multiple pages/messages.
5. On completion, confirm the final status says `Source: server API (...)` rather than `scroll fallback`.
6. Paste the transcript and verify the true first message, true last message, and several known messages from the middle.

### Pagination / slow-network test

Use a conversation longer than 100 backend messages. Confirm the status advances through more than one API page and still reaches the actual first message. On a slow connection, transient failures should trigger retries rather than immediate scroll fallback.

### Fallback test

If the private API changes or is unavailable, confirm the status explicitly switches to scrolling fallback. The page may then move while the script forces older history to register. The fallback must either prove the beginning and copy a complete transcript or fail visibly with nothing copied.

### Content test

Repeat on a conversation containing long messages, code blocks, attachments/filenames, citations, and unusual renderer content. Report any missing/duplicated content as a regression in this project rather than patching around it manually.

## Correctness invariants

- **API-first:** normal success reads history directly from ChatGPT's server-side conversation representation rather than driving the scrollbar.
- **Server-proven oldest page:** paginated success requires `has_previous_page: false`.
- **No partial API success:** malformed/incomplete pagination is rejected.
- **DOM enrichment, not DOM authority:** mounted UI content may enrich matching server messages but does not define history completeness.
- **Virtualization-safe fallback:** captured rendered turns survive subsequent DOM unmounting.
- **No deceptive scroll success:** fallback must prove the oldest rendered boundary before copying.
- **Conservative retries:** transient failures and rate limits back off before fallback.
- **Token hygiene:** authentication material is neither persisted nor exported.
- **No external data sink:** requests stay on ChatGPT's own origin.

## Known limitations / iteration targets

The API route and response schema are undocumented private ChatGPT implementation details. OpenAI can rename endpoints, change authentication, or reshape pagination. Such changes should produce a visible API-path failure and activate the independent scrolling fallback rather than silently truncate history.

The API representation and the rendered UI are not perfectly identical. Some UI-only artifacts, rich citation presentation, generated media, or unusual tool/artifact renderers may require additional DOM-enrichment logic. The server-side conversation remains authoritative for ordering/completeness; DOM enrichment is for presentation fidelity.

The exporter targets the active conversation branch. Deleted content, abandoned edit branches, hidden system/model context, and internal reasoning are intentionally not copied as ordinary conversation turns.

Set `CONFIG.debug` to `true` for diagnostics while investigating a regression; authentication tokens are never included in debug output.
