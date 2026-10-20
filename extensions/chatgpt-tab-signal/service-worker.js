'use strict';

const OFFSCREEN_DOCUMENT = 'offscreen.html';
// PNG adapted from the upstream AGPL-3.0 project's icon; embedded as a data URL
// so this no-build checkout remains entirely text-based.
const NOTIFICATION_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAADR0lEQVR4nO2dXXIiMQwGzdYeYS7B/Q/DcbJPVLEkBHuQ9fd1PxPiSG3J9jg1l+M4vgbI8id6ABALAoiDAOIggDgIIA4CiIMA4iCAOAggDgKIgwDiIIA4CCAOAoiDAOL8jR7AGGPcbrfoIYRwvV6jhzAuURdCVJP+iigZ3AUg8b/jLYKbACR+DS8RXBaBJH8dr5htrQAk3oad1WBbBSD5duyM5RYBSL49u2Ka4hxgjBx7Yk+yTBLzNcDKH6aW9FdExsy0BZD8c6zEwrpyuLcAEv8z97h4twazCjAzcJL/npkYWUrC00BxTARg9tviWQVcKgDJX6fVswDIy8cCZDnQUMQi9tsrAOX/PB6xS3MU7MW7WaMmrIQAK6Xy8bMKMrQW4NMeef/5ziK0FMB6YdpZhHbbwJ27ko47nlYCeCSomwRtBPBMTCcJWggQkZAuEpQXIDIRHSQovQs4m4BXq/kz33e73UrvDkoLsMq7REXdyomkbAtYvX+4MktXP19ZmJICeF0+VZCgpACzWPTmyv19hnICzM40y8TNflfFKlBOALClpQA7ynbXVlBKgAoltsIYHyklwAw7Z2rHKtBOAFgDAcQpI0Cl3lpprGUEmMGjR3dbB7QSANZBAHHSPg6u1Ed/4nn8WVsHFUCctBVghqhZ9fx7K1crKoA4CCAOAoiDAOIggDgIIA4CiIMA4iCAOAggDgKIgwDiIIA4CCAOAoiDAOKUvhBS+SJGFqgA4iCAOAggDgKIk3YRWP3mbdb/A3iGCiAOAoiDAOKkXQM8Y9FTebv5d6gA4iCAOAggDgKIIyXA7MJOZQE4hoMA2U7wZl8akQGP2H0sQKaAzfJqzNX+FovxljkHsKZasnfhsgbI1gYq4BUzEwFmZhMSzDMTK6sKJrULgO+YCUAVsMFz9o8RsAjs/Cr2T4iaHKYtQOE1azuIfEp5OY7jy/Qbx7nkqlWELDFKcw5ARYhhyy5AbTZ7sCum27aBSGDHzlhuWQM8Q3k/h8ckcjkIohqs4xUzlwrwCNXgd7wni7sAdxDhf6KqZJgAj6jKkKE1phAA4uBpoDgIIA4CiIMA4iCAOAggDgKIgwDiIIA4CCAOAoiDAOIggDgIIA4CiPMPMxH82wgo8LsAAAAASUVORK5CYII=';
const RESPONSE_PREVIEW_MAX_CHARS = 260;
const CHATGPT_REQUEST_FILTER = {
  urls: [
    'https://chatgpt.com/backend-api/f/conversation*',
    'https://chatgpt.com/backend-api/conversation*'
  ]
};

let creatingOffscreen = null;
const lastNotificationFingerprintByTab = new Map();
const GLOBAL_ENABLED_KEY = 'chatgptTabSignalGlobalEnabledV2';
const INJECTION_PREFIX = 'chatgptTabSignalInjected:';
const LEGACY_OPT_IN_KEY = 'chatgptTabSignalOptedInTab';
const pendingByTab = new Map();

function isChatgptTab(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'chatgpt.com';
  } catch {
    return false;
  }
}

function isPopupSender(sender) {
  return sender?.url === chrome.runtime.getURL('popup.html');
}

async function globallyEnabled() {
  return (await chrome.storage.local.get(GLOBAL_ENABLED_KEY))[GLOBAL_ENABLED_KEY] === true;
}

function injectedKey(tabId) {
  return INJECTION_PREFIX + String(tabId);
}

// One click enables every ChatGPT conversation; no tab is touched until it
// actually sends a matching conversation POST. Even then, at most one
// injection attempt is made per tab/document, persisted across MV3 sleep.
async function enableAll() {
  await chrome.storage.local.set({ [GLOBAL_ENABLED_KEY]: true });
  return { ok: true, enabled: true };
}

async function disableAll() {
  await chrome.storage.local.set({ [GLOBAL_ENABLED_KEY]: false });
  // Allow in-progress tab-message jobs to observe the disabled state before
  // revoking the injected document. Each job checks before its final send.
  const entries = await chrome.storage.session.get(null);
  const keys = Object.keys(entries).filter(k => k.startsWith(INJECTION_PREFIX));
  await chrome.storage.session.remove(keys);
  await Promise.allSettled(keys.map(async key => {
    const tabId = Number(key.slice(INJECTION_PREFIX.length));
    if (!Number.isInteger(tabId)) return;
    lastNotificationFingerprintByTab.delete(tabId);
    try { await chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_DISABLE_TAB' }); } catch {}
  }));
  return { ok: true, enabled: false };
}

// Existing per-tab permissions must never carry over from v0.1.7.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.remove(LEGACY_OPT_IN_KEY).catch(() => {});
});

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
  if (!result?.ok) throw new Error(result?.error || 'Offscreen audio did not confirm playback scheduling.');
}

function cleanSessionTitle(rawTitle) {
  const raw = String(rawTitle || '').replace(/\s+/g, ' ').trim().replace(/^[●◌•]\s+/, '');
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

async function emitBoth({ tabId = null, title = 'ChatGPT', message = 'Response finished.', isTest = false } = {}) {
  const id = isTest
    ? `chatgpt-prompt-bound-test:${Date.now()}`
    : `chatgpt-prompt-bound:${tabId}:${Date.now()}`;

  const [soundResult, notificationResult] = await Promise.allSettled([
    playCompletionSound(),
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: NOTIFICATION_ICON_DATA_URL,
      title: isTest ? 'Background alert test' : title,
      message,
      priority: 2,
      requireInteraction: false,
      silent: true
    })
  ]);

  if (soundResult.status === 'rejected') console.error('Prompt-Bound Alert: sound failed', soundResult.reason);
  if (notificationResult.status === 'rejected') console.error('Prompt-Bound Alert: notification failed', notificationResult.reason);
  // A partial success is not a successful two-channel test. Tell the popup
  // exactly which channel failed rather than claiming both are working.
  if (soundResult.status === 'rejected' || notificationResult.status === 'rejected') {
    const failures = [];
    if (soundResult.status === 'rejected') failures.push('Sound: ' + String(soundResult.reason));
    if (notificationResult.status === 'rejected') failures.push('Notification: ' + String(notificationResult.reason));
    throw new Error(failures.join('; '));
  }
  return id;
}

async function deliverToTab(tabId, message, mayInject = false) {
  if (!await globallyEnabled()) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!isChatgptTab(tab?.url) || !await globallyEnabled()) return;
  const key = injectedKey(tabId);
  // First prefer an already-running content script, which also handles
  // a previously disabled document without running executeScript again.
  try {
    if (mayInject) {
      await chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_ENABLE_TAB' });
    }
    if (!await globallyEnabled()) return;
    await chrome.tabs.sendMessage(tabId, message);
    return;
  } catch {
    if (!mayInject || !await globallyEnabled()) return;
  }

  const alreadyTried = (await chrome.storage.session.get(key))[key];
  if (alreadyTried) return;
  // Mark before awaiting injection. A failed/discarded tab cannot trigger
  // an injection storm on later network events.
  await chrome.storage.session.set({ [key]: true });
  if (!await globallyEnabled()) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js']
    });
    if (!await globallyEnabled()) {
      await chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_DISABLE_TAB' }).catch(() => {});
      return;
    }
    await chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_ENABLE_TAB' });
    if (!await globallyEnabled()) return;
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // No automatic retries on this document.
  }
}

function signalToChatTab(tabId, message) {
  // Sequencing prevents a fast POST completion from overtaking the initial
  // lazy injection. Different tabs are independent.
  const preceding = pendingByTab.get(tabId) || Promise.resolve();
  const job = preceding.catch(() => {}).then(() =>
    deliverToTab(tabId, message, message.type === 'CHATGPT_GENERATION_STARTED')
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
    requestId: String(details.requestId || '')
  }).catch(() => {});
}, CHATGPT_REQUEST_FILTER);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  if (!isAnswerStreamRequest(details)) return;
  signalToChatTab(details.tabId, {
    type: 'CHATGPT_GENERATION_ABORTED',
    requestId: String(details.requestId || '')
  }).catch(() => {});
}, CHATGPT_REQUEST_FILTER);

chrome.webRequest.onCompleted.addListener((details) => {
  if (!isAnswerStreamRequest(details)) return;
  if (details.statusCode < 200 || details.statusCode >= 300) {
    signalToChatTab(details.tabId, {
      type: 'CHATGPT_GENERATION_ABORTED',
      requestId: String(details.requestId || '')
    }).catch(() => {});
    return;
  }
  signalToChatTab(details.tabId, {
    type: 'CHATGPT_CONVERSATION_REQUEST_COMPLETED',
    requestId: String(details.requestId || '')
  }).catch(() => {});
}, CHATGPT_REQUEST_FILTER);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CHATGPT_GLOBAL_STATUS' ||
      message?.type === 'CHATGPT_GLOBAL_ENABLE' ||
      message?.type === 'CHATGPT_GLOBAL_DISABLE') {
    if (!isPopupSender(sender)) {
      sendResponse({ ok: false, error: 'Only the extension popup can change activation.' });
      return;
    }
    const task = message.type === 'CHATGPT_GLOBAL_STATUS'
      ? globallyEnabled().then(enabled => ({ok:true,enabled}))
      : message.type === 'CHATGPT_GLOBAL_ENABLE' ? enableAll() : disableAll();
    task.then(sendResponse).catch(error => sendResponse({
      ok: false, error: String(error?.message || error)
    }));
    return true;
  }

  if (message?.type === 'CHATGPT_RESPONSE_COMPLETE') {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || !isChatgptTab(sender.url)) return;
    (async () => {
      if (!await globallyEnabled()) return;
      const requestId = String(message.requestId || '');
      if (!requestId) return;
      if (lastNotificationFingerprintByTab.get(tabId) === requestId) return;
      lastNotificationFingerprintByTab.set(tabId, requestId);
      if (!await globallyEnabled()) return;
      await emitBoth({
        tabId,
        title: cleanSessionTitle(message.sessionTitle),
        message: truncateResponse(message.response)
      });
    })().catch(error => console.error('ChatGPT Tab Signal: completion alert failed', error));
    return;
  }

  if (message?.type === 'TEST_UNREAD_TAB' || message?.type === 'TEST_BOTH') {
    if (!isPopupSender(sender)) {
      sendResponse({ ok: false, error: 'Test controls are popup-only.' });
      return;
    }
  }

  if (message?.type === 'TEST_UNREAD_TAB') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !isChatgptTab(tab.url) || !await globallyEnabled()) {
        throw new Error('Enable ChatGPT Tab Signal globally, then send a message in this tab.');
      }
      await chrome.tabs.sendMessage(tab.id, { type: 'CHATGPT_PREVIEW_UNREAD' });
      return { ok: true };
    })().then(sendResponse).catch(error =>
      sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'TEST_BOTH') {
    emitBoth({
      isTest: true,
      message: 'If you heard the chime and saw this notification, both output channels work.'
    }).then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  lastNotificationFingerprintByTab.delete(tabId);
  pendingByTab.delete(tabId);
  chrome.storage.session.remove(injectedKey(tabId)).catch(() => {});
});

// Replacing the document clears its injection attempt record. We do NOT
// inject at navigation, reload, tab creation, extension installation, or
// extension enablement: a new POST is the only activation trigger.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    lastNotificationFingerprintByTab.delete(tabId);
    chrome.storage.session.remove(injectedKey(tabId)).catch(() => {});
  }
});

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
