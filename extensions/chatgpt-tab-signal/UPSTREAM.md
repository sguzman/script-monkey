# Upstream provenance / adaptations

- Source: https://github.com/ramhaidar/ChatGPT-Response-Complete-Notifier
- Source version inspected: manifest v1.1.2 (2026-10-19)
- Original author/repository: ramhaidar
- License: GNU Affero General Public License version 3 (AGPL-3.0).
- Copied/derived: `service-worker.js`, `content-script.js`,
  `offscreen.html`, `offscreen.js`, `popup.html`, `popup.js`, and the
  PNG notification icon encoded inline in `service-worker.js`.
- New adaptation: `ChatGPT Tab Signal` name, icon/title unread state machine,
  generation-start indicator, abort clearing, popup marker preview, integration
  documentation and QA matrix.

This is a derived extension, not a new unrelated implementation. The original
license is preserved in `LICENSE` and applies to this extension. All
modifications are available in this repository. Attribution and compatibility
information should be kept current when updating the upstream implementation.
