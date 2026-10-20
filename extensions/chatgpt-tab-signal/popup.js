'use strict';

const toggle = document.getElementById('toggle');
const test = document.getElementById('test');
const unread = document.getElementById('test-unread');
const status = document.getElementById('status');
let enabled = false;

function updateButtons() {
  toggle.disabled = false;
  toggle.textContent = enabled ? 'Disable this tab' : 'Enable only this tab';
  test.disabled = !enabled;
  unread.disabled = !enabled;
}

async function command(type) {
  const result = await chrome.runtime.sendMessage({ type });
  if (!result?.ok) throw new Error(result?.error || 'Extension command failed.');
  return result;
}

async function refresh() {
  try {
    const state = await command('CHATGPT_TAB_STATUS');
    enabled = !!state.enabled;
    updateButtons();
    if (state.anotherEnabled) {
      toggle.disabled = true;
      status.textContent = 'Another tab is selected. Disable it there first.';
    } else {
      status.textContent = enabled ? 'Only this tab is enabled.' : 'This tab is off. Other tabs are untouched.';
    }
  } catch (error) {
    toggle.disabled = true;
    test.disabled = true;
    unread.disabled = true;
    status.textContent = String(error.message || error);
  }
}
toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  try {
    const state = await command(enabled ? 'CHATGPT_DISABLE_ACTIVE_TAB' : 'CHATGPT_ENABLE_ACTIVE_TAB');
    enabled = !!state.enabled;
    updateButtons();
    status.textContent = enabled ? 'Enabled for this tab only.' : 'Disabled. All tabs are off.';
  } catch (error) {
    status.textContent = String(error.message || error);
    await refresh();
  } finally {
    if (enabled || !toggle.disabled) toggle.disabled = false;
  }
});
test.addEventListener('click', async () => {
  test.disabled = true;
  try {
    await command('TEST_BOTH');
    status.textContent = 'Sound and desktop notification dispatched.';
  } catch (error) {
    status.textContent = String(error.message || error);
  } finally {
    test.disabled = !enabled;
  }
});
unread.addEventListener('click', async () => {
  unread.disabled = true;
  try {
    await command('TEST_UNREAD_TAB');
    status.textContent = 'Blue unread favicon applied to this tab only.';
  } catch (error) {
    status.textContent = String(error.message || error);
  } finally {
    unread.disabled = !enabled;
  }
});
refresh();
