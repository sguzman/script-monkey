# Page Snapshot ZIP

**v1.0.1.** A self-contained Firefox/Tampermonkey userscript. Open any HTTP(S) page, then choose **Tampermonkey → Page Snapshot ZIP → Download current page snapshot (ZIP)**. It does absolutely nothing until you select this command.

The locally downloaded ZIP contains:

- `index.html` — best-effort **non-executable** offline rendering. Scripts are removed and a restrictive CSP is inserted.
- `source-dom.html` — original currently rendered page DOM, including inline JavaScript, styles and resource URLs. **Do not open it as an executable HTML document on an untrusted computer.**
- `assets/` — retrieved client-side JS, CSS, images, fonts, media, WASM, accessible maps and discovered dependencies, as available.
- `manifest.json` — original URL for every captured asset, bytes and MIME type, failures, and exactly which limits were reached.
- `README.txt` — archive guide.

The collector examines current DOM resource references, inline CSS, accessible stylesheets and the recent Performance Resource Timeline. It resolves CSS URLs/imports and static JS module/worker references up to a bounded depth. The ZIP uses the standard uncompressed **STORE** method; it is a real ZIP container, but assets are not additionally compressed.

## Permissions and privacy

This is **an explicitly reviewed exception** to the normal narrow-host rule. `@match http://*/*` and `@match https://*/*` make the command available on arbitrary websites. `@connect *` permits requesting resources from cross-origin CDNs, including redirected hosts; Tampermonkey can ask you to approve additional hosts. There are **no background requests, no automatic uploads, no remote code libraries, no cookie/storage export**, and no automatic version updates. All fetching starts only after a direct menu click; downloads go to your own computer.

The resulting archive can contain private text, authenticated assets and token-bearing URLs. **Do not publish it without examining its contents first.**

## Safety budgets

Maximum **600 assets**, **24 MiB per resource**, **192 MiB total assets**, **16 seconds per request**, **two simultaneous asset requests**, and **three levels of discovered dependencies**. The DOM source has a 12-million-character cap. A visible progress panel provides **Cancel**, which aborts active requests and prevents saving the archive. Resources that cannot be fetched or exceed limits appear in `manifest.json`.

No automatic browser tab traversal or extension injection is performed. No whole-browser cache or network interception is used. Snapshots may be incomplete and the script reports what it missed.

## What cannot be recovered

A userscript does not have access to server-side application source code, protected internal browser caches, the full network history and POST response bodies, every cross-origin iframe, closed shadow roots, canvas/WebGL buffers, decrypted DRM media, or assets blocked by permissions/CSP. Dynamic SPAs frequently depend on backend APIs and will not become a fully functional offline copy. `index.html` intentionally disables scripts to prevent replaying live actions.

The real Firefox profile is not touched by repository QA. Release suitability depends on isolated browser testing and your own specific page.

Visual controls use the inverse system theme: **dark in light mode, light in dark mode**. Theme changes apply automatically without a refresh.
