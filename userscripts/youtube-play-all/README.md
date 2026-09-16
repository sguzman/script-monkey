# YouTube Play All

Tampermonkey userscript for building a complete playback queue from a YouTube channel while retaining user control over which channel content classes are included.

## User-facing behavior

The control panel is shown only on recognized channel routes such as `@handle`, `channel/<id>`, `c/<name>`, or `user/<name>` and their normal channel tabs. It must not survive SPA navigation onto `/watch`, `/playlist`, or unrelated YouTube routes.

The panel provides:

- `Shorts` inclusion toggle (default Off)
- `Live` inclusion toggle (default Off)
- `Members` inclusion toggle (default Off)
- `Play All`
- drag-by-header repositioning
- minimize/expand control
- persisted position and minimized state

The panel is intentionally compact. Its position is clamped to the visible viewport so a saved position cannot strand the control off-screen after a resize or display change.

## Queue model

YouTube temporary `watch_videos` playlists are treated as 50-item batches. The script stores the full collected ID list in `sessionStorage`, opens the first batch, watches playback boundaries, and opens the next batch when the current one completes. The queue expires after 12 hours.

The collection order is:

1. regular Videos
2. Shorts, when enabled
3. Live/Streams, when enabled

IDs are deduplicated across tabs.

## YouTube integration strategy

YouTube's private web surfaces move frequently, so the script avoids depending on one renderer or one configuration key when possible.

### Initial channel data

The script fetches the normal channel tab HTML (`/videos`, `/shorts`, `/streams`) and extracts the page's `ytInitialData`. This avoids requiring a synthesized initial InnerTube browse request just to discover a channel tab endpoint.

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

### Continuations

Pagination still requires YouTube's private `/youtubei/v1/browse` continuation endpoint. The request scaffolding intentionally accepts both old and newer configuration names:

- `INNERTUBE_CONTEXT_CLIENT_NAME` or legacy `INNERTUBE_CLIENT_NAME`
- `INNERTUBE_CONTEXT_CLIENT_VERSION`, legacy `INNERTUBE_CLIENT_VERSION`, or the version in `INNERTUBE_CONTEXT.client`
- API key when available, but it is no longer treated as mandatory
- visitor/session/delegated-session headers when exposed by the page
- optional `SAPISIDHASH` authentication when an appropriate cookie remains readable

Error responses include YouTube's returned error message when available so future breakage is easier to diagnose.

## Known hostile / moving surfaces

This script depends on private YouTube implementation details rather than a stable public API. Expected break surfaces include:

- renaming/removal of `ytcfg` keys
- changes to InnerTube request authentication
- changes to channel-tab URL structure
- new renderer/view-model shapes
- continuation token shape changes
- removal or semantic changes to `watch_videos`
- SPA navigation leaving stale page data in globals

The route check deliberately trusts the current URL before stale `ytInitialData`; this is what prevents the panel from appearing on ordinary video-watch pages after navigation from a channel.

When YouTube breaks the script again, prefer adding another compatible input shape or transport fallback over replacing the entire implementation with one newly fragile path.
