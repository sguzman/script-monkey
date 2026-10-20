(() => {
  "use strict";
  if (window.__jobflickBridge) return;
  window.__jobflickBridge = true;
  const MAX = 262144;
  const states = new WeakMap();
  const dirty = new Set();
  let scheduled = null;
  let activeChecks = 0;
  let start = Date.now();
  let changes = 0;
  function request(data) {
    return new Promise((resolve,reject) => chrome.runtime.sendMessage(data, reply => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(reply || {ok:false,message:"No response"});
    }));
  }
  function spec(pre) {
    const code = pre?.querySelector("code");
    if (!code) return null;
    const yaml = code.textContent || "";
    if (yaml.length > MAX || !/^\s*schema:\s*[1-4]\s*$/m.test(yaml.slice(0,128))) return null;
    if (!/^\s*(command|commands):/m.test(yaml)) return null;
    return yaml;
  }
  function enqueue(pre) {
    if (!pre?.isConnected || !pre.matches("pre") || dirty.size >= 16) return;
    dirty.add(pre);
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(drain, 700);
  }
  async function check(pre, state) {
    activeChecks++;
    try {
      const result = await request({type:"jobflick:validate",yaml:state.yaml});
      if (states.get(pre) !== state || !pre.isConnected) return;
      if (!result.ok) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "jobflick-run";
      button.textContent = "Run Jobflick";
      button.style.cssText = "display:inline-block;margin:6px 0;padding:5px 10px;border:1px solid #51c3ac;border-radius:7px;background:#163c35;color:#e3fff7;cursor:pointer;font-size:12px";
      state.button = button;
      pre.insertAdjacentElement("afterend", button);
      button.addEventListener("click", async () => {
        if (state.submitted) return;
        if (spec(pre) !== state.yaml) { button.textContent = "YAML changed"; enqueue(pre); return; }
        state.submitted = true;
        button.disabled = true;
        button.textContent = "Submitting...";
        try {
          const result = await request({type:"jobflick:submit",yaml:state.yaml});
          if (!result.ok || !result.job) {
            button.textContent = "Submission uncertain; inspect inbox";
            button.title = result.message || "No confirmed job ID";
            return;
          }
          button.textContent = "Queued " + result.job.id.slice(0,8);
          button.title = result.job.name || result.job.id;
          if (/^#[0-9a-f]{6}$/i.test(result.job.color || "")) {
            button.style.borderColor = result.job.color;
            button.style.color = result.job.color;
          }
        } catch (error) {
          button.textContent = "Submission uncertain; inspect inbox";
          button.title = String(error);
        }
      }, {once:true});
    } catch {
      // Missing host or disconnected native runtime: no loops and no auto retry.
    } finally {
      activeChecks--;
      // Pending validation candidates are never silently dropped at the
      // concurrency ceiling. Schedule one bounded continuation if needed.
      if (dirty.size && !scheduled) scheduled = setTimeout(drain,250);
    }
  }
  function drain() {
    scheduled = null;
    const capacity = Math.max(0,4-activeChecks);
    const batch = [...dirty].slice(0,capacity);
    for (const pre of batch) {
      dirty.delete(pre);
      const yaml = spec(pre);
      if (!yaml) continue;
      const previous = states.get(pre);
      if (previous?.yaml === yaml) continue;
      previous?.button?.remove();
      const state = {yaml,submitted:false,button:null};
      states.set(pre,state);
      void check(pre,state);
    }
    if (dirty.size && capacity > 0 && !scheduled) scheduled = setTimeout(drain,250);
  }
  const main = document.querySelector("main");
  if (main) {
    const observer = new MutationObserver(mutations => {
      if (Date.now()-start > 60000) { start=Date.now(); changes=0; }
      changes += mutations.length;
      if (changes > 1200) {
        observer.disconnect();
        if (scheduled) clearTimeout(scheduled);
        dirty.clear();
        return;
      }
      for (const mutation of mutations.slice(0,48)) {
        const target = mutation.target.nodeType === Node.ELEMENT_NODE
          ? mutation.target : mutation.target.parentElement;
        const ancestor = target?.closest?.("pre");
        if (ancestor) enqueue(ancestor);
        for (const node of [...mutation.addedNodes].slice(0,12)) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.matches("pre")) enqueue(node);
          else if (node.matches("code")) enqueue(node.closest("pre"));
          else if (node.childElementCount <= 24) {
            const code = node.querySelector("pre code");
            if (code) enqueue(code.closest("pre"));
          }
        }
      }
    });
    observer.observe(main, {childList:true,characterData:true,subtree:true});
  }
  async function deliver(job) {
    const here = location.origin + location.pathname.replace(/\/$/,"");
    if (here !== job.conversation || typeof job.report !== "string" || job.report.length > MAX) {
      return {delivered:false};
    }
    const editor = document.querySelector('#prompt-textarea[contenteditable="true"], [data-testid="composer-rich-text-input"][contenteditable="true"]');
    if (!editor || (editor.textContent || "").trim()) return {delivered:false};
    editor.focus();
    // A page focus handler may restore a draft; never overwrite that draft.
    if ((editor.textContent || "").trim()) return {delivered:false};
    const text = "Jobflick result " + job.jobId + " from " + job.origin + ":\n\n" + job.report;
    if (!document.execCommand("insertText",false,text)) return {delivered:false};
    if (!(editor.textContent || "").includes("Jobflick result " + job.jobId)) return {delivered:false};
    await new Promise(resolve => setTimeout(resolve,250));
    // Do not submit if the user changed or added anything to the draft.
    // In that case the content stays in the editor for manual review.
    const untouched = (editor.textContent || "").trim() === text.trim();
    const send = untouched
      ? document.querySelector('button[data-testid="send-button"]:not([disabled])')
      : null;
    if (send) send.click();
    // If Send is absent, the user can submit the preserved draft manually.
    return {delivered:true, submitted:!!send};
  }
  chrome.runtime.onMessage.addListener((message,_sender,respond) => {
    if (message?.type === "jobflick:deliver") {
      deliver(message).then(respond, () => respond({delivered:false}));
      return true;
    }
    if (message?.type === "jobflick:scan") {
      // Only an explicit toolbar click scans the existing DOM.
      for (const pre of document.querySelectorAll("main pre")) {
        const box = pre.getBoundingClientRect();
        if (box.bottom > 0 && box.top < innerHeight) enqueue(pre);
      }
      respond({ok:true});
    }
    return false;
  });
})();
