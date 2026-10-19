#!/usr/bin/env bash
set -euo pipefail

# Never launch a real browser. Assert fish launcher passes an isolated profile
# and correct unpacked extension path to a disposable executable.
root="$(cd "$(dirname "$0")/.." && pwd)"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/bin" "$temp/data"
cat >"$temp/bin/tab-signal-mock-browser" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$TAB_SIGNAL_QA_CAPTURE"
MOCK
chmod +x "$temp/bin/tab-signal-mock-browser"
export PATH="$temp/bin:$PATH"
export XDG_DATA_HOME="$temp/data"
export TAB_SIGNAL_QA_CAPTURE="$temp/args"
export TAB_SIGNAL_QA_BROWSER="tab-signal-mock-browser"
fish "$root/qa-isolated-edge.fish"
for i in $(seq 1 50); do
  [[ -s "$temp/args" ]] && break
  sleep .1
done
test -s "$temp/args"
grep -Fx -- "--user-data-dir=$temp/data/chatgpt-tab-signal-isolated-qa" "$temp/args"
grep -Fx -- "--disable-extensions-except=$root" "$temp/args"
grep -Fx -- "--load-extension=$root" "$temp/args"
grep -Fx -- "https://chatgpt.com/" "$temp/args"
! grep -E -- '^--user-data-dir=.*(microsoft-edge/Default|chromium/Default)' "$temp/args"
echo "PASS isolated QA launcher argument contract (no actual browser opened)"
