# Firefox userscript safety gates

Three separate requirements apply to every rebuilt userscript.

## Correctness

A script must perform only the selected feature, with a clear activation condition and a tested cancel/failure path. User-visible state must follow confirmed evidence, not a guessed network outcome. No hidden downloads, submissions, clicks or clipboard reads. No features or permissions may be silently inherited from the old implementation.

## Performance

Use narrowly scoped event listeners or user-initiated work, not idle periodic scans. No `setInterval`, remote `@require`, dynamic `eval`, or whole-document scraping in the default implementation. If DOM observation is essential, limit its subtree, filter relevant changes, budget processing and dispose the observer at the end of the operation. Each bulk operation needs a maximum count, rate limit, cancellation and timeout. Avoid expensive selectors and repeated allocations against long ChatGPT conversations.

## Explicit broad-permission exceptions: Page Snapshot ZIP and Source Analysis ZIP

The standalone `page-snapshot` and `source-analysis` userscripts use `@match http://*/*`, `@match https://*/*`, and `@connect *` so an operator can request assets from the current arbitrary page and cross-origin CDNs. Both are explicitly manual-only exceptions. These broad permissions are **not permitted for other scripts**. The tool must not make any network requests until a direct Tampermonkey menu action, must have visible cancellation and resource/size limits, and may download only to the user's local machine. Preserve the explicit permission notice in its README.

## HUD contrast

Any userscript with a floating button, notification, or progress panel must track the browser's `prefers-color-scheme` setting with an inverted high-contrast palette: dark controls in light mode and light controls in dark mode. This is visual behavior only; it must not introduce polling or whole-page style scans. Controls must have a safe, predictable fallback placement if ChatGPT changes its DOM.

## Browser stability

No injection across tabs, extension management, browser-profile access, or process control. Minimize site matches and `@grant` permissions. Prefer direct Firefox-compatible browser APIs. Scripts must not run on unrelated hosts. No auto-installation or `@updateURL` / `@downloadURL` until that specific script is approved for release. A script failure must not block the site or leave endless timers.

## Acceptance and evidence

Each selected script requires source and permission review, a small README explaining its behavior, unit/invariant tests, and isolated Firefox QA using a disposable temporary profile with synthetic data. Check long pages, rapid navigation, cancellation and simultaneous normal browsing, as relevant. Never open or automate the user's actual Firefox profile.

CI now runs dependency-free static/unit checks and disposable Firefox browser tests with synthetic content, including a 3,500-turn/450-edit multi-script coexistence scenario. Passing these tests is positive evidence for Firefox browser mechanics, **not** verification of real ChatGPT/GitHub authenticated DOM behavior or a guarantee of the user's browser stability. Neither CI suite touches the user's actual Firefox profile.

No code, migration, Firefox settings, or installed userscript is changed merely because an item is in the catalog. Work directly on `main`; preserve the original source repository untouched.
