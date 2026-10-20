#!/usr/bin/env fish
# One-command Edge-first QA. Never opens, reloads, or modifies primary tabs.
set -l browser microsoft-edge-stable
if not command -sq $browser
    set browser microsoft-edge
end
if not command -sq $browser
    set browser chromium
end
if not command -sq $browser
    set browser google-chrome-stable
end
if not command -sq $browser
    set browser google-chrome
end
if not command -sq $browser
    echo "Edge/Chromium/Chrome executable not found" >&2
    exit 1
end
set -l extension_dir (realpath (dirname (status filename)))
set -l data "$HOME/.local/share"
if set -q XDG_DATA_HOME
    set data $XDG_DATA_HOME
end
set -l profile "$data/jobflick-bridge-isolated-qa"
mkdir -p "$profile"; or exit 1
# Unpacked Chromium extension IDs are derived from their canonical path,
# unless manifest.json sets a fixed key (this extension deliberately does not).
set -l extension_id (python3 -c 'import sys,hashlib; p=sys.argv[1].encode(); d=hashlib.sha256(p).hexdigest()[:32]; print("".join(chr(97+int(x,16)) for x in d))' "$extension_dir")
if not string match -rq '^[a-p]{32}$' -- "$extension_id"
    echo "Cannot derive unpacked extension ID" >&2
    exit 1
end
# Register only in the disposable QA profile, not normal Edge.
fish "$extension_dir/install-native-host.fish" "$extension_id" "$profile"; or exit 1
$browser --user-data-dir="$profile" --disable-extensions-except="$extension_dir" --load-extension="$extension_dir" --no-first-run --no-default-browser-check https://chatgpt.com
