'use strict';

// Classic MV3 worker import; same dependency-free implementation as the page.
if (typeof importScripts === 'function') importScripts('conversation-color.js');

const OFFSCREEN_DOCUMENT = 'offscreen.html';
// PNG adapted from the upstream AGPL-3.0 project's icon; embedded as a data URL
// so this no-build checkout remains entirely text-based.
const NOTIFICATION_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAADR0lEQVR4nO2dXXIiMQwGzdYeYS7B/Q/DcbJPVLEkBHuQ9fd1PxPiSG3J9jg1l+M4vgbI8id6ABALAoiDAOIggDgIIA4CiIMA4iCAOAggDgKIgwDiIIA4CCAOAoiDAOL8jR7AGGPcbrfoIYRwvV6jhzAuURdCVJP+iigZ3AUg8b/jLYKbACR+DS8RXBaBJH8dr5htrQAk3oad1WBbBSD5duyM5RYBSL49u2Ka4hxgjBx7Yk+yTBLzNcDKH6aW9FdExsy0BZD8c6zEwrpyuLcAEv8z97h4twazCjAzcJL/npkYWUrC00BxTARg9tviWQVcKgDJX6fVswDIy8cCZDnQUMQi9tsrAOX/PB6xS3MU7MW7WaMmrIQAK6Xy8bMKMrQW4NMeef/5ziK0FMB6YdpZhHbbwJ27ko47nlYCeCSomwRtBPBMTCcJWggQkZAuEpQXIDIRHSQovQs4m4BXq/kz33e73UrvDkoLsMq7REXdyomkbAtYvX+4MktXP19ZmJICeF0+VZCgpACzWPTmyv19hnICzM40y8TNflfFKlBOALClpQA7ynbXVlBKgAoltsIYHyklwAw7Z2rHKtBOAFgDAcQpI0Cl3lpprGUEmMGjR3dbB7QSANZBAHHSPg6u1Ed/4nn8WVsHFUCctBVghqhZ9fx7K1crKoA4CCAOAoiDAOIggDgIIA4CiIMA4iCAOAggDgKIgwDiIIA4CCAOAoiDAOKUvhBS+SJGFqgA4iCAOAggDgKIk3YRWP3mbdb/A3iGCiAOAoiDAOKkXQM8Y9FTebv5d6gA4iCAOAggDgKIIyXA7MJOZQE4hoMA2U7wZl8akQGP2H0sQKaAzfJqzNX+FovxljkHsKZasnfhsgbI1gYq4BUzEwFmZhMSzDMTK6sKJrULgO+YCUAVsMFz9o8RsAjs/Cr2T4iaHKYtQOE1azuIfEp5OY7jy/Qbx7nkqlWELDFKcw5ARYhhyy5AbTZ7sCum27aBSGDHzlhuWQM8Q3k/h8ckcjkIohqs4xUzlwrwCNXgd7wni7sAdxDhf6KqZJgAj6jKkKE1phAA4uBpoDgIIA4CiIMA4iCAOAggDgKIgwDiIIA4CCAOAoiDAOIggDgIIA4CiPMPMxH82wgo8LsAAAAASUVORK5CYII=';
const RESPONSE_PREVIEW_MAX_CHARS = 260;
const COLOR_ALLOCATION_KEY = 'chatgptTabSignalActiveColorsV2';
let pendingColorAllocation = Promise.resolve();
let pendingColorBootstrap = Promise.resolve();
const CHATGPT_REQUEST_FILTER = {
  urls: [
    'https://chatgpt.com/backend-api/f/conversation*',
    'https://chatgpt.com/backend-api/conversation*'
  ]
};

let creatingOffscreen = null;
const lastNotificationFingerprintByTab = new Map();
const fallbackTimersByTab = new Map();
const ignoredRequestByTab = new Map();
const pendingRequestStateByTab = new Map();
const FALLBACK_DELAY_MS = 4500;
const requestStateKey = id => 'chatgptTabSignalRequest:' + id;
const alertStateKey = id => 'chatgptTabSignalNotified:' + id;

function clearFallback(id) {
  const timer = fallbackTimersByTab.get(id);
  if (timer !== undefined) clearTimeout(timer);
  fallbackTimersByTab.delete(id);
}
function setRequestState(tabId, requestId, data) {
  // Chrome can dispatch request events and content-script verdicts before
  // earlier session writes finish. Serialize state transitions by tab so
  // an ignored request cannot be resurrected by a late "started" write.
  const preceding = pendingRequestStateByTab.get(tabId) || Promise.resolve();
  const job = preceding.catch(() => {}).then(async () => {
    const key = requestStateKey(tabId);
    const prior = (await chrome.storage.session.get(key))[key];
    if (prior?.requestId !== requestId) {
      if (!['started','ignored'].includes(data.state)) return;
      await chrome.storage.session.set({[key]:{requestId,state:data.state}});
    } else {
      if (prior.state === 'ignored' && data.state === 'started') return;
      await chrome.storage.session.set({[key]:{...prior,...data}});
    }
  });
  pendingRequestStateByTab.set(tabId,job);
  job.finally(() => {
    if (pendingRequestStateByTab.get(tabId) === job)
      pendingRequestStateByTab.delete(tabId);
  }).catch(() => {});
  return job;
}
async function alertOnce(tabId, requestId, title, iconUrl) {
  if (lastNotificationFingerprintByTab.get(tabId) === requestId) return;
  const key = alertStateKey(tabId);
  if ((await chrome.storage.session.get(key))[key] === requestId ||
      lastNotificationFingerprintByTab.get(tabId) === requestId) return;
  lastNotificationFingerprintByTab.set(tabId, requestId);
  // A failed sound does not justify repeating a successful native notification.
  await emitBoth({tabId,title:cleanSessionTitle(title),
    message:'Response finished.',iconUrl});
  await chrome.storage.session.set({[key]:requestId});
}
async function workerIdentityIcon(tabId) {
  const color = await assignedColorForTab(tabId).catch(() => null);
  if (!color) return null;
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type:'CHATGPT_RENDER_IDENTITY_ICON',hex:color.hex,kind:color.kind
  });
  return response?.iconUrl || null;
}
async function fallbackCompletion(tabId, requestId) {
  const key = requestStateKey(tabId);
  let state = (await chrome.storage.session.get(key))[key];
  if (ignoredRequestByTab.get(tabId) === requestId ||
      state?.requestId !== requestId || state.state !== 'started') return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!isChatgptTab(tab?.url)) return;
  // The worker's background fallback cannot invent a completion from
  // HTTP 2xx. A fresh isolated-world probe checks the same positive
  // assistant-action evidence even if the tab renderer's timer was delayed.
  const probe = await chrome.scripting.executeScript({
    target:{tabId},
    func:() => {
      const baseline = Number(document.documentElement?.dataset
        ?.chatgptTabSignalCopyBaseline);
      if (!Number.isFinite(baseline)) return false;
      const controls = document.querySelectorAll(
        'button[data-testid="copy-turn-action-button"]');
      const stop = document.querySelector(
        'button[data-testid="stop-button"], button[aria-label="Stop generating"]');
      return controls.length > baseline &&
        !(stop && stop.getClientRects?.().length);
    }
  }).catch(() => null);
  if (probe?.[0]?.result !== true) return;
  const icon = await workerIdentityIcon(tabId).catch(() => null);
  state = (await chrome.storage.session.get(key))[key];
  if (ignoredRequestByTab.get(tabId) === requestId ||
      state?.requestId !== requestId || state.state !== 'started') return;
  // Worker-owned unread hint, sent without waiting on a throttled renderer.
  // The actual completion alert must never depend on a tab message resolving.
  signalToChatTab(tabId,{type:'CHATGPT_PREVIEW_UNREAD',requestId})
    .catch(() => {});
  await alertOnce(tabId,requestId,tab.title,icon);
}
function scheduleFallback(tabId, requestId) {
  clearFallback(tabId);
  const timer = setTimeout(() => {
    fallbackTimersByTab.delete(tabId);
    fallbackCompletion(tabId,requestId).catch(error =>
      console.error('ChatGPT Tab Signal: fallback failed',error));
  }, FALLBACK_DELAY_MS);
  fallbackTimersByTab.set(tabId,timer);
}
// The extension never injects on installation, navigation, or idle tabs.
// A matching outbound ChatGPT conversation POST is the ONLY activation event.
const INJECTION_PREFIX = 'chatgptTabSignalInjected:';
const INJECTION_BUILD = '0.1.27';
const pendingByTab = new Map();
const documentEpochByTab = new Map();

// A single serialized storage transaction allocates only for the requesting
// chat. No tab enumeration, polling, broadcast, or mass recoloring occurs.
function withColorAllocation(fn) {
  const job = pendingColorAllocation.catch(() => {}).then(fn);
  pendingColorAllocation = job.catch(() => {});
  return job;
}

async function assignedColorForTab(tabId) {
  // Extension reload clears session storage on some Chromium versions.
  // Restore already-rendered allocations before assigning new swatches.
  await pendingColorBootstrap.catch(() => {});
  return withColorAllocation(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!isChatgptTab(tab?.url)) return null;
    const api = globalThis.ChatGPTConversationColor;
    const identity = api?.fromUrl(tab.url);
    if (!identity) return null;
    const stored = (await chrome.storage.session.get(COLOR_ALLOCATION_KEY))[COLOR_ALLOCATION_KEY] || {};
    const tabKey = String(tabId);
    if (stored[tabKey]?.key === identity.key &&
        !Object.entries(stored).some(([id,c]) =>
          id !== tabKey && c?.key !== identity.key &&
          c?.hex === stored[tabKey].hex)) return stored[tabKey];
    delete stored[tabKey];

    // Multiple tabs displaying the same chat share one assigned identity.
    const match = Object.values(stored).find(item => item?.key === identity.key);
    const result = match || api.assignFromUrl(tab.url,
      [...new Set(Object.values(stored).filter(item => item?.key !== identity.key)
        .map(item => item?.hex).filter(Boolean))]);
    if (!result || !/^#[0-9a-f]{6}$/.test(result.hex)) return null;
    const assigned = { key: identity.key, kind: identity.kind, hex: result.hex };
    stored[tabKey] = assigned;
    await chrome.storage.session.set({ [COLOR_ALLOCATION_KEY]: stored });
    return assigned;
  });
}

async function bootstrapOpenTabColors(tabs) {
  // One bounded migration read of public DOM color values. No transcript
  // inspection, polling or persistent storage of private chat identifiers.
  const stored = {};
  const perKey = new Map();
  const used = new Set();
  for (const tab of tabs) {
    if (!Number.isInteger(tab.id) || !isChatgptTab(tab.url)) continue;
    const identity = globalThis.ChatGPTConversationColor?.fromUrl(tab.url);
    if (!identity) continue;
    let hex = perKey.get(identity.key);
    if (!hex) {
      try {
        const result = await chrome.scripting.executeScript({
          target:{tabId:tab.id},
          func:() => ({
            hex:document.documentElement?.dataset?.chatgptTabSignalColor,
            ready:document.documentElement?.dataset?.chatgptTabSignalColorResolved
          })
        });
        const candidate=result?.[0]?.result;
        if (candidate?.ready === 'v2' &&
            /^#[0-9a-f]{6}$/.test(candidate.hex) &&
            !used.has(candidate.hex)) hex=candidate.hex;
      } catch { /* Discard inaccessible tab without navigation. */ }
      if (!hex) {
        hex=globalThis.ChatGPTConversationColor.assignFromUrl(tab.url,[...used]).hex;
      }
      perKey.set(identity.key,hex);
      used.add(hex);
    }
    stored[String(tab.id)]={key:identity.key,kind:identity.kind,hex};
  }
  await chrome.storage.session.set({[COLOR_ALLOCATION_KEY]:stored});
}

function forgetColorForTab(tabId) {
  return withColorAllocation(async () => {
    const stored = (await chrome.storage.session.get(COLOR_ALLOCATION_KEY))[COLOR_ALLOCATION_KEY];
    if (!stored || !Object.hasOwn(stored, String(tabId))) return;
    delete stored[String(tabId)];
    await chrome.storage.session.set({ [COLOR_ALLOCATION_KEY]: stored });
  });
}

function isChatgptTab(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'chatgpt.com';
  } catch {
    return false;
  }
}

function injectedKey(tabId) {
  return INJECTION_PREFIX + String(tabId);
}

function documentEpoch(tabId) {
  return documentEpochByTab.get(tabId) || 0;
}

function normalizePathname(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function isAnswerStreamRequest(details) {
  if (details.tabId < 0 || details.method !== 'POST' ||
      !isChatgptTab(details.url)) return false;
  const path = normalizePathname(details.url);
  return path === '/backend-api/f/conversation' || path === '/backend-api/conversation';
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });
  if (contexts.length > 0) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play an audible alert after a ChatGPT response completes.'
    }).finally(() => {
      creatingOffscreen = null;
    });
  }
  await creatingOffscreen;
}

async function playCompletionSound() {
  await ensureOffscreenDocument();
  const result = await chrome.runtime.sendMessage({ type: 'PLAY_COMPLETION_SOUND' });
  if (!result?.ok || result.rendered !== true ||
      result.contextState !== 'running') {
    throw new Error(result?.error ||
      'Offscreen audio did not confirm completed Web Audio rendering.');
  }
}

function cleanSessionTitle(rawTitle) {
  const raw = String(rawTitle || '').replace(/\s+/g, ' ').trim().replace(/^(?:(?:⏳|🔔|✅|⚠️|🛑|🔌|❌|🚫|🟥|🟧|🟨|🟩|🟦|🟪|🔴|🟠|🟡|🟢|🔵|🟣|●|◌|•)\s+)+/u, '');
  if (!raw) return 'ChatGPT';
  const cleaned = raw
    .replace(/\s*[-|–—]\s*ChatGPT\s*$/i, '')
    .replace(/^ChatGPT\s*[-|–—]\s*/i, '')
    .trim();
  return cleaned && cleaned.toLowerCase() !== 'chatgpt' ? cleaned : 'ChatGPT';
}

function truncateResponse(text, maxChars = RESPONSE_PREVIEW_MAX_CHARS) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Response finished.';
  if (normalized.length <= maxChars) return normalized;
  const slice = normalized.slice(0, Math.max(1, maxChars - 3));
  const lastSpace = slice.lastIndexOf(' ');
  const safeCut = lastSpace >= Math.floor(maxChars * 0.7) ? slice.slice(0, lastSpace) : slice;
  return `${safeCut.trimEnd()}...`;
}

async function emitBoth({ tabId = null, title = 'ChatGPT', message = 'Response finished.', iconUrl = null, isTest = false } = {}) {
  const id = isTest
    ? `chatgpt-prompt-bound-test:${Date.now()}`
    : `chatgpt-prompt-bound:${tabId}:${Date.now()}`;

  const [soundResult, notificationResult] = await Promise.allSettled([
    playCompletionSound(),
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: typeof iconUrl === 'string' && iconUrl.length <= 8192 &&
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(iconUrl)
        ? iconUrl : NOTIFICATION_ICON_DATA_URL,
      title: isTest ? 'Background alert test' : title,
      message,
      priority: 2,
      requireInteraction: false,
      // Do not suppress operating-system notification sounds: the browser
      // chime is separate and OS audio can help when Web Audio is inaudible.
      silent: false
    })
  ]);

  if (soundResult.status === 'rejected') console.error('Prompt-Bound Alert: sound failed', soundResult.reason);
  if (notificationResult.status === 'rejected') console.error('Prompt-Bound Alert: notification failed', notificationResult.reason);
  // Notification delivery remains independent if Web Audio fails.
  // Log audio failures rather than treating an accepted event as audible.
  if (soundResult.status === 'rejected' || notificationResult.status === 'rejected') {
    const failures = [];
    if (soundResult.status === 'rejected') failures.push('Sound: ' + String(soundResult.reason));
    if (notificationResult.status === 'rejected') failures.push('Notification: ' + String(notificationResult.reason));
    throw new Error(failures.join('; '));
  }
  return id;
}

async function deliverToTab(tabId, message, mayInject, epoch) {
  if (epoch !== documentEpoch(tabId)) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!isChatgptTab(tab?.url) || epoch !== documentEpoch(tabId)) return;

  // documentId is the UUID of the actual document originating this request.
  // Unlike tabs.onUpdated(status:loading), it does not change when ChatGPT
  // promotes / to /c/<id> through the History API.
  const docId = message.documentId || null;
  const key = injectedKey(tabId);
  const previous = (await chrome.storage.session.get(key))[key];
  if (!mayInject && previous && docId && previous.documentId &&
      previous.documentId !== docId) return;

  // The script may already be running in this actual document. A successful
  // START message registers it even after extension worker suspension.
  try {
    await chrome.tabs.sendMessage(tabId, message);
    if (mayInject && epoch === documentEpoch(tabId)) {
      await chrome.storage.session.set({ [key]: { documentId: docId, build: INJECTION_BUILD } });
    }
    return;
  } catch {
    if (!mayInject || epoch !== documentEpoch(tabId)) return;
  }

  if (previous?.build === INJECTION_BUILD &&
      previous.documentId === docId) return;
  // Never allow an injection marker from a previous extension build to
  // suppress recovery in a still-open physical document. Retry at most once
  // for this build/document, even when injection fails.
  await chrome.storage.session.set({
    [key]: { documentId: docId, build: INJECTION_BUILD }
  });
  if (epoch !== documentEpoch(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['conversation-color.js', 'chat-color-title.js', 'content-script.js']
    });
    if (epoch !== documentEpoch(tabId)) return;
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Fail closed for this document; never retry on every network event.
  }
}

function signalToChatTab(tabId, message) {
  // Preserve START -> COMPLETE ordering within each tab. Other tabs proceed
  // independently, without full-page scanning or global tab enumeration.
  const epoch = documentEpoch(tabId);
  const preceding = pendingByTab.get(tabId) || Promise.resolve();
  const job = preceding.catch(() => {}).then(() =>
    deliverToTab(tabId, message,
      message.type === 'CHATGPT_GENERATION_STARTED', epoch)
  );
  pendingByTab.set(tabId, job);
  job.finally(() => {
    if (pendingByTab.get(tabId) === job) pendingByTab.delete(tabId);
  }).catch(() => {});
  return job;
}

// Request START is independent from the prompt-bound END watcher. A tab can
// show activity immediately while ChatGPT is still thinking or streaming.
chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (!isAnswerStreamRequest(details)) return;
  clearFallback(details.tabId);
  setRequestState(details.tabId,String(details.requestId || ''),{state:'started'})
    .catch(() => {});
  signalToChatTab(details.tabId, {
    type: 'CHATGPT_GENERATION_STARTED',
    requestId: String(details.requestId || ''),
    startedAt: details.timeStamp || Date.now(),
    documentId: details.documentId || null
  }).catch(() => {});
}, CHATGPT_REQUEST_FILTER);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  if (!isAnswerStreamRequest(details) ||
      ignoredRequestByTab.get(details.tabId) === String(details.requestId || '')) return;
  // Once this request has produced a successful completion alert, late
  // transport errors cannot rewrite its terminal state.
  if (lastNotificationFingerprintByTab.get(details.tabId) ===
      String(details.requestId || '')) return;
  // ERR_ABORTED commonly means a user/client canceled a stream, not an
  // outage. Transport failures such as ERR_INTERNET_DISCONNECTED are errors.
  const canceled = /(?:^|::)ERR_ABORTED$/.test(String(details.error || ''));
  clearFallback(details.tabId);
  setRequestState(details.tabId,String(details.requestId || ''),
    {state:canceled?'canceled':'failed'}).catch(() => {});
  signalToChatTab(details.tabId, {
    type: canceled ? 'CHATGPT_GENERATION_ABORTED' : 'CHATGPT_CONVERSATION_REQUEST_FAILED',
    requestId: String(details.requestId || ''),
    documentId: details.documentId || null
  }).catch(() => {});
}, CHATGPT_REQUEST_FILTER);

chrome.webRequest.onCompleted.addListener((details) => {
  if (!isAnswerStreamRequest(details) ||
      ignoredRequestByTab.get(details.tabId) === String(details.requestId || '')) return;
  if (details.statusCode < 200 || details.statusCode >= 300) {
    if (lastNotificationFingerprintByTab.get(details.tabId) ===
        String(details.requestId || '')) return;
    clearFallback(details.tabId);
    setRequestState(details.tabId,String(details.requestId || ''),
      {state:'failed'}).catch(() => {});
    signalToChatTab(details.tabId, {
      type: 'CHATGPT_CONVERSATION_REQUEST_FAILED',
      requestId: String(details.requestId || ''),
      documentId: details.documentId || null,
      statusCode: details.statusCode
    }).catch(() => {});
    return;
  }
  const requestId = String(details.requestId || '');
  // A hidden renderer's timeout may be throttled indefinitely. The worker
  // owns a one-shot completion fallback independent of page visibility.
  scheduleFallback(details.tabId,requestId);
  signalToChatTab(details.tabId, {
    type:'CHATGPT_CONVERSATION_REQUEST_COMPLETED', requestId,
    documentId:details.documentId || null
  }).catch(() => {});
}, CHATGPT_REQUEST_FILTER);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CHATGPT_REQUEST_IGNORED') {
    const tabId = sender.tab?.id;
    const requestId = String(message.requestId || '');
    if (!Number.isInteger(tabId) || !requestId ||
        !isChatgptTab(sender.url)) return;
    ignoredRequestByTab.set(tabId,requestId);
    clearFallback(tabId);
    setRequestState(tabId,requestId,{state:'ignored'}).catch(() => {});
    return;
  }
  if (message?.type === 'CHATGPT_REQUEST_CANCELED' ||
      message?.type === 'CHATGPT_RESPONSE_REJECTED') {
    const tabId=sender.tab?.id;
    if (!Number.isInteger(tabId) || !isChatgptTab(sender.url)) return;
    clearFallback(tabId);
    setRequestState(tabId,String(message.requestId || ''),
      {state:message.type==='CHATGPT_REQUEST_CANCELED'?'canceled':'failed'})
      .catch(() => {});
    return;
  }
  if (message?.type === 'CHATGPT_TAB_COLOR_REQUEST') {
    const id = sender.tab?.id;
    if (!Number.isInteger(id) || !isChatgptTab(sender.url)) return;
    assignedColorForTab(id).then(color => sendResponse(color))
      .catch(() => sendResponse(null));
    return true;
  }
  if (message?.type === 'CHATGPT_TAB_COLOR_RELEASE') {
    const id = sender.tab?.id;
    if (Number.isInteger(id)) forgetColorForTab(id).catch(() => {});
    return;
  }
  if (message?.type !== 'CHATGPT_RESPONSE_COMPLETE') return;
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || !isChatgptTab(sender.url)) return;
  (async () => {
    // Even a stale or spoofed content script cannot send a completion
    // without a recorded post-driven activation for this tab.
    const key = injectedKey(tabId);
    if (!(await chrome.storage.session.get(key))[key]) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!isChatgptTab(tab?.url)) return;
    const requestId = String(message.requestId || '');
    if (!requestId) return;
    clearFallback(tabId);
    const state=(await chrome.storage.session.get(requestStateKey(tabId)))[requestStateKey(tabId)];
    if (ignoredRequestByTab.get(tabId)===requestId ||
        (state?.requestId===requestId &&
        (state.state==='canceled'||state.state==='failed'||
         state.state==='ignored'))) return;
    await alertOnce(tabId,requestId,message.sessionTitle,message.notificationIcon);
  })().catch(error => console.error('ChatGPT Tab Signal: completion alert failed', error));

});

function invalidateTab(tabId) {
  clearFallback(tabId);
  ignoredRequestByTab.delete(tabId);
  pendingRequestStateByTab.delete(tabId);
  chrome.storage.session.remove([requestStateKey(tabId),alertStateKey(tabId)]).catch(() => {});
  documentEpochByTab.set(tabId, documentEpoch(tabId) + 1);
  lastNotificationFingerprintByTab.delete(tabId);
  pendingByTab.delete(tabId);
  chrome.storage.session.remove(injectedKey(tabId)).catch(() => {});
}

// Install/update/reload: upgrade already-open documents in place. Never
// navigate or reload user tabs. This one-time pass is bounded, not polling.
// Unlike cold startup, the update path includes the response watcher so
// currently open chats immediately use this build's detection logic.
chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    const tabs = await chrome.tabs.query({
      url: ['https://chatgpt.com/c/*', 'https://chatgpt.com/g/*/c/*']
    });
    const selected = tabs.slice(0, 72);
    pendingColorBootstrap = bootstrapOpenTabColors(selected);
    await pendingColorBootstrap;
    for (const tab of selected) {
      if (!Number.isInteger(tab.id) || !isChatgptTab(tab.url)) continue;
      const epoch = documentEpoch(tab.id);
      const prior = pendingByTab.get(tab.id) || Promise.resolve();
      const job = prior.catch(() => {}).then(async () => {
        if (epoch !== documentEpoch(tab.id)) return;
        const live = await chrome.tabs.get(tab.id).catch(() => null);
        if (!isChatgptTab(live?.url)) return;
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['conversation-color.js', 'chat-color-title.js',
              'content-script.js']
          });
          if (epoch !== documentEpoch(tab.id)) return;
          const documentId = results?.[0]?.documentId || null;
          await chrome.storage.session.set({
            [injectedKey(tab.id)]: { documentId, build: INJECTION_BUILD }
          });
        } catch {
          // Discard inaccessible tabs without navigation/retry storms.
        }
      });
      pendingByTab.set(tab.id, job);
      await job;
      if (pendingByTab.get(tab.id) === job) pendingByTab.delete(tab.id);
    }
  })().catch(error => console.warn('ChatGPT Tab Signal: in-place upgrade failed', error));
});

chrome.tabs.onRemoved.addListener(tabId => {
  forgetColorForTab(tabId).catch(() => {});
  invalidateTab(tabId);
  documentEpochByTab.delete(tabId);
});

// No tabs.onUpdated listener: Chrome emits status:loading during a same-
// document History API URL promotion. Actual document changes are detected
// from webRequest.documentId on the next conversation POST.

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const match = /^chatgpt-prompt-bound:(\d+):/.exec(notificationId);
  if (!match) return;
  const tabId = Number(match[1]);
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (typeof tab.windowId === 'number') await chrome.windows.update(tab.windowId, { focused: true });
  } catch (error) {
    console.warn('Prompt-Bound Alert: source tab no longer exists', error);
  } finally {
    chrome.notifications.clear(notificationId).catch(() => {});
  }
});
