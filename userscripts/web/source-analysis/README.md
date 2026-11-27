# Source Analysis ZIP

Version **v1.0.2** (initial v1.0.0; corrected inline dependency parsing in v1.0.1) — a separate, deliberately lightweight companion to [Page Snapshot ZIP](../page-snapshot/). **The original full snapshot is unchanged.**

To use: install the `.user.js` in Tampermonkey, open any HTTP(S) page, and choose **Tampermonkey → Source Analysis ZIP → Download source analysis ZIP**. No asset discovery or network request runs before that menu action. The result is a ZIP for your Viewsource research project.

## What it collects

- `rendered-dom.html.txt`: the full current serialized rendered DOM, including inline scripts and styles, saved as **text** to avoid accidentally executing it.
- `code/`: retrievable client-side stylesheets, script bundles/modules, source maps (when provided), and WASM resources.
- `manifest.json`: source URLs, file types, captured/missing results, accurate attempted/captured/failed byte counts, and image/font/media URL references **without** downloading those large binaries.
- `README.txt`: archive contents and provenance reminder.

Sources include existing script/link tags, code-type Performance Resource Timing entries, CSS imports and JS static/module/worker references. Discovery of code dependencies is capped at two levels.

**This does not attempt to reproduce an interactive offline webpage.** It is a research archive of client-side evidence. Images, videos, fonts, PDFs, unrelated API/XHR results and large arbitrary JSON responses are intentionally omitted.

## Bounded capture

- At most **120 code assets** and **48 MiB total**.
- At most **8 MiB per resource**, **9 seconds per request**, and **2 concurrent requests**.
- A maximum of **2 dependency levels** and **1,800 inspected DOM resource elements**.
- Displays **examined / total**, successful/failed counts and MiB; the Cancel control aborts pending work and prevents ZIP creation.
- Never scans or modifies other tabs, browser caches or Firefox settings. No background observer, interval or network interception.

Source maps may be omitted from public deployments or rejected by server/CDN permissions. The manifest explicitly records missing resources and references that were not downloaded.

## Permissions and privacy

Like Page Snapshot ZIP, this script uses `@match http://*/*`, `@match https://*/*`, and `@connect *`. Broad access is needed to make a **user-invoked** source snapshot of arbitrary websites and their CDN dependencies, including redirects. Tampermonkey may ask you to approve specific hosts.

The script downloads locally; it does not upload anything, use external executable dependencies, automatically update, or collect anything in the background. Captured HTML and resource URLs may contain private information or tokens. **Do not publish a ZIP without checking its contents.**

This captures the *current rendered DOM*, not the original HTML response, server-side code, private network traffic, closed shadow roots or complete browser cache. It cannot guarantee an exhaustive record of all source files.

## Testing

Source-level checks and a disposable Firefox integration test verify menu-only activation, focused code asset selection, a valid ZIP, progress and no image/font/media downloads. Real authenticated website behavior must still be validated separately; no code is injected into your personal Firefox profile by CI.

Visual controls use the inverse system theme: **dark in light mode, light in dark mode**. Theme changes apply automatically without a refresh.
