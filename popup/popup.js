import { mountRulesUI } from '../src/ui/rules-ui.js';

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// activeTab grants the current tab's URL while the popup is open.
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
mountRulesUI(document.getElementById('app'), { currentUrl: tab?.url ?? '', variant: 'popup' });
