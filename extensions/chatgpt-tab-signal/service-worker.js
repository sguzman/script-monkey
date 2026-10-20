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
const OPT_IN_KEY = 'chatgptTabSignalOptedInTab';
const OPT_IN_VERSION = '0.1.7';

// Session storage survives MV3 worker suspension but never represents a
// permanent permission. There can be at most ONE selected tab.
// No tabs are enabled by installing or starting this extension.
async function selectedTabId() {
  const record = (await chrome.storage.session.get(OPT_IN_KEY))[OPT_IN_KEY];
  return record?.version === OPT_IN_VERSION && Number.isInteger(record.tabId)
    ? record.tabId : null;
}

async function clearSelection(tabId) {
  if (await selectedTabId() !== tabId) return;
  await chrome.storage.session.remove(OPT_IN_KEY);
  lastNotificationFingerprintByTab.delete(tabId);
}

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

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id) || !isChatgptTab(tab.url)) {
    throw new Error('Open a ChatGPT tab before enabling this extension.');
  }
  return tab;
}

async function enableActiveTab() {
  const tab = await activeTab();
  const currentId = await selectedTabId();
  if (currentId !== null && currentId !== tab.id) {
    throw new Error('Another tab is enabled. Disable it there before selecting a new one.');
  }
  // Dynamic injection happens ONLY after the popup's explicit button click.
  // Never inject in webRequest event handling or extension startup.
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content-script.js']
  });
  await chrome.tabs.sendMessage(tab.id, { type: 'CHATGPT_ENABLE_TAB' });
  await chrome.storage.session.set({
    [OPT_IN_KEY]: { version: OPT_IN_VERSION, tabId: tab.id }
  });
  return { ok: true, enabled: true, tabId: tab.id };
}

async function disableActiveTab() {
  const tab = await activeTab();
  if (await selectedTabId() !== tab.id) {
    return { ok: true, enabled: false, tabId: tab.id };
  }
  // Revoke before contacting the page. Message delivery may fail on a
  // discarded or crashed renderer; this must not keep the tab enabled.
  await clearSelection(tab.id);
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'CHATGPT_DISABLE_TAB' });
  } catch {}
  return { ok: true, enabled: false, tabId: tab.id };
}

async function activeTabStatus() {
  const tab = await activeTab();
  const selected = await selectedTabId();
  return { ok: true, enabled: selected === tab.id, tabId: tab.id,
    anotherEnabled: selected !== null && selected !== tab.id };
}

// Never silently carry opt-in forward to an updated or reinstalled build.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.remove(OPT_IN_KEY).catch(() => {});
});

function normalizePathname(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function isAnswerStreamRequest(details) {
  if (details.tabId < 0 || details.method !== 'POST') return false;
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

async function signalToChatTab(tabId, message) {
  if (await selectedTabId() !== tabId) return;
  // No executeScript/reinjection from network events, even on failure.
  // If the opted-in document navigated or crashed, fail closed.
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await clearSelection(tabId);
  }
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
  // Only the extension's popup can opt a tab in or out. A content script
  // cannot activate itself or activate another tab.
  if (message?.type === 'CHATGPT_TAB_STATUS' ||
      message?.type === 'CHATGPT_ENABLE_ACTIVE_TAB' ||
      message?.type === 'CHATGPT_DISABLE_ACTIVE_TAB') {
    if (!isPopupSender(sender)) {
      sendResponse({ ok: false, error: 'Only the extension popup can change tab activation.' });
      return;
    }
    const task = message.type === 'CHATGPT_TAB_STATUS'
      ? activeTabStatus()
      : message.type === 'CHATGPT_ENABLE_ACTIVE_TAB'
        ? enableActiveTab() : disableActiveTab();
    task.then(sendResponse).catch((error) => sendResponse({
      ok: false, error: String(error?.message || error)
    }));
    return true;
  }

  if (message?.type === 'CHATGPT_RESPONSE_COMPLETE') {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || !isChatgptTab(sender.url)) return;
    (async () => {
      if (await selectedTabId() !== tabId) return;
      const requestId = String(message.requestId || '');
      if (!requestId) return;
      if (lastNotificationFingerprintByTab.get(tabId) === requestId) return;
      lastNotificationFingerprintByTab.set(tabId, requestId);
      await emitBoth({
        tabId,
        title: cleanSessionTitle(message.sessionTitle),
        message: truncateResponse(message.response)
      });
    })().catch((error) => {
      console.error('ChatGPT Tab Signal: completion alert failed', error);
    });
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
      if (!tab?.id || !isChatgptTab(tab.url) ||
          await selectedTabId() !== tab.id) {
        throw new Error('Enable this ChatGPT tab before previewing the indicator.');
      }
      await chrome.tabs.sendMessage(tab.id, { type: 'CHATGPT_PREVIEW_UNREAD' });
      return { ok: true };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error.message || error) }));
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

chrome.tabs.onRemoved.addListener((tabId) => {
  lastNotificationFingerprintByTab.delete(tabId);
  clearSelection(tabId).catch(() => {});
});

// Opt-in belongs to the current document. A reload or navigation must not
// silently activate the extension on the replacement page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    clearSelection(tabId).catch(() => {});
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
