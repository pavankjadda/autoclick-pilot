// Service worker: keeps content-script registration and host permissions in step with the
// saved rules, serves matching rules to pages, and shows a per-tab click count on the badge.

import { buildSelector, matchesUrl, siteCovers, toMatchPatterns } from './shared/rules.js';
import { getRules, isRuleKey } from './shared/storage.js';

const SCRIPT_ID = 'autoclick-pilot';

// Run tasks one at a time so overlapping events can't race each other. A failed task is logged
// and doesn't stop the ones queued after it.
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch((error) => console.error('AutoClick Pilot:', error.message));
}

// One action often fires several events (a rule write plus permissions.onAdded), so coalesce syncs
// that are queued but haven't started yet.
let syncQueued = false;
function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  enqueue(() => {
    syncQueued = false;
    return syncRegistration();
  });
}

function safePatterns(site) {
  try {
    return toMatchPatterns(site);
  } catch {
    return [];
  }
}

/** Register the content script for exactly the granted sites that have an enabled rule. */
async function syncRegistration() {
  const [rules, [existing]] = await Promise.all([
    getRules(),
    chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }),
  ]);
  const wanted = [...new Set(rules.filter((rule) => rule.enabled).flatMap((rule) => safePatterns(rule.site)))];
  const granted = await Promise.all(wanted.map((pattern) => chrome.permissions.contains({ origins: [pattern] })));
  const matches = wanted.filter((_, i) => granted[i]).sort();

  if (!matches.length) {
    if (existing) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } else if (!existing) {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        js: ['src/content.js'],
        matches,
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
  } else if ([...existing.matches].sort().join() !== matches.join()) {
    // Update in place: unregister + register would leave a gap where pages load without the script.
    await chrome.scripting.updateContentScripts([{ id: SCRIPT_ID, matches }]);
  }
}

/**
 * Least privilege: revoke host access that only the given (deleted or re-pointed) sites used.
 * Leaves alone access that still covers a remaining rule, and grants the user made themselves.
 */
async function pruneAccess(oldSites) {
  const [rules, { origins: granted = [] }] = await Promise.all([getRules(), chrome.permissions.getAll()]);
  const unusedSites = oldSites.filter((site) => !rules.some((rule) => siteCovers(site, rule.site)));
  const unused = [...new Set(unusedSites.flatMap(safePatterns))].filter((pattern) => granted.includes(pattern));
  if (unused.length) await chrome.permissions.remove({ origins: unused });
}

/** Runs in the page's main world (serialized by executeScript, so it must be self-contained). */
function clickMarkedElement(attr, mark) {
  const el = document.querySelector(`[${attr}="${CSS.escape(mark)}"]`);
  if (!el) return;
  el.removeAttribute(attr);
  if (el instanceof HTMLElement) el.click();
  else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
}

async function rulesForUrl(url) {
  const rules = await getRules();
  return rules
    .filter((rule) => rule.enabled && matchesUrl(rule.site, url))
    .flatMap((rule) => {
      try {
        const selector = buildSelector(rule.selectorType, rule.selector);
        return [{ selector, delayMs: rule.delayMs, timeoutMs: rule.timeoutMs }];
      } catch {
        return []; // a malformed stored rule shouldn't stop the others
      }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || typeof message?.type !== 'string') return false;

  if (message.type === 'acp:getRules' && sender.url) {
    rulesForUrl(sender.url).then(sendResponse, () => sendResponse([]));
    return true; // async response
  }

  if (message.type === 'acp:click' && sender.tab?.id != null && sender.documentId) {
    chrome.scripting
      .executeScript({
        target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
        world: 'MAIN',
        func: clickMarkedElement,
        args: [String(message.attr), String(message.mark)],
      })
      .then(() => sendResponse(true), () => sendResponse(false));
    return true; // async response
  }

  if (message.type === 'acp:clicked' && sender.tab?.id != null) {
    const count = Number(message.count) || 0;
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: count > 0 ? String(count) : '' }).catch(() => {});
  }
  return false;
});

// Clear a tab's badge when it starts loading a new page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const ruleChanges = Object.entries(changes)
    .filter(([key]) => isRuleKey(key))
    .map(([, change]) => change);
  if (!ruleChanges.length) return;

  // Sites a rule no longer uses: it was deleted, or an edit or import moved it to another site.
  const oldSites = ruleChanges
    .filter(({ oldValue, newValue }) => oldValue?.site && oldValue.site !== newValue?.site)
    .map(({ oldValue }) => oldValue.site);
  if (oldSites.length) enqueue(() => pruneAccess(oldSites));
  scheduleSync();
});
chrome.permissions.onAdded.addListener(scheduleSync);
chrome.permissions.onRemoved.addListener(scheduleSync);

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  chrome.action.setBadgeTextColor({ color: '#ffffff' });
  scheduleSync();
});
chrome.runtime.onStartup.addListener(scheduleSync);
