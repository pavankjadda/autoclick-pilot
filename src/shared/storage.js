// Rule persistence in chrome.storage.sync.
// One key per rule ("rule:<id>") so we stay well under the 8 KB per-item sync quota.

import { normalizeRule } from './rules.js';

const PREFIX = 'rule:';
const keyFor = (id) => `${PREFIX}${id}`;

export function isRuleKey(key) {
  return key.startsWith(PREFIX);
}

export async function getRules() {
  const all = await chrome.storage.sync.get(null);
  return Object.entries(all)
    .filter(([key, rule]) => isRuleKey(key) && rule && typeof rule === 'object')
    .map(([, rule]) => rule)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveRule(input) {
  const rule = normalizeRule(input);
  await chrome.storage.sync.set({ [keyFor(rule.id)]: rule });
  return rule;
}

export async function updateRule(id, patch) {
  const key = keyFor(id);
  const { [key]: existing } = await chrome.storage.sync.get(key);
  if (!existing) throw new Error('Rule no longer exists');
  return saveRule({ ...existing, ...patch, id });
}

export async function deleteRule(id) {
  await chrome.storage.sync.remove(keyFor(id));
}

export async function exportRules() {
  const rules = await getRules();
  return JSON.stringify({ app: 'autoclick-pilot', version: 1, rules }, null, 2);
}

/**
 * Import rules from exported JSON. Rules with an existing id are replaced.
 * @returns {{ imported: number, skipped: number }}
 */
export async function importRules(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('File is not valid JSON');
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.rules;
  if (!Array.isArray(list)) throw new Error('No rules found in file');

  const items = {};
  let skipped = 0;
  for (const raw of list) {
    try {
      const rule = normalizeRule(raw);
      items[keyFor(rule.id)] = rule;
    } catch {
      skipped++;
    }
  }
  if (Object.keys(items).length) await chrome.storage.sync.set(items);
  return { imported: Object.keys(items).length, skipped };
}
