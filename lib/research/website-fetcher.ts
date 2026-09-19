import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { WebsiteFetcher } from "./contracts";

type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
const defaultResolver: Resolver = async (hostname) => lookup(hostname, { all: true, verbatim: true });

function blockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 2 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51 && parts[2] === 100)) || (a === 203 && b === 0 && parts[2] === 113) || a >= 224;
}

function blockedIpv6(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8:") || normalized.startsWith("::ffff:")) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? blockedIpv4(mapped) : false;
}

export function isPublicIp(address: string) {
  const family = isIP(address);
  return family === 4 ? !blockedIpv4(address) : family === 6 ? !blockedIpv6(address) : false;
}

export async function validatePublicHttpUrl(raw: string, resolver: Resolver = defaultResolver) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP(S) URLs are allowed");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are not allowed");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("Internal hostnames are blocked");
  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error("Private or reserved IP addresses are blocked");
  } else {
    const addresses = await resolver(hostname);
    if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) throw new Error("Hostname resolves to a private or reserved address");
  }
  url.hash = "";
  return url;
}

async function readLimitedBody(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximumBytes) throw new Error("Website response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) { await reader.cancel(); throw new Error("Website response is too large"); }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

export interface SafeFetchOptions { timeoutMs: number; maxBytes?: number; maxRedirects?: number; resolver?: Resolver; fetchImpl?: typeof fetch }

export async function safeFetchHtml(rawUrl: string, options: SafeFetchOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolver = options.resolver ?? defaultResolver;
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 1_500_000;
  let current = await validatePublicHttpUrl(rawUrl, resolver);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(current, { redirect: "manual", credentials: "omit", signal: controller.signal, headers: { "User-Agent": "JARVIS-Research/0.3 (+public-business-research)", Accept: "text/html,application/xhtml+xml;q=0.9" } });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("Website request timed out");
      throw new Error("Website request failed");
    } finally { clearTimeout(timeout); }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Website redirect is missing a destination");
      if (redirect === maxRedirects) throw new Error("Website redirect limit exceeded");
      current = await validatePublicHttpUrl(new URL(location, current).toString(), resolver);
      continue;
    }
    if (!response.ok) throw new Error(`Website returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (contentType !== "text/html" && contentType !== "application/xhtml+xml") throw new Error("Unsupported website content type");
    return { url: current.toString(), status: response.status, contentType, html: await readLimitedBody(response, maxBytes) };
  }
  throw new Error("Website redirect limit exceeded");
}

export class SecureWebsiteFetcher implements WebsiteFetcher {
  constructor(private readonly overrides: Omit<SafeFetchOptions, "timeoutMs"> = {}) {}
  async fetchSite(rawUrl: string, options: { maxPages: number; timeoutMs: number }) {
    const pages: Array<{ url: string; status: number; contentType: string; html: string }> = [];
    const errors: string[] = [];
    try {
      const homepage = await safeFetchHtml(rawUrl, { ...this.overrides, timeoutMs: options.timeoutMs });
      pages.push(homepage);
      const { extractRelevantSameOriginLinks } = await import("./website-analyzer");
      const links = extractRelevantSameOriginLinks(homepage.html, homepage.url).slice(0, Math.max(0, Math.min(5, options.maxPages) - 1));
      for (const link of links) {
        try { pages.push(await safeFetchHtml(link, { ...this.overrides, timeoutMs: options.timeoutMs })); }
        catch (error) { errors.push(error instanceof Error ? error.message : "Website page failed"); }
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : "Website unavailable"); }
    return { status: pages.length === 0 ? "failed" as const : errors.length ? "partial" as const : "completed" as const, pages, errors };
  }
}
