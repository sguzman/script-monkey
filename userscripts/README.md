# Userscripts

Tampermonkey / Greasemonkey-style browser scripts live here.

## Folder scheme

Userscripts are grouped by their target site:

```text
userscripts/
├── chatgpt.com/
│   ├── chatgpt-copy-entire-chat/
│   ├── chatgpt-current-message-jump/
│   ├── chatgpt-force-text-attachment/
│   └── chatgpt-sticky-copy/
├── github.com/
│   └── github-file-copy/
├── youtube.com/
│   └── youtube-play-all/
├── duolingo.com/
│   └── duolingo-qol/
├── backloggd.com/
│   └── backloggd-export/
├── scribd.com/
│   └── scribd-downloader/
└── libgen/
    └── libgen-filter/
```

The site folder should normally be the canonical domain matched by the script. When a project intentionally spans several interchangeable domains or mirrors, use a stable site-family folder instead of pretending one hostname is canonical. `libgen/` follows that rule.

Inside each site folder, every script remains its own project directory and should use a `.user.js` entrypoint so it can be installed directly by a userscript manager.
