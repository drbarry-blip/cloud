import "server-only";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { BRAND } from "./brand";

// Fetches public web pages safely. URLs come from Google profiles (and could be
// anything), so every connection is checked against private and internal address
// ranges at connect time, which also defeats DNS-rebinding tricks.

export const USER_AGENT = `Mozilla/5.0 (compatible; ClinicGrowthBot/0.1; ${BRAND.name} visibility check)`;
const BOT_TOKEN = "clinicgrowthbot";

export class FetchBlockedError extends Error {
  override name = "FetchBlockedError";
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const n = ipv4ToInt(ip);
    return !BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (lower === "::" || lower === "::1") return false;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
    if (lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8:") || lower.startsWith("100::")) return false;
    return true;
  }
  return false;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || !list.every((a) => isPublicAddress(a.address))) {
      return callback(new FetchBlockedError(`Refusing to connect to a non-public address for ${hostname}`), "");
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

function requestOnce(url: URL, timeoutMs: number, maxBytes: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        lookup: safeLookup as unknown as typeof dns.lookup,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" ? res.pipe(zlib.createGunzip())
          : encoding === "deflate" ? res.pipe(zlib.createInflate())
          : encoding === "br" ? res.pipe(zlib.createBrotliDecompress())
          : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            stream.destroy();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        stream.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** GETs a public http(s) URL, following up to `maxRedirects` redirects, each re-validated. */
export async function fetchPublicPage(rawUrl: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const { timeoutMs = 10_000, maxBytes = 1_500_000, maxRedirects = 3 } = opts;
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlockedError(`Unsupported protocol ${url.protocol}`);
    if (url.username || url.password) throw new FetchBlockedError("URLs with credentials aren't allowed");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // IP-literal hosts skip DNS lookup, so check them here.
    if (net.isIP(host) && !isPublicAddress(host)) throw new FetchBlockedError(`Refusing to connect to ${host}`);
    const res = await requestOnce(url, timeoutMs, maxBytes);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    return { url: url.toString(), status: res.status, contentType: String(res.headers["content-type"] ?? ""), body: res.body };
  }
  throw new Error("Too many redirects");
}

/** Minimal robots.txt check: our bot's group if present, else "*"; longest match wins, Allow wins ties. */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: field === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const group =
    groups.find((g) => g.agents.includes(BOT_TOKEN)) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of group.rules) {
    const pattern = new RegExp(
      "^" + rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"),
    );
    if (pattern.test(path) && (!best || rule.path.length > best.length || (rule.path.length === best.length && rule.allow))) {
      best = { allow: rule.allow, length: rule.path.length };
    }
  }
  return best ? best.allow : true;
}

/** Fetches robots.txt for an origin; missing or unreadable files allow everything. */
export async function fetchRobots(origin: string): Promise<string> {
  try {
    const res = await fetchPublicPage(`${origin}/robots.txt`, { timeoutMs: 5000, maxBytes: 200_000 });
    return res.status === 200 ? res.body : "";
  } catch (err) {
    if (err instanceof FetchBlockedError) throw err;
    return "";
  }
}
