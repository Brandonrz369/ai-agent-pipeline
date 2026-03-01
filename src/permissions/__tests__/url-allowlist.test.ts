/**
 * URLAllowlist Tests - T31 (Charlie)
 */
import { describe, it, expect } from 'vitest';
import { URLAllowlist } from '../url-allowlist.js';

describe('URLAllowlist - empty allowlist', () => {
  it('allows all URLs when allowlist is empty', () => {
    const al = new URLAllowlist([]);
    expect(al.isAllowed('https://example.com')).toBe(true);
    expect(al.isAllowed('https://evil.com/malicious')).toBe(true);
    expect(al.isAllowed('http://anything.at.all/path?q=1#hash')).toBe(true);
  });
});

describe('URLAllowlist - exact URL matching', () => {
  it('allows exact URL match', () => {
    const al = new URLAllowlist(['https://example\\.com/path']);
    expect(al.isAllowed('https://example.com/path')).toBe(true);
  });
  it('rejects URLs that differ from exact pattern', () => {
    const al = new URLAllowlist(['https://example\\.com/path']);
    expect(al.isAllowed('https://example.com/other')).toBe(false);
    expect(al.isAllowed('https://evil.com/path')).toBe(false);
  });
});

describe('URLAllowlist - regex patterns', () => {
  it('supports regex with wildcard path (.*)', () => {
    const al = new URLAllowlist(['https://app\\.dentrix\\.com/.*']);
    expect(al.isAllowed('https://app.dentrix.com/')).toBe(true);
    expect(al.isAllowed('https://app.dentrix.com/patients')).toBe(true);
    expect(al.isAllowed('https://app.dentrix.com/patients?id=123')).toBe(true);
  });
  it('regex pattern rejects other domains', () => {
    const al = new URLAllowlist(['https://app\\.dentrix\\.com/.*']);
    expect(al.isAllowed('https://evil.com')).toBe(false);
    expect(al.isAllowed('https://fake-dentrix.com/patients')).toBe(false);
  });
  it('rejects injection: URL containing allowed domain as substring', () => {
    const al = new URLAllowlist(['https://app\\.dentrix\\.com/.*']);
    expect(al.isAllowed('https://evil.com/https://app.dentrix.com/patients')).toBe(false);
    expect(al.isAllowed('https://evil.com?redirect=https://app.dentrix.com/')).toBe(false);
  });
  it('supports pre-anchored regex patterns', () => {
    const al = new URLAllowlist(['^https://secure\\.bank\\.com/.*']);
    expect(al.isAllowed('https://secure.bank.com/account')).toBe(true);
    expect(al.isAllowed('http://secure.bank.com/account')).toBe(false);
  });
});
describe('URLAllowlist - glob patterns', () => {
  it('supports subdomain wildcard glob: https://*.example.com', () => {
    const al = new URLAllowlist(['https://*.example.com']);
    expect(al.isAllowed('https://app.example.com')).toBe(true);
    expect(al.isAllowed('https://api.example.com')).toBe(true);
  });
  it('supports path wildcard glob: https://example.com/*', () => {
    const al = new URLAllowlist(['https://example.com/*']);
    expect(al.isAllowed('https://example.com/path')).toBe(true);
    expect(al.isAllowed('https://example.com/a/b/c')).toBe(true);
  });
  it('supports combined subdomain+path glob: https://*.example.com/*', () => {
    const al = new URLAllowlist(['https://*.example.com/*']);
    expect(al.isAllowed('https://app.example.com/dashboard')).toBe(true);
    expect(al.isAllowed('https://api.example.com/v2/users')).toBe(true);
  });
  it('glob pattern rejects other domains', () => {
    const al = new URLAllowlist(['https://*.example.com/*']);
    expect(al.isAllowed('https://evil.com/path')).toBe(false);
    expect(al.isAllowed('https://example.evil.com/path')).toBe(false);
  });
});

describe('URLAllowlist - multiple patterns', () => {
  it('allows URL matching any pattern in the list', () => {
    const al = new URLAllowlist([
      'https://app\\.dentrix\\.com/.*',
      'https://portal\\.dentrix\\.com/.*',
    ]);
    expect(al.isAllowed('https://app.dentrix.com/patients')).toBe(true);
    expect(al.isAllowed('https://portal.dentrix.com/login')).toBe(true);
    expect(al.isAllowed('https://evil.com')).toBe(false);
  });
});

describe('URLAllowlist - security: malicious URL rejection', () => {
  it('rejects data: URLs', () => {
    const al = new URLAllowlist(['https://example\\.com/.*']);
    expect(al.isAllowed('data:text/html,<script>alert(1)</script>')).toBe(false);
  });
  it('rejects javascript: URLs', () => {
    const al = new URLAllowlist(['https://example\\.com/.*']);
    expect(al.isAllowed('javascript:alert(document.cookie)')).toBe(false);
  });
  it('rejects http when only https is allowed', () => {
    const al = new URLAllowlist(['https://example\\.com/.*']);
    expect(al.isAllowed('http://example.com/path')).toBe(false);
  });
});

describe('URLAllowlist - patterns getter', () => {
  it('returns original pattern strings', () => {
    const patterns = ['https://a\\.com/.*', 'https://*.b.com/*'];
    const al = new URLAllowlist(patterns);
    expect(al.patterns).toEqual(patterns);
  });
});
