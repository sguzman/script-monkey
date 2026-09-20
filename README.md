# script-monkey

A home for small browser modifications that do not need a repository of their own.

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
```

Userscripts are grouped first by the site they target, then by individual script project. Stable canonical domains are used as the site folder when possible. A site-family name is allowed when one script intentionally targets several interchangeable domains; `libgen/` is the current example.

Each individual project still gets its own directory. Projects may have completely independent code and build systems; sharing this repository does not imply sharing a runtime or dependency graph.

## Current userscripts

### `chatgpt.com/`

- `chatgpt-copy-entire-chat` — copy a complete current ChatGPT conversation with an API-first, virtualization-safe fallback design
- `chatgpt-force-text-attachment` — force `Ctrl+Shift+V` clipboard text into a `.txt` attachment in ChatGPT
- `chatgpt-sticky-copy` — keep a Copy control available while long ChatGPT copyable blocks remain on screen
- `chatgpt-current-message-jump` — show a collision-aware gutter arrow for jumping to the top of the current long assistant exchange

### Other sites

- `github.com/github-file-copy` — add an inline copy control to GitHub file rows so raw file contents can be copied without opening the file
- `youtube.com/youtube-play-all` — canonical YouTube Play All userscript
- `duolingo.com/duolingo-qol` — Duolingo practice quality-of-life script
- `backloggd.com/backloggd-export` — export a Backloggd library to CSV from the logged-in browser session
- `scribd.com/scribd-downloader` — Scribd userscript
- `libgen/libgen-filter` — client-side filtering across the supported Libgen mirror family

## Consolidation policy

Tiny userscripts and small extensions belong here. Extensions with substantial architecture, their own protocol, release lifecycle, or significant supporting code should remain standalone repositories.

The older duplicate YouTube Play All implementations are not copied here; the version in this repository is canonical going forward.

Retired/private projects are intentionally not mirrored into this repository.
