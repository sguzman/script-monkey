# YouTube Play All

Tampermonkey userscript for building a local, user-controlled playback queue from a YouTube channel.

The script deliberately does **not** create or mutate a persistent playlist in the user's YouTube account. The authoritative queue lives locally in `sessionStorage` and the script drives ordinary `/watch?v=...` pages through that queue.

## User-facing behavior

The channel control panel is shown only on recognized channel routes such as `@handle`, `channel/<id>`, `c/<name>`, or `user/<name>` and their normal channel tabs. It must not survive SPA navigation onto ordinary `/watch`, `/playlist`, or unrelated YouTube routes.

The channel panel provides:

- newest-video slider: `25`, `50`, `100`, `250`, `500`, `1000`, `All`
- `Shorts` inclusion toggle (default Off)
- `Live` inclusion toggle (default Off)
- `Members` inclusion toggle (default Off)
- `Start Queue`
- drag-by-header repositioning
- minimize/expand control
- persisted position, minimized state, and slider choice

The normal Videos feed is already newest-first, so the local queue preserves that reverse-chronological order. Pagination stops as soon as the selected limit has been collected, avoiding needless continuation requests. `All` intentionally walks the whole feed.

YouTube splits Videos, Shorts, and Live/Streams into separate feeds. When Shorts or Live are enabled, the slider is displayed as `Newest / type`: the selected limit is collected independently from each enabled feed, each in that feed's newest-first order, then appended in Videos → Shorts → Live order. This avoids pretending that separate feeds expose a reliable global timestamp ordering when they do not.

## Virtual queue model

Version 2 removes the old 50-video `watch_videos` batching architecture entirely.

A built queue contains the complete selected video-ID sequence plus the current index. Playback opens an ordinary YouTube watch URL for one item at a time. When that video naturally ends, the script suppresses YouTube's normal recommendation/autoplay handoff and opens the next ID from the local queue.

There is therefore no special behavior at item 50, 100, 150, etc. A 250-item queue is one logical 250-item queue from the script's point of view.

While a virtual queue is active, watch pages show a small movable/minimizable controller containing:

- current position, e.g. `37 / 250`
- `Prev`
- `Next`
- `Stop Queue`

The queue expires after 12 hours. `Stop Queue` immediately removes the local queue and strips the script's queue marker from the current watch URL.

Direct queue navigation uses a small `ytpa=1` URL marker so stale queue state cannot hijack unrelated YouTube videos. If the user leaves the marked queue flow for an unrelated video, the script leaves that video alone.

## YouTube integration strategy

YouTube's private web surfaces move frequently, so the script avoids depending on one renderer or one configuration key when possible.

### Initial channel data

The script fetches normal channel tab HTML (`/videos`, `/shorts`, `/streams`) and extracts the page's `ytInitialData`. This avoids requiring a synthesized initial InnerTube browse request just to discover a channel tab endpoint.

### Renderer compatibility

Video IDs are collected from both older renderer forms and newer view-model forms, including:

- `videoRenderer`
- `gridVideoRenderer`
- `playlistVideoRenderer`
- `playlistPanelVideoRenderer`
- `compactVideoRenderer`
- `reelItemRenderer`
- `channelVideoPlayerRenderer`
- `shortsLockupViewModel`
- `lockupViewModel` with `LOCKUP_CONTENT_TYPE_VIDEO`

IDs are deduplicated across feeds.

### Continuations

Pagination uses YouTube's private `/youtubei/v1/browse` continuation endpoint. The request scaffolding intentionally accepts both old and newer configuration names:

- `INNERTUBE_CONTEXT_CLIENT_NAME` or legacy `INNERTUBE_CLIENT_NAME`
- `INNERTUBE_CONTEXT_CLIENT_VERSION`, legacy `INNERTUBE_CLIENT_VERSION`, or the version in `INNERTUBE_CONTEXT.client`
- API key when available, but it is not treated as mandatory
- visitor/session/delegated-session headers when exposed by the page
- optional `SAPISIDHASH` authentication when an appropriate cookie remains readable

Error responses include YouTube's returned error message when available so future breakage is easier to diagnose.

## Known hostile / moving surfaces

This script depends on private YouTube implementation details rather than a stable public API. Expected break surfaces include:

- renaming/removal of `ytcfg` keys
- changes to InnerTube request authentication
- changes to channel-tab URL structure
- new renderer/view-model shapes
- continuation-token shape changes
- changes to YouTube's player/autoplay end-of-video handling
- SPA navigation leaving stale page data in globals

The route check deliberately trusts the current URL before stale `ytInitialData`; this prevents the channel-building panel from appearing on ordinary video-watch pages after navigation from a channel.

When YouTube breaks the script again, prefer adding another compatible input shape or transport fallback over replacing the entire implementation with one newly fragile path.
