#!/usr/bin/env fish
# Edge QA is disabled for this project. Use the isolated Chrome launcher.
set -l extension_dir (realpath (dirname (status filename)))
echo "Jobflick Bridge QA is Chrome-only. Edge will not be launched." >&2
echo "Run: fish $extension_dir/qa-isolated-chrome.fish" >&2
exit 2
