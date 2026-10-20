# Jobflick Bridge

Native Chromium/Edge extension connecting ChatGPT conversations to local Jobflick. It detects Execarium YAML, checks it against the real Jobflick consumer validator, adds **Run Jobflick** only for valid jobs, queues only after the button is clicked, and returns results to the originating conversation.

Jobflick owns the queue, generated job colors, execution and reports. Execarium schema 4 owns the YAML name. The extension creates and persists the optional origin_tab_id outside the YAML; ChatGPT is not asked to construct, track or return tab IDs.

## Chrome-only isolated QA

**The test browser is Google Chrome, not Edge.** The old Edge launcher is disabled. The separate Chrome QA profile does not open, reload, kill, inject into, or modify existing Edge tabs or profiles. It also avoids the normal Chrome profile.

Official Google Chrome 137+ ignores `--load-extension`; Chrome 139+ also ignores `--disable-extensions-except`. Unlike the automated Chromium integration suite, an official Chrome build therefore needs one **Load unpacked** action in an isolated profile. The launcher does not claim to bypass this restriction.

1. Ensure the updated Jobflick executable is installed on PATH. Leave any running jobs and the existing Jobflick daemon alone.
2. From your updated Script-Monkey checkout run `fish extensions/jobflick-bridge/qa-isolated-chrome.fish`. It launches **only** `google-chrome-stable` or `google-chrome`, with a separate user-data directory and native host registration inside that QA directory. It prints the extension's absolute source path.
3. In the isolated Chrome window at `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the printed `extensions/jobflick-bridge` directory. This is a **one-time** step for this QA profile; the extension persists afterward.
4. In that same isolated Chrome window, open ChatGPT and sign in only to that throwaway browser profile. Hover over a valid Execarium YAML code block or press the extension toolbar icon to scan visible code blocks. Click **Run Jobflick** once on a harmless job; verify its report returns to the original conversation.

The QA data stays under `$XDG_DATA_HOME/jobflick-bridge-chrome-qa` (default `~/.local/share/jobflick-bridge-chrome-qa`). The Native Messaging wrapper and manifests are created inside that directory, with Chrome's configuration root overridden for **that Chrome process only**. The Jobflick host retains its normal XDG runtime and data environment, so it can reach the existing daemon.

The automated suite already ran an unpacked MV3 extension in disposable **Chromium**: 16 synthetic ChatGPT tabs, one 8,000-message history, 4,000 DOM edits, a local test native host, explicit submission, and single-chat result delivery. Those checks passed but **cannot guarantee** the branded Chrome build will never crash or consume excessive RAM. This Chrome-only isolation prevents a test failure from taking down a regular browser profile.

No DOM observer, automatic code execution, idle tab polling, clipboard monitoring, or repeated transcript scans. Chrome and Edge are not used interchangeably for user QA.

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
