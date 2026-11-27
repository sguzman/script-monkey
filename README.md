# script-monkey

Canonical collection of browser userscripts for all browsers, independent of browser vendor. Small extensions may also live here.

The repository deliberately separates userscripts from browser extensions even when both are tiny enough to live in the same monorepo.

## Layout

```text
script-monkey/
├── userscripts/
│   ├── chatgpt.com/
│   ├── github.com/
│   ├── youtube.com/
│   ├── duolingo.com/
│   ├── backloggd.com/
│   ├── scribd.com/
│   └── libgen/
└── extensions/
    └── chatgpt-tab-signal/
```

Userscripts are grouped first by the site they target, then by individual script project. Stable canonical domains are used as the site folder when possible. A site-family name is allowed when one script intentionally targets several interchangeable domains; `libgen/` is the current example.

Each individual project still gets its own directory. Projects may have completely independent code and build systems; sharing this repository does not imply sharing a runtime or dependency graph.

## Current userscripts

See the [compatibility catalog](catalog.json) and [variant policy](userscripts/README.md).

### `chatgpt.com/`

- `chatgpt-auto-continue` — experimental opt-in, bounded project continuation using Chat Signals and explicit project status markers
- `chatgpt-copy-entire-chat` — copy a complete current ChatGPT conversation with an API-first, virtualization-safe fallback design
- `chatgpt-force-text-attachment` — add a **Clipboard** button beside ChatGPT's composer `+` to attach plain-text clipboard content as a `.txt` file
- `chatgpt-sticky-copy` — keep a Copy control available while long ChatGPT copyable blocks remain on screen
- `chatgpt-current-message-jump` — show a collision-aware gutter arrow for jumping to the top of the current long assistant exchange

### Gemini

- [Gemini Force Text Attachment](userscripts/gemini.google.com/gemini-force-text-attachment/) — Ctrl+Shift+V to attach clipboard text as a .txt file (experimental; live QA pending).

### Other sites

- `web/page-snapshot` — manual full page ZIP archive
- `web/source-analysis` — manual source-only ZIP archive
- `github.com/github-file-copy` — add an inline copy control to GitHub file rows so raw file contents can be copied without opening the file
- `youtube.com/youtube-play-all` — canonical YouTube Play All userscript
- `duolingo.com/duolingo-qol` — Duolingo practice quality-of-life script
- `backloggd.com/backloggd-export` — export a Backloggd library to CSV from the logged-in browser session
- `scribd.com/scribd-downloader` — Scribd userscript
- `libgen/libgen-filter` — client-side filtering across the supported Libgen mirror family

## Current extensions

- `extensions/chatgpt-tab-signal` — ChatGPT tab activity/unread markers, completion sound, and desktop notifications (AGPL-3.0-derived; see its own LICENSE and README).
- `extensions/jobflick-bridge` — Chromium Native Messaging extension for validated Execarium jobs, one-click Jobflick submission, per-tab tracking, and returning reports to originating ChatGPT conversations.

## Consolidation policy

Tiny userscripts and small extensions belong here. Extensions with substantial architecture, their own protocol, release lifecycle, or significant supporting code should remain standalone repositories.

The older duplicate YouTube Play All implementations are not copied here; the version in this repository is canonical going forward.

Retired/private projects are intentionally not mirrored into this repository.

## Consolidation

The seven userscripts formerly maintained in [firefox-scripts](https://github.com/sguzman/firefox-scripts) are now here. Existing legacy install URLs remain unchanged; five rewritten variants reside in their project's `rebuilt/` directory. Install only one variant per project. Historical Firefox synthetic QA applies to the imported implementations, not live sites or other browsers. The old Firefox harness is retained as migration reference and must be adapted before reuse; per-project tests accompany each import. Standalone WebExtensions remain independent.
