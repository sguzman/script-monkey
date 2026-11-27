# GitHub File Row Copy

Firefox userscript, **v1.0.4** (original rebuild started at v1.0.0). Adds an inline **Copy** button before the filename in GitHub repository directory rows, not directories or issue/PR views.

A click converts a same-origin `/blob/` URL into GitHub's `/raw/` route. GitHub redirects that route to `raw.githubusercontent.com`. Both `github.com` and `raw.githubusercontent.com` are explicitly whitelisted with `@connect`, without a wildcard. The request uses `GM_xmlhttpRequest` with a 12-second timeout and copies only successful text with `GM_setClipboard`.

Idle rows show an inline copy icon; while downloading they show **Copying…**, followed briefly by **Copied** or **Error**, and then return to the icon. No remote icon library is loaded.

Bounded resources: 400 directory entries processed per animation-frame slice (continuing until all visible file rows are covered), 2 MiB maximum file text, eight recently fetched files cached per page. Navigation clears the cache; in-flight requests are aborted on pagehide. GitHub file links are recognized across legacy listings, newer row layouts, and rowless hydrated file containers without depending on GitHub's React CSS classes. GitHub also places hidden and visible filename links in the same logical file row; each visible link must receive its own button, rather than deduplicating by row and accidentally decorating only the hidden link. The script watches React row replacement, root replacement, navigation and relevant attribute changes; it restores controls after hydration without timer polling.

The button is restored on nested repository directories as well as the repository root. Folder rows, README file links, issue lists and pull requests do not gain buttons. A row whose link changes uses the new file URL instead of copying the former file.

Granted hosts are restricted to `github.com` and `raw.githubusercontent.com`. No GitHub token or external endpoints; a failed download cannot overwrite the clipboard. Firefox userscript-manager support for both GM APIs is required.

### Updating in Tampermonkey

The installed script does not automatically track new GitHub commits (no `@updateURL` or `@downloadURL`, by design). Replace its contents with [the current `.user.js`](github-file-copy.user.js) in Tampermonkey, then save. Confirm the metadata shows **v1.0.4** and grants the new `raw.githubusercontent.com` permission. If Tampermonkey previously blocked the redirected domain even after updating the metadata, check this script's **Settings → XHR Security** blacklist and remove an existing entry for that host; do not disable XHR security globally.

Visual controls use the inverse system theme: **dark in light mode, light in dark mode**. Theme changes apply automatically without a refresh.

### Regression coverage

Static checks cover the restricted grants, version and DOM recovery guards. The isolated-Firefox suite tests a GitHub row with both hidden and visible copies of a file link, plus replacement of the initial listing with a hydrated rowless file layout, all file controls returning, hidden file rows, over-400-file directories, skipped folders and README links, updated file URLs, clipboard requests, and navigation between repository sections. This is not a claim that GitHub's live authenticated DOM has been verified.
