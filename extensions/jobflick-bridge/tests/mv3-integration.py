#!/usr/bin/env python3
"""Real unpacked MV3 Jobflick Bridge in disposable Chromium, with fake local host.

No real ChatGPT account, actual Jobflick daemon, user browser profile, or live
network resources are used. A tiny test-only native messaging host never runs
shell commands. Test data is synthetic.
"""
import contextlib
import json
import os
import pathlib
import stat
import tempfile
import time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

EXTENSION = pathlib.Path(__file__).resolve().parents[1]
TABS = 16
HOST = "io.github.sguzman.jobflick"

def html(index):
    # Stress one very long transcript and 15 additional conversations.
    count = 8000 if index == 0 else 125
    history = "".join(
        f'<article data-testid="history-{k}">Synthetic historical message {k}</article>'
        for k in range(count)
    )
    return ("<!doctype html><html><head><title>Chat fixture %d</title></head>"
            "<body><main>" % index + history +
            "</main><div id='prompt-textarea' contenteditable='true'></div>"
            "<button data-testid='send-button' id='send'>Send</button></body></html>")

def install_fake_host(base, extension_id):
    native = base / "fake-host.py"
    native.write_text('''#!/usr/bin/env python3
import json, struct, sys
frame=sys.stdin.buffer.read(4)
if len(frame)!=4: sys.exit(1)
size=struct.unpack("<I",frame)[0]
if size>270000: sys.exit(2)
request=json.loads(sys.stdin.buffer.read(size))
action=request.get("action")
if action=="validate_spec":
    answer={"ok":request.get("spec_yaml","").startswith("schema: 4"),
            "message":"Fixture validated"}
elif action=="submit_spec":
    answer={"ok":True,"message":"Queued",
            "job":{"id":"fixture-job-001","state":"queued","name":"QA echo",
                   "color":"#55BBAA","origin_tab_id":request.get("origin_tab_id")}}
elif action=="inspect":
    answer={"ok":True,"message":"Status","job":{"state":"succeeded"}}
elif action=="show":
    answer={"ok":True,"message":"Report","report":"Synthetic Jobflick result: success."}
else:
    answer={"ok":False,"message":"Unexpected action"}
payload=json.dumps(answer).encode("utf8")
sys.stdout.buffer.write(struct.pack("<I",len(payload))+payload)
sys.stdout.buffer.flush()
''',encoding="utf-8")
    native.chmod(native.stat().st_mode | stat.S_IXUSR)
    manifest = json.dumps({
        "name": HOST, "description": "Disposable fixture",
        "type": "stdio", "path": str(native),
        "allowed_origins": ["chrome-extension://" + extension_id + "/"]
    })
    # Chromium for Testing may resolve its host registration relative to
    # either the custom user-data directory or Chrome/Chromium XDG config.
    # All locations here are INSIDE the disposable test directory.
    for directory in (
        base / "profile" / "NativeMessagingHosts",
        base / "home" / ".config" / "chromium" / "NativeMessagingHosts",
        base / "home" / ".config" / "google-chrome" / "NativeMessagingHosts",
        base / "home" / ".config" / "microsoft-edge" / "NativeMessagingHosts",
    ):
        directory.mkdir(parents=True, exist_ok=True)
        (directory / (HOST + ".json")).write_text(manifest,encoding="utf-8")

def main():
    crashes=[]
    with tempfile.TemporaryDirectory(prefix="jobflick-mv3-isolated-") as scratch:
        base=pathlib.Path(scratch)
        home=base/"home"
        home.mkdir()
        env=os.environ.copy()
        env["HOME"]=str(home)
        env["XDG_CONFIG_HOME"]=str(home/".config")
        with sync_playwright() as playwright:
            context=playwright.chromium.launch_persistent_context(
                str(base/"profile"), headless=True, channel="chromium",
                env=env,
                args=["--disable-extensions-except="+str(EXTENSION),
                      "--load-extension="+str(EXTENSION),
                      "--disable-sync","--no-first-run","--no-default-browser-check",
                      "--disable-gpu","--no-sandbox"]
            )
            context.on("close",lambda: crashes.append("browser closed unexpectedly"))
            def route(r):
                url=urlparse(r.request.url)
                if url.scheme=="chrome-extension":
                    return r.continue_()
                if url.hostname=="chatgpt.com" and url.path.startswith("/c/qa-"):
                    idx=int(url.path.rsplit("-",1)[1])
                    return r.fulfill(status=200,content_type="text/html",body=html(idx))
                return r.abort()
            context.route("**/*",route)
            pages=[]
            try:
                worker=(context.service_workers[0] if context.service_workers
                        else context.wait_for_event("serviceworker",timeout=15000))
                extension_id=worker.url.split("/")[2]
                assert len(extension_id)==32,extension_id
                install_fake_host(base,extension_id)
                direct=worker.evaluate('''() => new Promise(done => {
                    chrome.runtime.sendNativeMessage("io.github.sguzman.jobflick",
                      {action:"validate_spec",spec_yaml:"schema: 4\\n"},
                      reply => done({reply,error:chrome.runtime.lastError?.message||null}))
                })''')
                assert direct["reply"] and direct["reply"]["ok"],direct
                print("PASS Chromium native messaging with real unpacked MV3 worker",flush=True)

                for i in range(TABS):
                    page=context.new_page()
                    page.on("crash", lambda _=None,i=i: crashes.append(f"renderer {i} crashed"))
                    page.goto(f"https://chatgpt.com/c/qa-{i}",wait_until="domcontentloaded")
                    pages.append(page)
                assert all(p.title()==f"Chat fixture {i}" for i,p in enumerate(pages))
                assert all(p.locator(".jobflick-run").count()==0 for p in pages)

                # Unrelated main DOM mutations in many tabs must not add buttons,
                # change titles, or crash renderers. The longest has 8000 turns.
                for page in pages:
                    t=page.evaluate('''() => {
                        const start=performance.now();
                        const main=document.querySelector("main");
                        for(let i=0;i<250;i++) {
                            const node=document.createElement("span");
                            node.textContent="synthetic edit";
                            main.appendChild(node);
                            node.remove();
                        }
                        return performance.now()-start;
                    }''')
                    assert t < 1500,("DOM churn blocked renderer",t)
                assert not crashes,crashes
                print(f"PASS {TABS} isolated tabs, 8000-turn history and 4000 DOM edits",flush=True)

                yaml=("schema: 4\nname: QA echo\nshell: fish\ncwd: /tmp\n"
                      "privilege: none\ntimeout_seconds: 15\nenvironment:\n"
                      "  session: inherit\n  gpu: inherit\ncommand: echo ok\n")
                active=pages[0]
                active.evaluate('''yaml => {
                    const pre=document.createElement("pre");
                    const code=document.createElement("code");
                    code.textContent=yaml;pre.appendChild(code);
                    document.querySelector("main").appendChild(pre);
                }''',yaml)
                active.locator("main pre").last.hover()
                try:
                    active.locator(".jobflick-run").wait_for(timeout=10000)
                except Exception:
                    probe=worker.evaluate('''async () => {
                        const tabs=await chrome.tabs.query({url:"https://chatgpt.com/*"});
                        return await Promise.all(tabs.map(async tab => {
                            try {
                                return {id:tab.id,url:tab.url,
                                        reply:await chrome.tabs.sendMessage(tab.id,{type:"jobflick:scan"})};
                            } catch (error) {
                                return {id:tab.id,error:String(error)};
                            }
                        }));
                    }''')
                    print("Diagnostic extension messaging:",probe[:3],flush=True)
                    print("Diagnostic document:",active.evaluate('''() => ({
                        pres:document.querySelectorAll("main pre").length,
                        buttons:document.querySelectorAll(".jobflick-run").length,
                        yaml:document.querySelector("main pre code")?.textContent?.slice(0,180)
                    })'''),flush=True)
                    raise
                assert active.locator(".jobflick-run").count()==1
                active.locator(".jobflick-run").click()
                active.wait_for_function('''() => {
                    return [...document.querySelectorAll(".jobflick-run")]
                        .some(b => b.textContent.includes("Queued"));
                }''',timeout=10000)
                active.wait_for_function('''() => {
                    return document.querySelector("#prompt-textarea").textContent
                        .includes("Synthetic Jobflick result");
                }''',timeout=12000)
                assert active.locator("#prompt-textarea").inner_text().count("Synthetic Jobflick result")==1
                assert all(p.locator("#prompt-textarea").inner_text()=="" for p in pages[1:])
                assert not crashes,crashes
                print("PASS explicit Run click, native submission, status, single-chat report",flush=True)
            finally:
                for page in pages:
                    with contextlib.suppress(Exception):page.close()
                context.close()

if __name__=="__main__":
    main()
