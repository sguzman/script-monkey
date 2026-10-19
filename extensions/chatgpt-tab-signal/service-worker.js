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
const pageReturnDismissByTab = new Map();

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
  const raw = String(rawTitle || '').replace(/\s+/g, ' ').trim();
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
      contextMessage: isTest
        ? 'Sound + desktop notification dispatched by the extension'
        : 'Click to return to the completed ChatGPT tab',
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

function cancelPageReturnDismiss(tabId) {
  if (typeof tabId !== 'number') return;
  const record = pageReturnDismissByTab.get(tabId);
  if (!record) return;
  if (record.autoCloseId !== null) clearTimeout(record.autoCloseId);
  pageReturnDismissByTab.delete(tabId);
}

function schedulePageReturnDismiss(tabId) {
  if (typeof tabId !== 'number') return;
  cancelPageReturnDismiss(tabId);
  const record = {
    notificationId: '',
    returnDismissArmedAt: Date.now() + 500,
    autoCloseId: setTimeout(() => {
      pageReturnDismissByTab.delete(tabId);
    }, 8500)
  };
  pageReturnDismissByTab.set(tabId, record);
  return record;
}

async function signalToChatTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return;
  } catch {}

  // Handles tabs that were already open when the unpacked extension was
  // reloaded. The content script has an install guard, so reinjection is safe.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js']
    });
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn('Prompt-Bound Alert: could not arm tab completion watcher', error);
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
  if (message?.type === 'CHATGPT_RESPONSE_COMPLETE') {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') return;

    const fingerprint = String(message.fingerprint || '');
    // Regenerating an answer can reuse the same assistant element. The
    // network request ID identifies each attempt, avoiding false deduplication.
    const requestId = String(message.requestId || '');
    const completionKey = String(message.completionKey || fingerprint);
    const dedupKey = requestId ? requestId + '|' + completionKey : completionKey;
    if (dedupKey && lastNotificationFingerprintByTab.get(tabId) === dedupKey) return;
    if (dedupKey) lastNotificationFingerprintByTab.set(tabId, dedupKey);

    const pageReturnRecord = message.dismissOnReturn ? schedulePageReturnDismiss(tabId) : null;
    emitBoth({
      tabId,
      title: cleanSessionTitle(message.sessionTitle),
      message: truncateResponse(message.response)
    }).then((notificationId) => {
      if (pageReturnRecord) pageReturnRecord.notificationId = String(notificationId || '');
    }).catch((error) => {
      if (pageReturnRecord) cancelPageReturnDismiss(tabId);
      console.error('Prompt-Bound Alert: completion alert failed', error);
    });
    return;
  }

  if (message?.type === 'CHATGPT_PAGE_RETURNED') {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') return;
    const record = pageReturnDismissByTab.get(tabId);
    if (!record) return;
    if (Date.now() < record.returnDismissArmedAt) return;
    cancelPageReturnDismiss(tabId);
    if (record.notificationId) {
      chrome.notifications.clear(record.notificationId).catch(() => {});
    }
    return;
  }

  if (message?.type === 'TEST_UNREAD_TAB') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url?.startsWith('https://chatgpt.com/')) {
        throw new Error('Switch to a chatgpt.com tab before testing the marker.');
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
  cancelPageReturnDismiss(tabId);
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
