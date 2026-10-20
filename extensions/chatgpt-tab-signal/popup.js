'use strict';
const toggle = document.getElementById('toggle');
const status = document.getElementById('status');
let enabled = false;
async function request(type) {
  const result = await chrome.runtime.sendMessage({ type });
  if (!result?.ok) throw new Error(result?.error || 'Extension request failed.');
  return result;
}
function showState() {
  toggle.disabled = false;
  toggle.textContent = enabled ? 'Turn off for all tabs' : 'Turn on for all ChatGPT tabs';
  status.textContent = enabled
    ? 'On. Works automatically when you send a ChatGPT message.'
    : 'Off. All ChatGPT tabs are untouched.';
}
async function refresh() {
  try {
    enabled = !!(await request('CHATGPT_GLOBAL_STATUS')).enabled;
    showState();
  } catch (error) {
    toggle.disabled = true;
    status.textContent = String(error.message || error);
  }
}
toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  try {
    enabled = !!(await request(enabled
      ? 'CHATGPT_GLOBAL_DISABLE' : 'CHATGPT_GLOBAL_ENABLE')).enabled;
    showState();
  } catch (error) {
    status.textContent = String(error.message || error);
    await refresh();
  }
});
refresh();
