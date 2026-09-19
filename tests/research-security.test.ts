import { describe, expect, it, vi } from "vitest";
import { isPublicIp, safeFetchHtml, validatePublicHttpUrl } from "../lib/research/website-fetcher";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("secure research fetcher", () => {
  it("blocks localhost, private IPv4, private IPv6, and non-http schemes", async () => {
    await expect(validatePublicHttpUrl("http://localhost/admin", publicResolver)).rejects.toThrow(/Internal/);
    await expect(validatePublicHttpUrl("http://127.0.0.1/", publicResolver)).rejects.toThrow(/Private/);
    await expect(validatePublicHttpUrl("http://[::1]/", publicResolver)).rejects.toThrow(/Private/);
    await expect(validatePublicHttpUrl("file:///etc/passwd", publicResolver)).rejects.toThrow(/HTTP/);
    expect(isPublicIp("10.0.0.3")).toBe(false);
    expect(isPublicIp("fc00::1")).toBe(false);
  });

  it("revalidates redirect destinations and blocks redirects into private networks", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    await expect(safeFetchHtml("https://example.com", { timeoutMs: 1000, resolver: publicResolver, fetchImpl })).rejects.toThrow(/Private/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized and unsupported responses", async () => {
    const oversized = vi.fn(async () => new Response("x", { status: 200, headers: { "content-type": "text/html", "content-length": "200" } }));
    await expect(safeFetchHtml("https://example.com", { timeoutMs: 1000, maxBytes: 100, resolver: publicResolver, fetchImpl: oversized })).rejects.toThrow(/too large/);
    const json = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(safeFetchHtml("https://example.com", { timeoutMs: 1000, resolver: publicResolver, fetchImpl: json })).rejects.toThrow(/content type/);
  });

  it("enforces a request timeout", async () => {
    const fetchImpl = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    await expect(safeFetchHtml("https://example.com", { timeoutMs: 5, resolver: publicResolver, fetchImpl })).rejects.toThrow(/timed out/);
  });
});
