# script-monkey

A home for small browser modifications that do not need a repository of their own.

The repository deliberately separates userscripts from browser extensions even when both are tiny enough to live in the same monorepo.

## Layout

```text
script-monkey/
├── userscripts/   # Tampermonkey / Greasemonkey-style scripts
└── extensions/    # Small browser extensions, kept as isolated subprojects
```

Each project gets its own directory. Projects may have completely independent code and build systems; sharing this repository does not imply sharing a runtime or dependency graph.

## Current userscripts

- `youtube-play-all` — canonical YouTube Play All userscript (v1.7)
- `duolingo-qol` — Duolingo practice quality-of-life script
- `scribd-downloader` — Scribd userscript
- `libgen-filter` — client-side filtering for Libgen results

## Consolidation policy

Tiny userscripts and small extensions belong here. Extensions with substantial architecture, their own protocol, release lifecycle, or significant supporting code should remain standalone repositories.

The older duplicate YouTube Play All implementations are not copied here; v1.7 from `sguzman/playall.js` is the canonical version going forward.

Retired/private projects are intentionally not mirrored into this repository.
