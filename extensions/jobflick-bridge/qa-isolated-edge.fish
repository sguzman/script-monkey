#!/usr/bin/env fish
# Use a separate persistent QA profile. Does not touch regular Edge tabs.
set -l browser microsoft-edge-stable
if not command -sq $browser
    set browser microsoft-edge
end
if not command -sq $browser
    set browser chromium
end
if not command -sq $browser
    echo "No Edge or Chromium executable available" >&2
    exit 1
end
set -l extension_dir (realpath (dirname (status filename)))
set -l data "$HOME/.local/share"
if set -q XDG_DATA_HOME
    set data $XDG_DATA_HOME
end
mkdir -p "$data/jobflick-bridge-isolated-qa"
$browser --user-data-dir="$data/jobflick-bridge-isolated-qa" --load-extension="$extension_dir" --no-first-run https://chatgpt.com
