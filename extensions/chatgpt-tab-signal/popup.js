'use strict';

const button = document.getElementById('test');
const status = document.getElementById('status');

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Dispatching both channels...';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'TEST_BOTH' });
    if (!result?.ok) throw new Error(result?.error || 'Unknown error');
    status.textContent = 'Sound + desktop notification dispatched.';
  } catch (error) {
    status.textContent = `Test failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

const unreadButton = document.getElementById('test-unread');
unreadButton.addEventListener('click', async () => {
  unreadButton.disabled = true;
  status.textContent = 'Previewing the unread state...';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'TEST_UNREAD_TAB' });
    if (!result?.ok) throw new Error(result?.error || 'Unknown error');
    status.textContent = 'Blue unread favicon applied. Click inside ChatGPT to mark it viewed (green).';
  } catch (error) {
    status.textContent = 'Preview failed: ' + error.message;
  } finally {
    unreadButton.disabled = false;
  }
});
