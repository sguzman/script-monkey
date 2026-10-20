#!/usr/bin/env fish
# Chrome-only QA. Never launches Edge, Chromium, or a normal Chrome profile.
set -l browser google-chrome-stable
if not command -sq $browser
    set browser google-chrome
end
if not command -sq $browser
    echo "Google Chrome not found. Install Chrome before running this QA launcher." >&2
    exit 1
end

set -l extension_dir (realpath (dirname (status filename)))
set -l data "$HOME/.local/share"
if set -q XDG_DATA_HOME
    set data "$XDG_DATA_HOME"
end
set -l root "$data/jobflick-bridge-chrome-qa"
set -l profile "$root/profile"
set -l config "$root/config"
set -l host_config "$config/google-chrome/NativeMessagingHosts"
set -l qa_data "$root/data"
mkdir -p "$profile" "$host_config" "$qa_data"; or exit 1
chmod 700 "$root" "$profile" "$config" "$qa_data" 2>/dev/null

# Stable unpacked-extension ID: Chromium hashes the canonical source path.
# There is deliberately no key in manifest.json.
set -l extension_id (python3 -c 'import sys,hashlib; d=hashlib.sha256(sys.argv[1].encode()).hexdigest()[:32]; print("".join(chr(97+int(c,16)) for c in d))' "$extension_dir")
if not string match -rq '^[a-p]{32}$' -- "$extension_id"
    echo "Could not derive the extension ID" >&2
    exit 1
end

# All native-host files, including the launcher, stay under this QA root.
env XDG_DATA_HOME="$qa_data" fish "$extension_dir/install-native-host.fish" "$extension_id" "$profile"; or exit 1
# Chrome's host lookup differs between builds. Both copies remain in the
# disposable QA root. No ~/.config/google-chrome or Edge paths are changed.
cp -f "$profile/NativeMessagingHosts/io.github.sguzman.jobflick.json" "$host_config/io.github.sguzman.jobflick.json"; or exit 1

echo ""
echo "Google Chrome QA profile: $profile"
echo "Extension source: $extension_dir"
echo ""
echo "FIRST LAUNCH ONLY:"
echo "  1. In chrome://extensions, enable Developer mode."
echo "  2. Select Load unpacked and choose the extension source above."
echo "The extension persists in this separate Chrome profile afterward."
echo "No regular Chrome or Edge tab, profile, or extension is modified."
echo ""

# Official Chrome 137+ deliberately ignores --load-extension and Chrome
# 139+ ignores --disable-extensions-except. NEVER rely on those flags.
# The single manual Load unpacked action above is a Chrome requirement.
env CHROME_CONFIG_HOME="$config" \
    $browser --user-data-dir="$profile" --new-window --no-first-run \
    --no-default-browser-check --disable-sync chrome://extensions
