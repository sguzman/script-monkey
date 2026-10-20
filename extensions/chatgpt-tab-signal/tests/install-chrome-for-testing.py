#!/usr/bin/env python3
"""Install official Chrome for Testing, which permits local unpacked extension QA.

Branded Google Chrome Stable intentionally ignores --load-extension.
This installer is used exclusively in disposable GitHub Actions runners.
"""
import json
import pathlib
import urllib.request
import zipfile

CATALOG = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"
ROOT = pathlib.Path("/tmp/chatgpt-tab-signal-cft")
BROWSER = ROOT / "chrome-linux64" / "chrome"

def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(CATALOG, headers={"User-Agent": "tab-signal-integration-ci"})
    with urllib.request.urlopen(req, timeout=60) as source:
        versions = json.load(source)
    release = versions["channels"]["Stable"]
    matching = [r["url"] for r in release["downloads"]["chrome"]
                if r["platform"] == "linux64"]
    if len(matching) != 1:
        raise RuntimeError("Cannot resolve one Linux Chrome for Testing binary")
    archive = ROOT / "chrome.zip"
    print("Downloading Chrome for Testing stable", release["version"], flush=True)
    urllib.request.urlretrieve(matching[0], archive)
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(ROOT)
    archive.unlink()
    # Python ZipFile.extractall does not restore Unix executable bits.
    # Chrome's crashpad helper is mandatory even with --no-sandbox; without
    # executable permission the browser aborts before the extension loads.
    for helper in ("chrome", "chrome_crashpad_handler", "chrome_sandbox"):
        executable = ROOT / "chrome-linux64" / helper
        if not executable.is_file():
            raise RuntimeError("Chrome for Testing helper missing: " + helper)
        executable.chmod(executable.stat().st_mode | 0o111)
    if not BROWSER.is_file():
        raise RuntimeError("Chrome for Testing executable missing")
    print("Prepared Chrome for Testing:", BROWSER, flush=True)

if __name__ == "__main__":
    main()
