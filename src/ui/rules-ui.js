// Shared settings UI: "add rule" form + grouped rule list. Used by the popup and the options page.
// All user-provided text is rendered with textContent — never innerHTML.

import { DEFAULTS, LIMITS, SELECTOR_TYPES, matchesUrl, normalizeRule, suggestSiteFromUrl, toMatchPatterns } from '../shared/rules.js';
import { deleteRule, getRules, isRuleKey, saveRule, updateRule } from '../shared/storage.js';

const PLACEHOLDERS = {
  css: 'button.accept-all',
  id: 'accept-button',
  name: 'submit',
  aria: 'Accept all cookies',
};

const HINTS = {
  css: 'Any CSS selector: .class-name, #id, button[type=submit]… The first visible match is clicked.',
  id: 'The element id, without the leading #.',
  name: 'Value of the name="…" attribute (forms, inputs, buttons).',
  aria: 'Exact value of the aria-label="…" attribute.',
};

// Static, trusted SVG markup only.
const ICONS = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  cursor:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 7-6 2-2 6z"/><path d="M13 13l5 5"/></svg>',
};

/** Tiny element builder. Children may be nodes or strings (rendered as text). */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (typeof value === 'function') el.addEventListener(key.replace(/^on/, ''), value);
    else if (key === 'icon') el.insertAdjacentHTML('afterbegin', ICONS[value]);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Must be called synchronously from a user gesture (click/submit) or Chrome rejects it. */
const requestAccess = (site) => chrome.permissions.request({ origins: toMatchPatterns(site) });

async function hasAccess(site) {
  try {
    return await chrome.permissions.contains({ origins: toMatchPatterns(site) });
  } catch {
    return false;
  }
}

/**
 * @param {HTMLElement} root
 * @param {{ currentUrl?: string, variant?: 'popup' | 'page' }} options
 */
export function mountRulesUI(root, { currentUrl = '', variant = 'page' } = {}) {
  root.classList.add('acp', `acp--${variant}`);

  // ---------- Add form ----------
  const typeName = `acp-type-${Math.random().toString(36).slice(2)}`;
  const siteInput = h('input', {
    id: 'acp-site',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'example.com or example.com/login',
    value: suggestSiteFromUrl(currentUrl),
  });
  const selectorInput = h('input', {
    id: 'acp-selector',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    class: 'mono',
    maxlength: String(LIMITS.selectorMaxLength),
  });
  const labelInput = h('input', {
    id: 'acp-label',
    type: 'text',
    placeholder: 'e.g. Dismiss cookie banner',
    maxlength: String(LIMITS.labelMaxLength),
  });
  const delayInput = h('input', {
    id: 'acp-delay',
    type: 'number',
    min: '0',
    max: String(LIMITS.delayMaxMs / 1000),
    step: '0.1',
    value: String(DEFAULTS.delayMs / 1000),
  });
  const timeoutInput = h('input', {
    id: 'acp-timeout',
    type: 'number',
    min: String(LIMITS.timeoutMinMs / 1000),
    max: String(LIMITS.timeoutMaxMs / 1000),
    step: '1',
    value: String(DEFAULTS.timeoutMs / 1000),
  });
  const selectorHint = h('p', { class: 'hint', id: 'acp-selector-hint' });
  const formMessage = h('p', { class: 'form-message', role: 'status', 'aria-live': 'polite' });
  const formTitle = h('span', {}, 'Add a click rule');
  const submitLabel = h('span', {}, 'Add rule');
  const submitButton = h('button', { type: 'submit', class: 'btn btn-primary', icon: 'plus' }, submitLabel);
  const cancelButton = h('button', { type: 'button', class: 'btn btn-secondary', hidden: true, onclick: () => stopEditing() }, 'Cancel');
  let editingId = null; // id of the rule loaded into the form for editing, or null when adding

  const segmented = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': 'Find element by' },
    Object.entries(SELECTOR_TYPES).map(([value, label], index) =>
      h(
        'label',
        { class: 'segment' },
        h('input', { type: 'radio', name: typeName, value, checked: index === 0, onchange: updateTypeHints }),
        h('span', {}, label),
      ),
    ),
  );

  function selectedType() {
    return segmented.querySelector('input:checked')?.value ?? 'css';
  }

  function updateTypeHints() {
    const type = selectedType();
    selectorInput.placeholder = PLACEHOLDERS[type];
    selectorHint.textContent = HINTS[type];
    selectorLabel.textContent = type === 'css' ? 'CSS selector' : SELECTOR_TYPES[type];
  }

  function setMessage(text, tone = 'error') {
    formMessage.textContent = text;
    formMessage.dataset.tone = tone;
  }

  const selectorLabel = h('label', { for: 'acp-selector' });

  const form = h(
    'form',
    {
      class: 'card add-form',
      novalidate: true,
      onsubmit: onSubmit,
      oninput: () => setMessage(''),
      onkeydown: (event) => event.key === 'Escape' && editingId && (event.preventDefault(), stopEditing()),
    },
    h('h2', { class: 'card-title' }, h('span', { class: 'title-icon', icon: 'cursor' }), formTitle),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'acp-site' }, 'Site'),
      siteInput,
      h('p', { class: 'hint' }, 'Includes subdomains. Add a path such as /login to narrow it.'),
    ),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Find element by'), segmented),
    h('div', { class: 'field' }, selectorLabel, selectorInput, selectorHint),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'acp-label' }, 'Nickname ', h('span', { class: 'optional' }, '(optional)')),
      labelInput,
    ),
    h(
      'details',
      { class: 'advanced' },
      h('summary', {}, 'Timing'),
      h(
        'div',
        { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: 'acp-delay' }, 'Delay before click (s)'), delayInput),
        h('div', { class: 'field' }, h('label', { for: 'acp-timeout' }, 'Give up after (s)'), timeoutInput),
      ),
    ),
    h('div', { class: 'form-actions' }, formMessage, cancelButton, submitButton),
  );
  updateTypeHints();

  // h() sets string values as attributes, so each input's defaultValue is its initial value.
  const resetInputs = (...inputs) => inputs.forEach((input) => (input.value = input.defaultValue));

  /** Load a rule into the form; saving then updates it in place. */
  function startEditing(rule) {
    editingId = rule.id;
    siteInput.value = rule.site;
    segmented.querySelector(`input[value="${rule.selectorType}"]`).checked = true;
    updateTypeHints();
    selectorInput.value = rule.selector;
    labelInput.value = rule.label;
    delayInput.value = String(rule.delayMs / 1000);
    timeoutInput.value = String(rule.timeoutMs / 1000);
    form.querySelector('details.advanced').open = rule.delayMs !== DEFAULTS.delayMs || rule.timeoutMs !== DEFAULTS.timeoutMs;
    formTitle.textContent = 'Edit rule';
    submitLabel.textContent = 'Save changes';
    submitButton.querySelector('svg').toggleAttribute('hidden', true); // no "+" when saving an edit
    cancelButton.hidden = false;
    setMessage('');
    render();
    form.scrollIntoView({ block: 'start', behavior: 'smooth' });
    selectorInput.focus({ preventScroll: true });
  }

  /** Back to "add" mode with an empty form. */
  function stopEditing() {
    editingId = null;
    resetInputs(siteInput, selectorInput, labelInput, delayInput, timeoutInput);
    formTitle.textContent = 'Add a click rule';
    submitLabel.textContent = 'Add rule';
    submitButton.querySelector('svg').toggleAttribute('hidden', false);
    cancelButton.hidden = true;
    render();
  }

  function onSubmit(event) {
    event.preventDefault();
    setMessage('');

    const fields = {
      site: siteInput.value,
      selectorType: selectedType(),
      selector: selectorInput.value,
      label: labelInput.value,
      // Empty fields give NaN, which normalizeRule replaces with the defaults.
      delayMs: Math.round(delayInput.valueAsNumber * 1000),
      timeoutMs: Math.round(timeoutInput.valueAsNumber * 1000),
    };
    let rule;
    try {
      rule = normalizeRule(fields);
    } catch (error) {
      setMessage(error.message);
      (/site|host/i.test(error.message) ? siteInput : selectorInput).focus();
      return;
    }

    // permissions.request must be the first async call so it still counts as a user gesture.
    // The rule is saved in parallel so it survives even if the permission prompt closes the popup.
    // Editing keeps the rule's id, enabled state and position; an already-granted site doesn't prompt.
    const permission = requestAccess(rule.site);
    const editing = editingId;
    const saved = editing ? updateRule(editing, fields) : saveRule(rule);
    submitButton.disabled = true;

    Promise.allSettled([permission, saved])
      .then(([permissionResult, saveResult]) => {
        if (saveResult.status === 'rejected') {
          setMessage(`Could not save: ${saveResult.reason?.message ?? 'unknown error'}`);
          return;
        }
        if (editing) {
          stopEditing();
        } else {
          resetInputs(selectorInput, labelInput, delayInput, timeoutInput); // keep the site for the next rule
        }
        if (permissionResult.status === 'fulfilled' && permissionResult.value) {
          setMessage(`Rule ${editing ? 'updated' : 'added'}. It runs on the next page load.`, 'success');
        } else {
          setMessage(`Rule saved, but access to ${rule.site} was not granted. Use "Grant access" below.`, 'warn');
        }
        selectorInput.focus();
      })
      .finally(() => {
        submitButton.disabled = false;
      });
  }

  // ---------- Rule list ----------
  const countBadge = h('span', { class: 'count' }, '0');
  const listBody = h('div', { class: 'rule-groups' });
  const listCard = h(
    'section',
    { class: 'card rule-list', 'aria-labelledby': 'acp-rules-title' },
    h('h2', { class: 'card-title', id: 'acp-rules-title' }, 'Your rules', countBadge),
    listBody,
  );

  let renderToken = 0;

  async function render() {
    const token = ++renderToken;
    const rules = await getRules();
    const groups = new Map();
    for (const rule of rules) {
      if (!groups.has(rule.site)) groups.set(rule.site, []);
      groups.get(rule.site).push(rule);
    }

    const access = new Map(await Promise.all([...groups.keys()].map(async (site) => [site, await hasAccess(site)])));
    if (token !== renderToken) return; // a newer render started

    const isCurrent = (site) => currentUrl && matchesUrl(site, currentUrl);
    const sites = [...groups.keys()].sort((a, b) => Number(isCurrent(b)) - Number(isCurrent(a)) || a.localeCompare(b));

    countBadge.textContent = String(rules.length);
    if (editingId && !rules.some((rule) => rule.id === editingId)) stopEditing(); // deleted elsewhere

    if (!rules.length) {
      listBody.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('span', { class: 'empty-icon', icon: 'cursor' }),
          h('p', { class: 'empty-title' }, 'No rules yet'),
          h('p', { class: 'hint' }, 'Add a site and an element above. AutoClick Pilot clicks it each time the page loads.'),
        ),
      );
      return;
    }

    listBody.replaceChildren(...sites.map((site) => renderGroup(site, groups.get(site), access.get(site), isCurrent(site))));
  }

  function renderGroup(site, rules, granted, current) {
    return h(
      'div',
      { class: 'rule-group' },
      h(
        'div',
        { class: 'group-header' },
        h('span', { class: 'site-icon', icon: 'globe' }),
        h('span', { class: 'site-name mono', title: site }, site),
        current && h('span', { class: 'pill pill-info' }, 'This site'),
        !granted &&
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-warn btn-sm',
              icon: 'lock',
              title: `Allow AutoClick Pilot to run on ${site}`,
              // permissions.onAdded re-renders the list once access is granted.
              onclick: () => requestAccess(site).catch(() => {}),
            },
            'Grant access',
          ),
      ),
      h('ul', { class: 'rules' }, rules.map(renderRule)),
    );
  }

  function renderRule(rule) {
    const toggleId = `acp-toggle-${rule.id}`;
    const name = rule.label || rule.selector;
    const deleteButton = h('button', {
      type: 'button',
      class: 'btn-icon btn-danger-ghost',
      icon: 'trash',
      title: 'Delete rule',
      'aria-label': `Delete rule ${name}`,
      onclick: () => confirmDelete(deleteButton, rule.id),
    });
    const editButton = h('button', {
      type: 'button',
      class: 'btn-icon',
      icon: 'pencil',
      title: 'Edit rule',
      'aria-label': `Edit rule ${name}`,
      onclick: () => startEditing(rule),
    });

    const timing = [];
    if (rule.delayMs) timing.push(`delay ${rule.delayMs / 1000}s`);
    if (rule.timeoutMs !== DEFAULTS.timeoutMs) timing.push(`wait ${rule.timeoutMs / 1000}s`);

    return h(
      'li',
      { class: `rule${rule.enabled ? '' : ' is-disabled'}${rule.id === editingId ? ' is-editing' : ''}` },
      h(
        'label',
        { class: 'switch', for: toggleId, title: rule.enabled ? 'Enabled' : 'Disabled' },
        h('input', {
          id: toggleId,
          type: 'checkbox',
          role: 'switch',
          checked: rule.enabled,
          'aria-label': `Enable rule ${name}`,
          onchange: (event) => updateRule(rule.id, { enabled: event.target.checked }).catch(render),
        }),
        h('span', { class: 'switch-track' }),
      ),
      h(
        'div',
        { class: 'rule-main' },
        rule.label && h('div', { class: 'rule-label', title: rule.label }, rule.label),
        h(
          'div',
          { class: 'rule-selector' },
          h('span', { class: `chip chip-${rule.selectorType}` }, SELECTOR_TYPES[rule.selectorType]),
          h('code', { class: 'mono', title: rule.selector }, rule.selector),
        ),
        timing.length > 0 && h('div', { class: 'rule-meta' }, timing.join(' · ')),
      ),
      h('div', { class: 'rule-actions' }, editButton, deleteButton),
    );
  }

  /** First click arms the button ("Delete?"); a second click within 3 s deletes. */
  function confirmDelete(button, id) {
    if (button.classList.contains('is-confirming')) {
      deleteRule(id).catch(render);
      return;
    }
    const label = button.getAttribute('aria-label');
    const icon = [...button.childNodes];
    button.classList.add('is-confirming');
    button.setAttribute('aria-label', `Confirm: ${label}`);
    button.textContent = 'Delete?';
    setTimeout(() => {
      button.classList.remove('is-confirming');
      button.setAttribute('aria-label', label);
      button.replaceChildren(...icon);
    }, 3000);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some(isRuleKey)) render();
  });
  chrome.permissions.onAdded.addListener(render);
  chrome.permissions.onRemoved.addListener(render);

  root.append(form, listCard);
  render();
}
