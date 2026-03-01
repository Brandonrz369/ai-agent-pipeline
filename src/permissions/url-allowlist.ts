/**
 * URL Allowlist - T31 (Charlie)
 * Semantics: empty -> allow all, non-empty -> default-deny
 * Patterns: regex (auto-anchored ^/$) or glob (* -> .*)
 */

export class URLAllowlist {
  private readonly compiled: Array<{ regex: RegExp; original: string }>;

  constructor(patterns: string[]) {
    this.compiled = patterns.map((p) => ({
      regex: this.compilePattern(p),
      original: p,
    }));
  }

  isAllowed(url: string): boolean {
    if (this.compiled.length === 0) return true;
    return this.compiled.some(({ regex }) => regex.test(url));
  }

  get patterns(): string[] {
    return this.compiled.map((c) => c.original);
  }

  private compilePattern(pattern: string): RegExp {
    // Detect glob patterns: * not preceded by . (i.e. not part of regex .*).
    // Examples: https://*.example.com (glob), https://app\.com/.* (regex)
    const hasGlobStar = /(?<![.])\*/u.test(pattern);
    if (hasGlobStar) {
      return this.globToRegex(pattern);
    }
    // Try to compile as a regex (auto-anchor if no explicit anchors).
    try {
      const anchored = (pattern.startsWith("^") ? "" : "^") + pattern + (pattern.endsWith("$") ? "" : "$");
      return new RegExp(anchored);
    } catch {
      // Invalid regex - treat as glob.
      return this.globToRegex(pattern);
    }
  }

  private globToRegex(glob: string): RegExp {
    const escaped = glob
      .replace(/[-\\^$.|?+(){}[\]]/g, '\\$&')
      .replace(/[*]/g, ".*");
    return new RegExp("^" + escaped + "$");
  }
}
