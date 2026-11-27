# Userscripts

All browser userscripts belong here, grouped by target website and project, not browser. See [catalog.json](../catalog.json) for the full inventory and compatibility evidence.

- Each project has its own directory and installable `.user.js` file.
- Prefer one browser-neutral implementation. Keep separate variants only when implementations materially differ or when preserving an existing update URL. The five migrated `rebuilt/` variants retain their original metadata and legacy entry points; install only one variant per project.
- Compatibility is evidence-based: distinguish historical isolated synthetic Firefox tests, live-site QA, and unverified Chrome/Edge support. Firefox-tested does not mean Firefox-only.
- Existing installed URLs are preserved. No new auto-update endpoints without explicit release approval.
- Keep permissions narrow and tests isolated; never change the user's browser profile automatically.
- Substantial standalone extensions remain separate projects; private sources are not imported into a public repository.
