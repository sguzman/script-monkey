#!/usr/bin/env fish
# Start ChatGPT Tab Signal only in its own browser profile.
# Never kills/restarts a browser, changes an existing Edge profile,
# copies cookies, or touches existing ChatGPT tabs.

set -l extension_dir (path resolve (path dirname (status filename)))
if not test -f "$extension_dir/manifest.json"
    echo "Cannot find the extension manifest next to this launcher." >&2
    exit 1
end

set -l browser ""
if set -q TAB_SIGNAL_QA_BROWSER
    if not command -sq "$TAB_SIGNAL_QA_BROWSER"
        echo "Configured QA browser not found: $TAB_SIGNAL_QA_BROWSER" >&2
        exit 1
    end
    set browser (command -s "$TAB_SIGNAL_QA_BROWSER")
else
    for candidate in microsoft-edge-stable microsoft-edge chromium
        if command -sq "$candidate"
            set browser (command -s "$candidate")
            break
        end
    end
end
if test -z "$browser"
    echo "Cannot find Microsoft Edge or Chromium. No browser was started." >&2
    exit 1
end

set -l data_home "$HOME/.local/share"
if set -q XDG_DATA_HOME
    if test -n "$XDG_DATA_HOME"
        set data_home "$XDG_DATA_HOME"
    end
end
set -l qa_profile "$data_home/chatgpt-tab-signal-isolated-qa"
mkdir -p -- "$qa_profile"
or exit 1

echo "Launching separate QA browser profile:"
echo "  Browser: $browser"
echo "  QA data: $qa_profile"
echo "  Extension: $extension_dir"
echo "Existing Edge windows, tabs, and profiles are not touched."
echo "The QA profile has its own cookies; sign into ChatGPT there once."
echo "The extension is still disabled in your regular Edge profile."

# Run the dedicated browser independently of Jobflick/terminal lifecycle.
# Do not supply kill/pkill/restart flags, use the normal OS launcher.
setsid -f -- "$browser" \
    --user-data-dir="$qa_profile" \
    --no-first-run \
    --no-default-browser-check \
    --disable-extensions-except="$extension_dir" \
    --load-extension="$extension_dir" \
    "https://chatgpt.com/"
