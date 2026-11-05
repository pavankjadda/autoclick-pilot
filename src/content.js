// Content script (classic script, isolated world). Asks the background worker for the rules that
// match this page, then polls for each rule's element and clicks the first visible match once.
// Chrome injects it at most once per document. Never logs selectors or page content.

(() => {
  const POLL_MS = 200;
  const MARK_ATTR = 'data-autoclick-pilot';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clicked = new WeakSet(); // one click per element per page load, even if several rules match it

  function isClickable(el) {
    if (clicked.has(el) || el.matches(':disabled')) return false; // :disabled covers <fieldset disabled>
    if (!el.checkVisibility({ checkVisibilityCSS: true })) return false; // display:none, visibility:hidden
    const { width, height } = el.getBoundingClientRect();
    return width > 0 && height > 0 && getComputedStyle(el).pointerEvents !== 'none';
  }

  function findTarget(selector) {
    for (const el of document.querySelectorAll(selector)) {
      if (isClickable(el)) return el;
    }
    return null;
  }

  /**
   * Click as the page itself would. A click from this isolated world runs javascript: links (e.g. ASP.NET
   * __doPostBack) under the extension's CSP, which blocks them, so the worker clicks the marked element in
   * the page's main world. That click removes the mark; if the mark is still there, it never ran and we
   * click from here instead.
   */
  async function click(el) {
    clicked.add(el);
    const mark = Math.random().toString(36).slice(2);
    el.setAttribute(MARK_ATTR, mark);
    await chrome.runtime.sendMessage({ type: 'acp:click', attr: MARK_ATTR, mark }).catch(() => {});
    if (el.getAttribute(MARK_ATTR) !== mark) return;
    el.removeAttribute(MARK_ATTR);
    if (el instanceof HTMLElement) el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
  }

  /** Wait for the element, wait the rule's delay, re-check, click. Resolves true if it clicked. */
  async function runRule({ selector, delayMs, timeoutMs }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let target = findTarget(selector);
      if (!target) {
        await sleep(POLL_MS);
        continue;
      }
      if (delayMs) {
        await sleep(delayMs);
        target = findTarget(selector); // the page may have changed during the delay
        if (!target) continue;
      }
      await click(target);
      return true;
    }
    return false;
  }

  async function main() {
    const rules = await chrome.runtime.sendMessage({ type: 'acp:getRules' });
    if (!Array.isArray(rules)) return;
    let count = 0;
    for (const rule of rules) {
      runRule(rule)
        .then((didClick) => didClick && chrome.runtime.sendMessage({ type: 'acp:clicked', count: ++count }))
        .catch(() => {}); // invalid selector, or the extension was reloaded
    }
  }

  // Don't click inside a prerendered page the user hasn't opened yet.
  const start = () => main().catch(() => {});
  if (document.prerendering) document.addEventListener('prerenderingchange', start, { once: true });
  else start();
})();
