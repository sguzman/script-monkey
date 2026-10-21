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
const CHATGPT_REQUEST_FILTER = {
  urls: [
    'https://chatgpt.com/backend-api/f/conversation*',
    'https://chatgpt.com/backend-api/conversation*'
  ]
};

let creatingOffscreen = null;
const lastNotificationFingerprintByTab = new Map();
// The extension never injects on installation, navigation, or idle tabs.
// A matching outbound ChatGPT conversation POST is the ONLY activation event.
const INJECTION_PREFIX = 'chatgptTabSignalInjected:';
const pendingByTab = new Map();
const documentEpochByTab = new Map();

// A single serialized storage transaction allocates only for the requesting
// chat. No tab enumeration, polling, broadcast, or mass recoloring occurs.
function withColorAllocation(fn) {
  const job = pendingColorAllocation.catch(() => {}).then(fn);
  pendingColorAllocation = job.catch(() => {});
  return job;
}

function assignedColorForTab(tabId) {
  return withColorAllocation(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!isChatgptTab(tab?.url)) return null;
    const api = globalThis.ChatGPTConversationColor;
    const identity = api?.fromUrl(tab.url);
    if (!identity) return null;
    const stored = (await chrome.storage.session.get(COLOR_ALLOCATION_KEY))[COLOR_ALLOCATION_KEY] || {};
    const tabKey = String(tabId);
    if (stored[tabKey]?.key === identity.key) return stored[tabKey];
    delete stored[tabKey];

    // Multiple tabs displaying the same chat share one assigned identity.
    const match = Object.values(stored).find(item => item?.key === identity.key);
    const result = match || api.assignFromUrl(tab.url,
      [...new Set(Object.values(stored).filter(item => item?.key !== identity.key)
        .map(item => item?.hex).filter(Boolean))].slice(0, 40));
    if (!result || !/^#[0-9a-f]{6}$/.test(result.hex)) return null;
    const assigned = { key: identity.key, kind: identity.kind, hex: result.hex };
    stored[tabKey] = assigned;
    await chrome.storage.session.set({ [COLOR_ALLOCATION_KEY]: stored });
    return assigned;
  });
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
  const raw = String(rawTitle || '').replace(/\s+/g, ' ').trim().replace(/^(?:(?:⏳|🔔|✅|⚠️|🛑|🟥|🟧|🟨|🟩|🟦|🟪|🔴|🟠|🟡|🟢|🔵|🟣|●|◌|•)\s+)+/u, '');
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
      await chrome.storage.session.set({ [key]: { documentId: docId } });
    }
    return;
  } catch {
    if (!mayInject || epoch !== documentEpoch(tabId)) return;
  }

  if (previous && previous.documentId === docId) return;
  // The same physical document receives one attempt, even if injection
  // fails. A *different* documentId permits a new attempt after reload.
  await chrome.storage.session.set({ [key]: { documentId: docId } });
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
  signalToChatTab(details.tabId, {
    type: 'CHATGPT_GENERATION_STARTED',
    requestId: String(details.requestId || ''),
    documentId: details.documentId || null
  }).catch(() => {});
}, CHATGPT_REQUEST_FILTER);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  if (!isAnswerStreamRequest(details)) return;
  signalToChatTab(details.tabId, {
    type: 'CHATGPT_GENERATION_ABORTED',
    requestId: String(details.requestId || ''),
    documentId: details.documentId || null
  }).catch(() => {});
}, CHATGPT_REQUEST_FILTER);

chrome.webRequest.onCompleted.addListener((details) => {
  if (!isAnswerStreamRequest(details)) return;
  if (details.statusCode < 200 || details.statusCode >= 300) {
    signalToChatTab(details.tabId, {
      type: 'CHATGPT_CONVERSATION_REQUEST_FAILED',
      requestId: String(details.requestId || ''),
      documentId: details.documentId || null,
      statusCode: details.statusCode
    }).catch(() => {});
    return;
  }
  signalToChatTab(details.tabId, {
    type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED',
    requestId: String(details.requestId || ''),
    documentId: details.documentId || null
  }).catch(() => {});
}, CHATGPT_REQUEST_FILTER);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    if (lastNotificationFingerprintByTab.get(tabId) === requestId) return;
    lastNotificationFingerprintByTab.set(tabId, requestId);
    await emitBoth({
      tabId,
      title: cleanSessionTitle(message.sessionTitle),
      message: 'Response finished.',
      iconUrl: message.notificationIcon
    });
  })().catch(error => console.error('ChatGPT Tab Signal: completion alert failed', error));

});

function invalidateTab(tabId) {
  documentEpochByTab.set(tabId, documentEpoch(tabId) + 1);
  lastNotificationFingerprintByTab.delete(tabId);
  pendingByTab.delete(tabId);
  chrome.storage.session.remove(injectedKey(tabId)).catch(() => {});
}

// On installation/update, color existing conversation tabs once without
// reloading them. Only the lightweight title decorator is injected here;
// the notification/favicons script remains POST-driven and never injected
// by tab enumeration. No recurring tab scan or background timer.
chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    const tabs = await chrome.tabs.query({
      url: ['https://chatgpt.com/c/*', 'https://chatgpt.com/g/*/c/*']
    });
    for (const tab of tabs.slice(0, 40)) {
      if (!Number.isInteger(tab.id) || !isChatgptTab(tab.url)) continue;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['conversation-color.js', 'chat-color-title.js']
      }).catch(() => {});
    }
  })().catch(error => console.warn('ChatGPT Tab Signal: one-time color setup failed', error));
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
