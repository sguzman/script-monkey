# YouTube Play All

Tampermonkey userscript for turning a channel's newest videos into one reusable, native YouTube playlist.

## Core model

The script owns one private saved playlist named:

`Script Monkey — Play All Scratch`

That playlist is a **scratch resource**, not a new playlist per run. A build does this:

1. collect the requested channel videos in newest-first order;
2. find the existing managed scratch playlist for the currently signed-in YouTube account;
3. create it only if no managed playlist exists;
4. remove the playlist's previous contents;
5. add the new videos in newest-first order;
6. open the first item as a normal YouTube playlist watch page.

This replaces the old anonymous `watch_videos` / `TLGG...` approach and therefore removes the old 50-item temporary-playlist batching behavior.

## Playlist identity and duplicate prevention

The playlist ID is persisted in `localStorage` after creation/adoption.

The stored ID is **not the only source of truth**. Before creating anything, the script queries the signed-in account's playlists and looks for the exact managed title. This matters when:

- browser storage was cleared;
- the userscript was reinstalled;
- the saved ID belongs to another signed-in YouTube account;
- the playlist ID was lost but the playlist itself still exists.

If the exact managed playlist already exists, the script adopts and reuses it rather than creating another one. If multiple playlists with the managed title somehow exist, it reuses the first match and logs a warning instead of creating an additional duplicate.

If the managed playlist was actually deleted, the next build is allowed to create a replacement.

## Last playlist access

The last successful build is stored locally with:

- managed playlist ID;
- item count;
- source channel route;
- build time;
- inclusion settings;
- requested per-feed count.

The channel widget exposes **Open Last Playlist**, which opens the saved scratch playlist without rebuilding or changing it. Because the same YouTube playlist is reused, its URL stays stable across builds.

## User-facing controls

The floating channel control panel appears only on recognized channel routes such as `@handle`, `channel/<id>`, `c/<name>`, or `user/<name>` and their normal channel tabs. It must not survive SPA navigation onto `/watch`, `/playlist`, or unrelated YouTube routes.

The panel provides:

- newest-video count slider: `25`, `50`, `100`, `250`, `500`, `1000`, `2500`, `5000`;
- `Shorts` inclusion toggle (default Off);
- `Live` inclusion toggle (default Off);
- `Members` inclusion toggle (default Off);
- `Build Playlist`;
- `Open Last Playlist`;
- drag-by-header repositioning;
- minimize/expand control;
- persisted position and minimized state.

Default count is `250`.

With only regular Videos enabled, the count means the newest N channel videos. YouTube exposes Videos, Shorts, and Streams as separate feeds rather than one reliably timestamp-sortable feed, so when Shorts or Live are enabled the control explicitly says **Newest / type** and applies the selected limit to each enabled feed independently. IDs are still deduplicated.

## Playlist overwrite behavior

Existing playlist contents are read through YouTube's playlist browse surface so playlist-specific `setVideoId` values can be recovered. Existing items are then removed and replacement items are added through `browse/edit_playlist` actions.

Mutations are chunked and lightly delayed to reduce rate-limit pressure. HTTP 429 responses are retried with exponential backoff.

The managed playlist is private when first created. The script does not create a new playlist merely because a new channel or count is selected; those operations overwrite the existing managed scratch playlist.

## YouTube integration strategy

This project intentionally uses the already authenticated YouTube web session rather than requiring a separate Google Cloud project, OAuth application, or YouTube Data API key/quota.

### Initial channel data

The script fetches normal channel tab HTML (`/videos`, `/shorts`, `/streams`) and extracts the page's `ytInitialData`. Pagination uses YouTube's private `/youtubei/v1/browse` continuation endpoint.

### Playlist ownership/discovery

The signed-in account's playlists are discovered through the playlist aggregation browse surface (`FEplaylist_aggregation`). The script understands both older playlist renderers and newer `lockupViewModel` playlist representations.

### Playlist creation/editing

The managed playlist is created through the private `playlist/create` InnerTube endpoint and mutated through `browse/edit_playlist` actions.

The request scaffolding accepts both old and newer YouTube configuration names:

- `INNERTUBE_CONTEXT_CLIENT_NAME` or legacy `INNERTUBE_CLIENT_NAME`;
- `INNERTUBE_CONTEXT_CLIENT_VERSION`, legacy `INNERTUBE_CLIENT_VERSION`, or the version in `INNERTUBE_CONTEXT.client`;
- API key when available, without treating it as the only authentication mechanism;
- visitor/session/delegated-session headers when exposed by the page;
- `SAPISIDHASH` authentication when an appropriate YouTube auth cookie is readable.

## Renderer compatibility

Channel video IDs are collected from both older renderer forms and newer view-model forms, including:

- `videoRenderer`;
- `gridVideoRenderer`;
- `playlistVideoRenderer`;
- `playlistPanelVideoRenderer`;
- `compactVideoRenderer`;
- `reelItemRenderer`;
- `channelVideoPlayerRenderer`;
- `shortsLockupViewModel`;
- `lockupViewModel` with `LOCKUP_CONTENT_TYPE_VIDEO`.

Playlist clearing also understands playlist video renderers plus lockup entries that expose a playlist item identifier.

## Known hostile / moving surfaces

This script depends on private YouTube implementation details rather than a stable public API. Expected break surfaces include:

- renaming/removal of `ytcfg` keys;
- changes to `SAPISIDHASH` or other web-session authentication;
- changes to InnerTube playlist creation/edit contracts;
- changes to playlist aggregation renderer shapes;
- changes to channel-tab URL structure;
- new renderer/view-model shapes;
- continuation token shape changes;
- rate-limit behavior;
- account-switching behavior;
- SPA navigation leaving stale page data in globals.

The route check deliberately trusts the current URL before stale `ytInitialData`; this prevents the channel control from appearing on ordinary video-watch pages after SPA navigation.

When YouTube breaks the script again, prefer adding another compatible input shape or transport fallback over replacing the implementation with one newly fragile path.
