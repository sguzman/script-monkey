#!/usr/bin/env fish
# Explicit per-extension Native Messaging registration; no HTTP listener.
if test (count $argv) -ne 1
    echo "Usage: fish install-native-host.fish EXTENSION_ID" >&2
    exit 2
end
set -l extension_id $argv[1]
if not string match -rq '^[a-p]{32}$' -- $extension_id
    echo "Expected a 32-character Chromium extension ID" >&2
    exit 2
end
set -l binary (command -s jobflick)
if test -z "$binary"
    echo "Install the updated Jobflick executable first" >&2
    exit 2
end
set -l config "$HOME/.config"
if set -q XDG_CONFIG_HOME
    set config $XDG_CONFIG_HOME
end
for browser in microsoft-edge chromium
    set -l dir "$config/$browser/NativeMessagingHosts"
    mkdir -p "$dir"; or exit 1
    printf '{"name":"io.github.sguzman.jobflick","description":"Local Jobflick bridge","path":"%s","type":"stdio","allowed_origins":["chrome-extension://%s/"]}\n' "$binary" "$extension_id" > "$dir/io.github.sguzman.jobflick.json"; or exit 1
    chmod 600 "$dir/io.github.sguzman.jobflick.json"
    echo "Installed host manifest: $dir"
end
