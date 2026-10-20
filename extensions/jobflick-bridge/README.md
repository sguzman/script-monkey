# Jobflick Bridge

Native Chromium/Edge extension connecting ChatGPT conversations to local Jobflick. It detects Execarium YAML, checks it against the real Jobflick consumer validator, adds **Run Jobflick** only for valid jobs, queues only after the button is clicked, and returns results to the originating conversation.

Jobflick owns the queue, generated job colors, execution and reports. Execarium schema 4 owns the YAML name. The extension creates and persists the optional origin_tab_id outside the YAML; ChatGPT is not asked to construct, track or return tab IDs.

## Setup

1. Install current Jobflick (and let existing work finish before upgrading/restarting its enabled user service). The native host executable is the same jobflick binary with the native-host argument.
2. Load this directory as an unpacked extension in an **isolated Edge QA profile**, not your primary Edge with valuable existing tabs. The included qa-isolated-edge.fish opens a separate persistent profile with only this unpacked extension.
3. In that QA profile open edge://extensions, enable developer mode, and copy Jobflick Bridge's 32-character extension ID.
4. From the script-monkey repo root run: fish extensions/jobflick-bridge/install-native-host.fish EXTENSION_ID. This registers the existing Jobflick executable with Edge/Chromium's Native Messaging system. Chromium cannot supply command-line arguments in a host manifest, so the installer creates a tiny launcher at `$XDG_DATA_HOME/jobflick-bridge/native-host` (default `~/.local/share/jobflick-bridge/native-host`). The launcher executes `jobflick native-host`. This is not a new daemon, service, or HTTP server; Jobflick's existing daemon still owns the queue.
5. In a disposable conversation, request a harmless named schema-4 job (for example an echo). Hover over the code block (or select the extension toolbar button) to validate it; **Run Jobflick** appears if local validation succeeds. Click once, and check queue/status in Jobflick. Once complete, the extension attempts to insert the report into that exact conversation and submit it.

The toolbar extension icon scans **visible** existing code blocks on demand. Code blocks are detected only when the pointer or keyboard focus enters a code block, or when the extension toolbar is clicked to scan currently visible blocks. **No DOM observers**, idle polling, clipboard access, page-wide repeated scanning, or auto-execution. If the DOM churn exceeds the observer budget it disconnects rather than consume unbounded resources.

## Operational behavior

- Native host actions: validate_spec, submit_spec, inspect, show and cancel. Native Messaging frames are bounded. This extension only issues the first four.
- Job tracking is stored in chrome.storage.local; origin tokens are generated using crypto.randomUUID() and held in chrome.storage.session.
- A periodic browser alarm checks pending job IDs while work exists. It does not keep a polling timer inside a content script or touch other browser tabs.
- The extension verifies the live tab URL matches the original URL before delivery. A different chat, closed tab, nonempty composer, or incompatible DOM prevents injection. Jobs and results remain available from Jobflick even if automated delivery fails.
- Once inserted, a result is never inserted twice. If the ChatGPT Send button is missing, the message remains in the composer for manual submission.
- If native submission times out/disconnects, it **never retries** automatically: the job may have been accepted. Inspect Jobflick before starting another.
- Execution authorization is the explicit Run click. YAML syntax validation cannot prove the Fish commands are safe; inspect the YAML carefully.

## Tests

Run npm --prefix extensions/jobflick-bridge test (Node 22+). The automated checks cover syntax, manifest scope, observer and submission safety properties. They do not establish live ChatGPT DOM or Hyprland/Edge compatibility. Keep this extension out of the primary browser profile until isolated QA is successful.
