# YouTube Play All

Tampermonkey userscript that turns a channel into one reusable, private, native YouTube playlist.

The script deliberately does **not** use YouTube's anonymous `watch_videos` / `TLGG...` temporary playlists anymore. Those are convenient but cap out at roughly 50 items. Instead, the script owns one private scratch playlist in the signed-in YouTube account and overwrites that same playlist whenever the user builds a new one.

## Managed playlist identity

The managed playlist is named:

`Script Monkey — Play All Scratch`

Lifecycle contract:

1. Look up the user's playlists.
2. If the locally remembered playlist ID still exists, reuse it.
3. Otherwise, look for an existing playlist with the managed title and adopt it.
4. Only if neither exists, create one private playlist.
5. Never intentionally create a fresh managed playlist for every build.
6. If the user deletes the managed playlist, the next build may create a replacement.

The playlist ID is persisted in local storage. The last successful build is also remembered so **Open Last Playlist** can reopen it without rebuilding.

If duplicate playlists with the managed title already exist, the script reuses the first one it finds and logs a warning instead of manufacturing yet another duplicate.

## User-facing controls

The channel control appears only on recognized channel routes such as `@handle`, `channel/<id>`, `c/<name>`, or `user/<name>` and their normal channel tabs. It must not remain visible on ordinary `/watch`, `/playlist`, or unrelated YouTube routes.

Controls:

- final playlist-size slider: `25 / 50 / 100 / 250 / 500 / 1000 / 2500 / 5000`
- `Shorts` inclusion toggle
- `Live` inclusion toggle
- `Members` inclusion toggle
- `Build Playlist`
- `Open Last Playlist`
- minimize/expand
- drag-by-header positioning

Position, minimized state, toggles, and selected count persist locally.

## Count semantics

The slider means **final playlist size**, not "N per feed."

Example:

- slider `100`
- Shorts Off
- Live Off

=> up to 100 newest eligible regular videos.

Example:

- slider `100`
- Shorts On
- Live On

=> up to **100 total items**, drawn from regular videos, Shorts, and streams together.

If fewer than the requested number of eligible items exist, the resulting playlist is simply smaller.

Members-only content is a filter, not a separate feed. When Members is Off, members-only renderers are excluded while channel pages are collected. When Members is On, accessible members-only entries may participate normally.

## Cross-feed ordering

When more than one content feed is enabled, the script does **not** concatenate feeds as:

`regular videos -> Shorts -> Live`

That ordering would be wrong.

Instead, each enabled feed contributes candidates, the managed playlist is sorted using YouTube's own native **Date published (newest)** playlist ordering, and only the newest requested N items are retained. The scratch playlist itself is used as the merge workspace, so the final native playlist is already in publish-date order.

This has two advantages:

- YouTube, not the userscript, is the authority for the video's actual publish date.
- Shorts and streams do not need fragile userscript-side timestamp parsing just to interleave them with regular videos.

### 5000-item caveat

A native saved playlist has a practical capacity around 5000 items. Exact cross-feed merging temporarily needs room for the current top-N set plus candidates from one additional feed.

Therefore:

- `5000` remains available for a single feed.
- when Shorts and/or Live are enabled, exact cross-feed merging is currently limited to `2500` final items so the merge never requires more than about 5000 temporary playlist entries.

The script fails explicitly rather than silently returning an incorrectly ordered 5000-item cross-feed result.

## Collection order vs final order

Channel tabs are collected independently:

- `/videos`
- `/shorts`, if enabled
- `/streams`, if enabled

Each source is paginated only until it has enough candidates to participate in the requested final result. IDs are deduplicated across feeds.

Collection order is an implementation detail. **Final playlist order is always Date published (newest).**

## Playlist rewrite process

For each build:

1. collect eligible candidate IDs from the selected channel feeds
2. locate or create the one managed scratch playlist
3. clear its previous contents
4. add one candidate feed
5. apply YouTube's native `Date published (newest)` playlist sort
6. trim back to the requested final size
7. merge the next enabled feed the same way
8. sort and trim once more
9. open the newest item in normal native playlist context

Adds and removals are dispatched in chunks to reduce the risk of rate limiting. HTTP 429 responses use bounded exponential retry.

## YouTube integration strategy

This script uses YouTube's private web/InnerTube surfaces because the goal is to operate inside the already signed-in youtube.com session without requiring a separate Google Cloud OAuth application.

### Initial channel data

The script fetches normal channel tab HTML and extracts `ytInitialData`, then follows InnerTube continuation tokens for pagination.

### Renderer compatibility

Video IDs are collected from both legacy renderers and newer view-model shapes, including:

- `videoRenderer`
- `gridVideoRenderer`
- `playlistVideoRenderer`
- `playlistPanelVideoRenderer`
- `compactVideoRenderer`
- `reelItemRenderer`
- `channelVideoPlayerRenderer`
- `shortsLockupViewModel`
- `lockupViewModel` with `LOCKUP_CONTENT_TYPE_VIDEO`

### Playlist management

The script uses authenticated YouTube web-session requests for:

- owned-playlist discovery
- playlist creation
- playlist browsing
- playlist additions/removals
- native playlist sorting

Playlist sorting deliberately does **not** require YouTube's sort menu to be present. Current YouTube web responses can omit the sort UI when **Date published (newest)** is already active. The script uses the discovered native sort action when YouTube exposes it, but falls back to the current native `ACTION_SET_PLAYLIST_VIDEO_ORDER` value `4` when the menu is absent. It then explicitly reapplies the order after additions and rereads the playlist.

Removal prefers playlist-specific `setVideoId` when YouTube exposes it.

### Authentication/config compatibility

The request scaffolding accepts both current and older page configuration shapes, including:

- `INNERTUBE_CONTEXT_CLIENT_NAME` or legacy `INNERTUBE_CLIENT_NAME`
- `INNERTUBE_CONTEXT_CLIENT_VERSION`, legacy `INNERTUBE_CLIENT_VERSION`, or the version in `INNERTUBE_CONTEXT.client`
- visitor/session/delegated-session headers when exposed
- `SAPISIDHASH` authentication when the relevant cookie is readable
- API key when available

## Known hostile / moving surfaces

This depends on private YouTube implementation details. Expected break surfaces include:

- renamed/removed `ytcfg` keys
- InnerTube authentication changes
- channel-tab URL changes
- renderer/view-model migrations
- continuation token shape changes
- playlist-create/edit endpoint changes
- playlist sort-menu/action changes
- `setVideoId` representation changes
- SPA navigation leaving stale page data in globals

When YouTube changes one of these surfaces, prefer accepting another compatible input shape or adding a narrow fallback rather than replacing the entire architecture with a newly fragile one.
