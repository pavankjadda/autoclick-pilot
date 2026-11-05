import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSelector,
  cssEscape,
  matchesUrl,
  normalizeRule,
  siteCovers,
  normalizeSite,
  suggestSiteFromUrl,
  toMatchPatterns,
} from '../src/shared/rules.js';

describe('normalizeSite', () => {
  it('strips scheme, query, hash and trailing slash', () => {
    assert.equal(normalizeSite('https://Shop.Example.com/login/?a=1#x'), 'shop.example.com/login');
    assert.equal(normalizeSite('example.com/'), 'example.com');
  });

  it('keeps an explicit port, including default ports', () => {
    assert.equal(normalizeSite('localhost:8000'), 'localhost:8000');
    assert.equal(normalizeSite('example.com:443'), 'example.com:443');
    assert.equal(normalizeSite('http://example.com:80/app'), 'example.com:80/app');
    assert.equal(normalizeSite('https://example.com:443'), 'example.com:443');
    assert.equal(normalizeSite('example.com:0443/x'), 'example.com:443/x');
    assert.equal(normalizeSite('example.com/a:80'), 'example.com/a:80');
  });

  it('rejects junk', () => {
    assert.throws(() => normalizeSite(''), /Enter a site/);
    assert.throws(() => normalizeSite('not a site'), /does not look like a site/);
    assert.throws(() => normalizeSite(`example.com/${'a'.repeat(2000)}`), /too long/);
    assert.throws(() => normalizeSite('ftp://example.com'), /http/);
    assert.throws(() => normalizeSite('intranet'), /valid host/);
  });
});

describe('matchesUrl', () => {
  it('matches host and subdomains on any path', () => {
    assert.ok(matchesUrl('example.com', 'https://example.com/'));
    assert.ok(matchesUrl('example.com', 'http://www.example.com/a/b'));
    assert.ok(!matchesUrl('example.com', 'https://notexample.com/'));
    assert.ok(!matchesUrl('example.com', 'https://example.com.evil.io/'));
  });

  it('treats path as a segment-aware prefix', () => {
    assert.ok(matchesUrl('example.com/login', 'https://example.com/login'));
    assert.ok(matchesUrl('example.com/login', 'https://example.com/login/step-2?x=1'));
    assert.ok(!matchesUrl('example.com/login', 'https://example.com/login-help'));
    assert.ok(!matchesUrl('example.com/login', 'https://example.com/'));
  });

  it('honours an explicit port', () => {
    assert.ok(matchesUrl('localhost:8000', 'http://localhost:8000/x'));
    assert.ok(!matchesUrl('localhost:8000', 'http://localhost:3000/x'));
    assert.ok(matchesUrl('localhost', 'http://localhost:3000/x'));
  });

  it('compares default ports by scheme', () => {
    assert.ok(matchesUrl('example.com:80', 'http://example.com/'));
    assert.ok(!matchesUrl('example.com:80', 'https://example.com/'));
    assert.ok(matchesUrl('example.com:443', 'https://example.com/'));
    assert.ok(!matchesUrl('example.com:443', 'http://example.com:8080/'));
  });

  it('matches localhost and IPs exactly, without subdomains', () => {
    assert.ok(!matchesUrl('localhost', 'http://app.localhost/'));
    assert.ok(!matchesUrl('10.0.0.1', 'http://x.10.0.0.1/'));
  });

  it('ignores a trailing dot on the page host', () => {
    assert.ok(matchesUrl('example.com', 'https://example.com./'));
  });

  it('ignores non-web pages', () => {
    assert.ok(!matchesUrl('example.com', 'chrome://extensions'));
    assert.ok(!matchesUrl('example.com', 'garbage'));
  });
});

describe('toMatchPatterns', () => {
  it('covers subdomains for domain names', () => {
    assert.deepEqual(toMatchPatterns('example.com/login'), ['*://*.example.com/*']);
  });

  it('uses exact host for localhost and IPs, without port', () => {
    assert.deepEqual(toMatchPatterns('localhost:8000'), ['*://localhost/*']);
    assert.deepEqual(toMatchPatterns('127.0.0.1'), ['*://127.0.0.1/*']);
  });
});

describe('siteCovers', () => {
  it('lets access for a domain cover a remaining rule on it or a subdomain', () => {
    assert.ok(siteCovers('example.com', 'shop.example.com/cart'));
    assert.ok(siteCovers('example.com/login', 'example.com:8443'));
    assert.ok(siteCovers('localhost', 'localhost:3000/app'));
  });

  it('does not let narrower, exact-host or unrelated access cover a rule', () => {
    assert.ok(!siteCovers('shop.example.com', 'example.com'));
    assert.ok(!siteCovers('example.com', 'notexample.com'));
    assert.ok(!siteCovers('localhost', 'app.localhost'));
    assert.ok(!siteCovers('example.com', 'not a site'));
  });
});

describe('buildSelector', () => {
  it('escapes ids', () => {
    assert.equal(buildSelector('id', 'accept'), '#accept');
    assert.equal(buildSelector('id', '1st.btn'), '#\\31 st\\.btn');
  });


  it('quotes name and aria-label values', () => {
    assert.equal(buildSelector('name', 'submit'), '[name="submit"]');
    assert.equal(buildSelector('aria', 'Say "hi" \\ bye'), '[aria-label="Say \\"hi\\" \\\\ bye"]');
  });

  it('passes CSS through trimmed', () => {
    assert.equal(buildSelector('css', '  button.ok  '), 'button.ok');
  });

  it('rejects unknown types', () => {
    assert.throws(() => buildSelector('xpath', '//a'), /Unknown selector type/);
  });
});

describe('cssEscape', () => {
  it('follows the CSSOM rules', () => {
    assert.equal(cssEscape('-'), '\\-');
    assert.equal(cssEscape('-1a'), '-\\31 a');
    assert.equal(cssEscape('a b'), 'a\\ b');
    assert.equal(cssEscape('ünï'), 'ünï');
  });
});

describe('normalizeRule', () => {
  const opts = { newId: () => 'rule-0001', now: () => 1000 };

  it('fills defaults and clamps timing', () => {
    const rule = normalizeRule(
      { site: 'https://example.com/', selectorType: 'aria', selector: ' Accept ', delayMs: 999999, timeoutMs: 5 },
      opts,
    );
    assert.deepEqual(rule, {
      id: 'rule-0001',
      site: 'example.com',
      selectorType: 'aria',
      selector: 'Accept',
      label: '',
      enabled: true,
      delayMs: 60000,
      timeoutMs: 1000,
      createdAt: 1000,
    });
  });

  it('parses timing as numbers, including exponents', () => {
    const rule = normalizeRule({ site: 'example.com', selectorType: 'css', selector: 'a', delayMs: 1e21, timeoutMs: '30e3' }, opts);
    assert.equal(rule.delayMs, 60000);
    assert.equal(rule.timeoutMs, 30000);
    const defaults = normalizeRule({ site: 'example.com', selectorType: 'css', selector: 'a', delayMs: '', timeoutMs: '' }, opts);
    assert.equal(defaults.delayMs, 0);
    assert.equal(defaults.timeoutMs, 10000);
  });

  it('strips a leading # from id selectors', () => {
    assert.equal(normalizeRule({ site: 'example.com', selectorType: 'id', selector: '#go' }, opts).selector, 'go');
  });

  it('requires a selector and a known type', () => {
    assert.throws(() => normalizeRule({ site: 'example.com', selectorType: 'css', selector: ' ' }, opts), /Enter/);
    assert.throws(() => normalizeRule({ site: 'example.com', selectorType: 'x', selector: 'a' }, opts), /Choose/);
  });
});

describe('suggestSiteFromUrl', () => {
  it('drops www and path, keeps port', () => {
    assert.equal(suggestSiteFromUrl('https://www.example.com/a?b'), 'example.com');
    assert.equal(suggestSiteFromUrl('http://localhost:8000/'), 'localhost:8000');
    assert.equal(suggestSiteFromUrl('https://example.com:443/'), 'example.com');
    assert.equal(suggestSiteFromUrl('chrome://newtab'), '');
  });
});
