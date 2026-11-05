// Pure rule logic shared by the background worker, the settings UI, and unit tests.
// No chrome.* access, and DOM use is feature-detected (isValidCss), so it runs in a service worker and in Node.

export const SELECTOR_TYPES = Object.freeze({
  css: 'CSS',
  id: 'ID',
  name: 'Name',
  aria: 'ARIA label',
});

export const LIMITS = Object.freeze({
  siteMaxLength: 2_000,
  selectorMaxLength: 500,
  labelMaxLength: 80,
  delayMinMs: 0,
  delayMaxMs: 60_000,
  timeoutMinMs: 1_000,
  timeoutMaxMs: 120_000,
});

export const DEFAULTS = Object.freeze({
  delayMs: 0,
  timeoutMs: 10_000,
});

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const NOT_A_SITE = 'That does not look like a site. Try example.com or example.com/login';

/** localhost and IP addresses get exact-host matching; domain names also cover their subdomains. */
const isExactHost = (host) => host === 'localhost' || IPV4.test(host);

/** Does a rule for `ruleHost` cover `host`? */
const hostCovers = (ruleHost, host) => host === ruleHost || (!isExactHost(ruleHost) && host.endsWith(`.${ruleHost}`));

const isWebUrl = (url) => url.protocol === 'http:' || url.protocol === 'https:';
const hostOf = (url) => url.hostname.replace(/\.$/, ''); // URL already lowercases http(s) hosts
const defaultPort = (url) => (url.protocol === 'https:' ? '443' : '80');

/**
 * CSS.escape polyfill (CSSOM spec). The service worker and Node have no CSS global.
 * Based on https://drafts.csswg.org/cssom/#serialize-an-identifier
 */
export function cssEscape(value) {
  const string = String(value);
  const length = string.length;
  let result = '';
  const firstCodeUnit = string.charCodeAt(0);

  if (length === 1 && firstCodeUnit === 0x2d) {
    return '\\' + string;
  }

  for (let index = 0; index < length; index++) {
    const codeUnit = string.charCodeAt(index);

    if (codeUnit === 0x0000) {
      result += '\uFFFD';
      continue;
    }

    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
    ) {
      result += '\\' + codeUnit.toString(16) + ' ';
      continue;
    }

    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += string.charAt(index);
      continue;
    }

    result += '\\' + string.charAt(index);
  }

  return result;
}

/** Escape a value for use inside a double-quoted CSS attribute selector. */
function quoteAttrValue(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, ' ') + '"';
}

function isValidHostname(host) {
  if (host === 'localhost') return true;
  if (IPV4.test(host)) return host.split('.').every((part) => Number(part) <= 255);
  if (host.length > 253 || !host.includes('.')) return false;
  return host.split('.').every((label) => HOST_LABEL.test(label));
}

/**
 * Parse what the user typed in the "Site" field.
 * Accepts "example.com", "example.com/login", "https://www.example.com:8443/app?x=1", "localhost:3000".
 * @returns {{ host: string, port: string, path: string }}
 * @throws {Error} with a user-facing message when invalid.
 */
export function parseSite(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Enter a site, e.g. example.com or example.com/login');
  if (raw.length > LIMITS.siteMaxLength) throw new Error(`Site is too long (max ${LIMITS.siteMaxLength} characters)`);
  if (/\s/.test(raw)) throw new Error(NOT_A_SITE);

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(NOT_A_SITE);
  }
  if (!isWebUrl(url)) throw new Error('Only http and https sites are supported');

  const host = hostOf(url);
  if (!isValidHostname(host)) {
    throw new Error(`"${host}" is not a valid host name`);
  }

  let path = url.pathname || '/';
  if (path.length > 1) path = path.replace(/\/+$/, '');
  // URL hides a scheme's default port (https :443, http :80); re-parse under the other scheme to see a typed one.
  const otherScheme = url.protocol === 'https:' ? 'http:' : 'https:';
  const port = url.port || new URL(otherScheme + withScheme.slice(url.protocol.length)).port;
  return { host, port, path };
}

/** Canonical string stored on a rule: host[:port][/path] */
export function normalizeSite(input) {
  const { host, port, path } = parseSite(input);
  return `${host}${port ? `:${port}` : ''}${path === '/' ? '' : path}`;
}

/** Suggest a site value from a tab URL (drops "www." and path). Returns '' when not a web page. */
export function suggestSiteFromUrl(tabUrl) {
  try {
    const url = new URL(tabUrl);
    if (!isWebUrl(url)) return '';
    const host = hostOf(url).replace(/^www\./, '');
    return `${host}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return '';
  }
}

/**
 * Does a rule's site match a page URL?
 * A domain matches itself and any subdomain (localhost and IPs match exactly); a port (if given)
 * must match; the path is a segment-aware prefix ("/login" matches "/login/step-2", not "/login-help").
 */
export function matchesUrl(site, pageUrl) {
  let target;
  let page;
  try {
    target = parseSite(site);
    page = new URL(pageUrl);
  } catch {
    return false;
  }
  if (!isWebUrl(page) || !hostCovers(target.host, hostOf(page))) return false;
  if (target.port && (page.port || defaultPort(page)) !== target.port) return false;

  if (target.path === '/') return true;
  const pagePath = page.pathname;
  return pagePath === target.path || pagePath.startsWith(`${target.path}/`);
}

/**
 * Chrome host-permission match patterns for a site. Match patterns cannot carry ports or
 * path-prefix semantics, so we request the host (and subdomains) and filter precisely at runtime.
 */
export function toMatchPatterns(site) {
  const { host } = parseSite(site);
  return [isExactHost(host) ? `*://${host}/*` : `*://*.${host}/*`];
}

/**
 * Does access granted for `site` also cover `otherSite`'s host? (Host only: access never depends on path
 * or port.) Used to avoid revoking access that a remaining rule still relies on.
 */
export function siteCovers(site, otherSite) {
  try {
    return hostCovers(parseSite(site).host, parseSite(otherSite).host);
  } catch {
    return false;
  }
}

/** Is this a syntactically valid CSS selector? Always true where there is no DOM (service worker, Node). */
function isValidCss(selector) {
  if (typeof document === 'undefined') return true;
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/** Turn a rule's typed value into a CSS selector. */
export function buildSelector(selectorType, value) {
  const v = String(value ?? '').trim();
  switch (selectorType) {
    case 'id':
      return `#${cssEscape(v)}`;
    case 'name':
      return `[name=${quoteAttrValue(v)}]`;
    case 'aria':
      return `[aria-label=${quoteAttrValue(v)}]`;
    case 'css':
      return v;
    default:
      throw new Error(`Unknown selector type "${selectorType}"`);
  }
}

function clampInt(value, min, max, fallback) {
  if (value === '' || value == null) return fallback;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validate and normalize rule input (from the form or an import file).
 * CSS syntax is checked where a DOM is available (settings UI and import).
 * @returns {object} normalized rule
 * @throws {Error} with a user-facing message
 */
export function normalizeRule(input, { newId = () => crypto.randomUUID(), now = () => Date.now() } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Rule must be an object');

  const selectorType = String(input.selectorType ?? '');
  if (!Object.hasOwn(SELECTOR_TYPES, selectorType)) {
    throw new Error('Choose how to find the element: CSS, ID, Name or ARIA label');
  }

  let selector = String(input.selector ?? '').trim();
  if (selectorType === 'id') selector = selector.replace(/^#/, '');
  if (!selector) throw new Error(`Enter the element's ${SELECTOR_TYPES[selectorType]}`);
  if (selector.length > LIMITS.selectorMaxLength) {
    throw new Error(`Selector is too long (max ${LIMITS.selectorMaxLength} characters)`);
  }
  if (selectorType === 'css' && !isValidCss(selector)) throw new Error('That CSS selector is not valid');

  const label = String(input.label ?? '').trim().slice(0, LIMITS.labelMaxLength);

  return {
    id: typeof input.id === 'string' && /^[\w-]{8,64}$/.test(input.id) ? input.id : newId(),
    site: normalizeSite(input.site),
    selectorType,
    selector,
    label,
    enabled: input.enabled !== false,
    delayMs: clampInt(input.delayMs, LIMITS.delayMinMs, LIMITS.delayMaxMs, DEFAULTS.delayMs),
    timeoutMs: clampInt(input.timeoutMs, LIMITS.timeoutMinMs, LIMITS.timeoutMaxMs, DEFAULTS.timeoutMs),
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now(),
  };
}
