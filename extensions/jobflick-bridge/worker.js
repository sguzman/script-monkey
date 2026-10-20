"use strict";

const HOST = "io.github.sguzman.jobflick";
const STORAGE = "jobflick_bridge_pending";
const ALARM = "jobflick_bridge_poll";
const DONE = new Set(["succeeded", "failed", "cancelled", "timed_out", "interrupted"]);
let writes = Promise.resolve();
let checking = false;

const canonical = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  } catch { return null; }
};
const native = (value) => new Promise((resolve, reject) => {
  chrome.runtime.sendNativeMessage(HOST, value, (reply) => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!reply || typeof reply.ok !== "boolean") return reject(new Error("Malformed host reply"));
    resolve(reply);
  });
});
const saved = async () => (await chrome.storage.local.get(STORAGE))[STORAGE] || {};
const mutate = (change) => {
  writes = writes.catch(() => {}).then(async () => {
    const jobs = await saved();
    change(jobs);
    await chrome.storage.local.set({[STORAGE]: jobs});
    if (Object.keys(jobs).length) {
      await chrome.alarms.create(ALARM, {periodInMinutes: 0.5});
    } else {
      await chrome.alarms.clear(ALARM);
    }
  });
  return writes;
};
async function originFor(tabId) {
  const key = "jobflick_origin_" + tabId;
  const existing = await chrome.storage.session.get(key);
  if (existing[key]) return existing[key];
  const id = "tab-" + crypto.randomUUID();
  await chrome.storage.session.set({[key]: id});
  return id;
}
async function checkJobs() {
  if (checking) return;
  checking = true;
  try {
    await writes;
    for (const [id, record] of Object.entries(await saved())) {
      try {
        // Browser tab IDs may be reused after closing/restarting the browser.
        // Never deliver an older result to a different tab with the same numeric ID.
        const key = "jobflick_origin_" + record.tab;
        const token = (await chrome.storage.session.get(key))[key];
        if (token !== record.origin) {
          await mutate((jobs) => { delete jobs[id]; });
          continue; // The native Jobflick inbox retains the full report.
        }
        let tab;
        try { tab = await chrome.tabs.get(record.tab); }
        catch {
          await mutate((jobs) => { delete jobs[id]; });
          continue;
        }
        if (canonical(tab.url) !== record.conversation) continue;
        let report = record.report;
        if (!report) {
          const status = await native({action:"inspect", id});
          if (!status.ok || !status.job || !DONE.has(status.job.state)) continue;
          const output = await native({action:"show", id});
          if (!output.ok || typeof output.report !== "string") continue;
          report = output.report;
          await mutate((jobs) => { if (jobs[id]) jobs[id].report = report; });
        }
        let delivery;
        try {
          delivery = await chrome.tabs.sendMessage(record.tab, {
            type:"jobflick:deliver", jobId:id, origin:record.origin,
            conversation:record.conversation, report
          });
        } catch { continue; }
        if (delivery?.delivered) await mutate((jobs) => { delete jobs[id]; });
      } catch {
        // Never resubmit an uncertain job. Leave the saved record for another check.
      }
    }
  } finally { checking = false; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.tab || !Number.isInteger(sender.tab.id)) return false;
  if (!message || !["jobflick:validate","jobflick:submit"].includes(message.type)) return false;
  (async () => {
    if (typeof message.yaml !== "string" || message.yaml.length > 262144) {
      throw new Error("Missing or oversized YAML");
    }
    if (message.type === "jobflick:validate") {
      return native({action:"validate_spec", spec_yaml:message.yaml});
    }
    const conversation = canonical(sender.tab.url || sender.url);
    if (!conversation || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)$/.test(new URL(conversation).origin)) {
      throw new Error("Not a ChatGPT tab");
    }
    const origin = await originFor(sender.tab.id);
    // This only runs after the content script's explicit Run-button click.
    const result = await native({action:"submit_spec", spec_yaml:message.yaml, origin_tab_id:origin});
    if (!result.ok) return result;
    if (typeof result.job?.id !== "string") throw new Error("Submission uncertain; inspect Jobflick before retry");
    await mutate((jobs) => {
      jobs[result.job.id] = {tab:sender.tab.id, origin, conversation, report:null};
    });
    void checkJobs();
    return result;
  })().then(respond, (err) => {
    respond({ok:false, message:String(err.message || err) + (message.type === "jobflick:submit" ? "; inspect inbox before another submission" : "")});
  });
  return true;
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) void checkJobs(); });
chrome.tabs.onUpdated.addListener((_id, update) => {
  if (update.status === "complete" || update.url) void checkJobs();
});
chrome.tabs.onRemoved.addListener((id) => {
  void chrome.storage.session.remove("jobflick_origin_" + id);
  // Closing the requesting tab ends browser delivery, not execution.
  // Jobflick continues executing and retains the report independently.
  void mutate((jobs) => {
    for (const [jobId, record] of Object.entries(jobs)) {
      if (record.tab === id) delete jobs[jobId];
    }
  });
});
chrome.action.onClicked.addListener((tab) => {
  if (Number.isInteger(tab.id)) {
    void chrome.tabs.sendMessage(tab.id, {type:"jobflick:scan"}).catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(() => { void checkJobs(); });
chrome.runtime.onInstalled.addListener(() => { void checkJobs(); });
