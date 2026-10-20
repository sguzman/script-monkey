#!/usr/bin/env fish
# Explicit per-extension Native Messaging registration; no HTTP listener.
if test (count $argv) -lt 1; or test (count $argv) -gt 2
    echo "Usage: fish install-native-host.fish EXTENSION_ID [ISOLATED_PROFILE]" >&2
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
# Chromium launches the host binary directly and does not allow arguments
# in its manifest. Jobflick's JSON protocol runs under `jobflick native-host`,
# so we install a small executable wrapper as the registered host.
set -l data "$HOME/.local/share"
if set -q XDG_DATA_HOME
    set data $XDG_DATA_HOME
end
set -l host_dir "$data/jobflick-bridge"
mkdir -p "$host_dir"; or exit 1
chmod 700 "$host_dir"; or exit 1
set -l host "$host_dir/native-host"
set -l staging (mktemp "$host_dir/native-host.XXXXXXXX"); or exit 1
set -l escaped_binary (string escape --style=script -- "$binary")
printf '#!/usr/bin/env fish\nexec %s native-host\n' "$escaped_binary" > "$staging"; or exit 1
chmod 700 "$staging"; or exit 1
mv -f "$staging" "$host"; or exit 1

set -l config "$HOME/.config"
if set -q XDG_CONFIG_HOME
    set config $XDG_CONFIG_HOME
end
set -l dirs
if test (count $argv) -eq 2
    # The first QA run only registers into a disposable user-data directory.
    # It never changes the user's normal Edge, Chromium, or Chrome profiles.
    set -a dirs (realpath -m -- "$argv[2]")/NativeMessagingHosts
else
    # Legacy explicit installation for ordinary profiles.
    for browser in microsoft-edge chromium google-chrome
        set -a dirs "$config/$browser/NativeMessagingHosts"
    end
end
for dir in $dirs
    mkdir -p "$dir"; or exit 1
    printf '{"name":"io.github.sguzman.jobflick","description":"Local Jobflick bridge","path":"%s","type":"stdio","allowed_origins":["chrome-extension://%s/"]}\n' "$host" "$extension_id" > "$dir/io.github.sguzman.jobflick.json"; or exit 1
    chmod 600 "$dir/io.github.sguzman.jobflick.json"; or exit 1
    echo "Registered Jobflick native host: $dir"
end
