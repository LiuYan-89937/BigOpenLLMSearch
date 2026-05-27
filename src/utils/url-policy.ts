import dns from "node:dns/promises";
import net from "node:net";

export interface UrlPolicyOptions {
  allowPrivateHosts?: boolean;
}

const hostSafetyCache = new Map<string, Promise<void>>();

export async function assertSafeHttpUrl(input: string, options: UrlPolicyOptions = {}): Promise<string> {
  const url = parseHttpUrl(input);

  if (!options.allowPrivateHosts) {
    await assertPublicHost(url.hostname);
  }

  url.hash = "";
  return url.href;
}

export function normalizeHttpUrl(input: string, baseUrl?: string): string | undefined {
  try {
    const url = baseUrl ? new URL(input, baseUrl) : new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) {
      return undefined;
    }

    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

export function matchesDomain(hostname: string, domains?: string[]): boolean {
  if (!domains?.length) {
    return true;
  }

  const normalizedHost = hostname.toLowerCase().replace(/^www\./, "");
  return domains.some(domain => {
    const normalizedDomain = normalizeDomainFilter(domain);
    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
  });
}

function parseHttpUrl(input: string): URL {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported URL protocol for ${input}`);
  }

  if (!url.hostname) {
    throw new Error(`URL is missing a hostname: ${input}`);
  }

  return url;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const cacheKey = hostname.toLowerCase();
  let cached = hostSafetyCache.get(cacheKey);

  if (!cached) {
    cached = resolveAndValidateHost(hostname);
    hostSafetyCache.set(cacheKey, cached);
  }

  await cached;
}

async function resolveAndValidateHost(hostname: string): Promise<void> {
  const normalized = hostname.toLowerCase();

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    throw new Error(`Private or local host is not allowed: ${hostname}`);
  }

  if (net.isIP(normalized)) {
    assertPublicAddress(normalized, hostname);
    return;
  }

  const addresses = await dns.lookup(normalized, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`Host could not be resolved: ${hostname}`);
  }

  for (const address of addresses) {
    assertPublicAddress(address.address, hostname);
  }
}

function assertPublicAddress(address: string, hostname: string): void {
  if (isPrivateAddress(address)) {
    throw new Error(`Private or local address is not allowed for ${hostname}`);
  }
}

function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    return isPrivateIPv4(address);
  }

  if (version === 6) {
    return isPrivateIPv6(address);
  }

  return true;
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part))) {
    return true;
  }

  const [first, second] = parts;
  return first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 0) ||
    (first >= 224);
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:");
}

function normalizeDomainFilter(domain: string): string {
  const trimmed = domain.trim().toLowerCase();
  try {
    const parsed = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "").replace(/\/.*$/, "");
  }
}
