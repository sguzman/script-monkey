# Jobflick Bridge

Native Chromium/Edge extension connecting ChatGPT conversations to local Jobflick. It detects Execarium YAML, checks it against the real Jobflick consumer validator, adds **Run Jobflick** only for valid jobs, queues only after the button is clicked, and returns results to the originating conversation.

Jobflick owns the queue, generated job colors, execution and reports. Execarium schema 4 owns the YAML name. The extension creates and persists the optional origin_tab_id outside the YAML; ChatGPT is not asked to construct, track or return tab IDs.

## Edge-first isolated QA

The included launcher uses **Microsoft Edge first**, falling back to Chromium or Chrome only if Edge isn't installed. It never opens or changes the normal Edge profile, tabs, extensions, or browser settings.

1. Install the updated Jobflick executable on PATH. Do not restart its existing daemon while jobs are running.
2. From the Script-Monkey repository checkout, run `fish extensions/jobflick-bridge/qa-isolated-edge.fish`. The launcher derives the unpacked extension ID, registers Native Messaging **only in its isolated profile**, and launches that profile with only Jobflick Bridge enabled. No manual extension-ID copying, developer-mode clicking, or profile switching is required.
3. In that separate window, use a throwaway ChatGPT conversation. Hover over a valid Execarium YAML code block (or click the extension's toolbar icon to scan visible blocks), then click **Run Jobflick**. Watch Jobflick's existing queue and verify the completed report returns to that one conversation.

The isolated profile is stored in `$XDG_DATA_HOME/jobflick-bridge-isolated-qa` (default `~/.local/share/jobflick-bridge-isolated-qa`). It intentionally keeps its own login and cannot reuse live Edge cookies or chats.

**Never enable this extension in an important Edge profile before testing it in isolation.** The test suite uses actual unpacked MV3 Chromium, a fake native host, sixteen synthetic ChatGPT tabs, an 8,000-message fixture, and 4,000 DOM edits. These are meaningful resource and routing regression gates, not proof of compatibility with every future Edge or ChatGPT release.

No DOM observers, idle polling, page-wide repeated scanning, clipboard access, or auto-execution. A code block is validated only when the user approaches it with the pointer or keyboard focus, or requests a visible-block scan with the toolbar.

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
