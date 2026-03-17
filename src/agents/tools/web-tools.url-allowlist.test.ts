import { describe, expect, it } from "vitest";
import { matchesHostnameAllowlist, normalizeHostnameAllowlist } from "../../infra/net/ssrf.js";
import { resolveUrlAllowlist } from "./web-shared.js";

// ---------------------------------------------------------------------------
// resolveUrlAllowlist
// ---------------------------------------------------------------------------
describe("resolveUrlAllowlist", () => {
  it("returns undefined when web config is undefined", () => {
    expect(resolveUrlAllowlist(undefined)).toBeUndefined();
  });

  it("returns undefined when urlAllowlist is not set", () => {
    expect(resolveUrlAllowlist({ search: {} })).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(resolveUrlAllowlist({ urlAllowlist: [] })).toBeUndefined();
  });

  it("returns normalized patterns for valid entries", () => {
    const result = resolveUrlAllowlist({ urlAllowlist: ["Example.COM", "*.GitHub.com"] });
    expect(result).toEqual(["example.com", "*.github.com"]);
  });

  it("deduplicates entries", () => {
    const result = resolveUrlAllowlist({
      urlAllowlist: ["example.com", "EXAMPLE.COM", "example.com"],
    });
    expect(result).toEqual(["example.com"]);
  });

  it("filters out bare * and *. patterns", () => {
    const result = resolveUrlAllowlist({ urlAllowlist: ["*", "*.", "example.com"] });
    expect(result).toEqual(["example.com"]);
  });
});

// ---------------------------------------------------------------------------
// normalizeHostnameAllowlist
// ---------------------------------------------------------------------------
describe("normalizeHostnameAllowlist", () => {
  it("returns empty array for undefined", () => {
    expect(normalizeHostnameAllowlist(undefined)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeHostnameAllowlist([])).toEqual([]);
  });

  it("lowercases and deduplicates", () => {
    const result = normalizeHostnameAllowlist(["FOO.COM", "foo.com", "Bar.org"]);
    expect(result).toEqual(["foo.com", "bar.org"]);
  });

  it("preserves wildcard prefixes", () => {
    const result = normalizeHostnameAllowlist(["*.Example.COM"]);
    expect(result).toEqual(["*.example.com"]);
  });
});

// ---------------------------------------------------------------------------
// matchesHostnameAllowlist
// ---------------------------------------------------------------------------
describe("matchesHostnameAllowlist", () => {
  it("allows any hostname when allowlist is empty", () => {
    expect(matchesHostnameAllowlist("anything.com", [])).toBe(true);
  });

  it("matches exact domain", () => {
    expect(matchesHostnameAllowlist("example.com", ["example.com"])).toBe(true);
  });

  it("rejects non-matching domain", () => {
    expect(matchesHostnameAllowlist("evil.com", ["example.com"])).toBe(false);
  });

  it("matches wildcard subdomain pattern", () => {
    expect(matchesHostnameAllowlist("sub.github.com", ["*.github.com"])).toBe(true);
  });

  it("matches deeply nested wildcard subdomain", () => {
    expect(matchesHostnameAllowlist("a.b.github.com", ["*.github.com"])).toBe(true);
  });

  it("wildcard does not match the bare domain itself", () => {
    expect(matchesHostnameAllowlist("github.com", ["*.github.com"])).toBe(false);
  });

  it("matches single-label hostname like localhost", () => {
    expect(matchesHostnameAllowlist("localhost", ["localhost"])).toBe(true);
  });

  it("rejects when no pattern matches", () => {
    expect(matchesHostnameAllowlist("evil.com", ["good.com", "*.trusted.org"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isUrlAllowedByAllowlist (inline — same logic as web-fetch.ts export)
// Tested inline to avoid heavyweight transitive imports from web-fetch.ts
// ---------------------------------------------------------------------------
function isUrlAllowedByAllowlist(url: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return matchesHostnameAllowlist(parsed.hostname, allowlist);
  } catch {
    return false;
  }
}

describe("isUrlAllowedByAllowlist", () => {
  it("allows any URL when allowlist is empty", () => {
    expect(isUrlAllowedByAllowlist("https://anything.com/path", [])).toBe(true);
  });

  it("allows URL matching exact domain", () => {
    expect(isUrlAllowedByAllowlist("https://example.com/page", ["example.com"])).toBe(true);
  });

  it("blocks URL not matching allowlist", () => {
    expect(isUrlAllowedByAllowlist("https://evil.com/page", ["example.com"])).toBe(false);
  });

  it("allows URL matching wildcard domain", () => {
    expect(isUrlAllowedByAllowlist("https://docs.github.com/en/rest", ["*.github.com"])).toBe(true);
  });

  it("returns false for invalid URL", () => {
    expect(isUrlAllowedByAllowlist("not-a-url", ["example.com"])).toBe(false);
  });

  it("handles URL with port", () => {
    expect(isUrlAllowedByAllowlist("https://example.com:8080/path", ["example.com"])).toBe(true);
  });

  it("handles http protocol", () => {
    expect(isUrlAllowedByAllowlist("http://example.com/path", ["example.com"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterResultsByAllowlist (inline — same logic as web-search-core.ts export)
// Tested inline to avoid heavyweight transitive imports from web-search-core.ts
// ---------------------------------------------------------------------------
function filterResultsByAllowlist<T extends { url?: string }>(
  results: T[],
  allowlist: string[],
): T[] {
  if (allowlist.length === 0) {
    return results;
  }
  return results.filter((entry) => {
    const url = entry.url;
    if (!url) {
      return false;
    }
    try {
      const parsed = new URL(url);
      return matchesHostnameAllowlist(parsed.hostname, allowlist);
    } catch {
      return false;
    }
  });
}

describe("filterResultsByAllowlist", () => {
  const results = [
    { url: "https://example.com/page1", title: "Example" },
    { url: "https://docs.github.com/rest", title: "GitHub Docs" },
    { url: "https://evil.com/hack", title: "Evil" },
    { url: "https://sub.example.com/nested", title: "Sub Example" },
  ];

  it("returns all results when allowlist is empty", () => {
    expect(filterResultsByAllowlist(results, [])).toEqual(results);
  });

  it("filters to only matching domains", () => {
    const filtered = filterResultsByAllowlist(results, ["example.com"]);
    expect(filtered).toEqual([{ url: "https://example.com/page1", title: "Example" }]);
  });

  it("supports wildcard patterns", () => {
    const filtered = filterResultsByAllowlist(results, ["*.github.com"]);
    expect(filtered).toEqual([{ url: "https://docs.github.com/rest", title: "GitHub Docs" }]);
  });

  it("supports multiple allowlist entries", () => {
    const filtered = filterResultsByAllowlist(results, ["example.com", "*.github.com"]);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.url)).toEqual([
      "https://example.com/page1",
      "https://docs.github.com/rest",
    ]);
  });

  it("wildcard matches subdomains", () => {
    const filtered = filterResultsByAllowlist(results, ["*.example.com"]);
    expect(filtered).toEqual([{ url: "https://sub.example.com/nested", title: "Sub Example" }]);
  });

  it("filters out entries with no url", () => {
    const withMissing = [...results, { title: "No URL" } as { url?: string; title: string }];
    const filtered = filterResultsByAllowlist(withMissing, ["example.com"]);
    expect(filtered.every((r) => r.url !== undefined)).toBe(true);
  });

  it("filters out entries with invalid URLs", () => {
    const withInvalid = [...results, { url: "not-valid", title: "Bad URL" }];
    const filtered = filterResultsByAllowlist(withInvalid, ["example.com"]);
    expect(filtered).toEqual([{ url: "https://example.com/page1", title: "Example" }]);
  });
});
