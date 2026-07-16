const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "mc_cid",
  "mc_eid",
  "igshid",
]);

export function canonicalizeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if ((parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")) {
      parsed.port = "";
    }

    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isTrackingParam(key)) {
        parsed.searchParams.delete(key);
      }
    }

    parsed.searchParams.sort();
    parsed.pathname = normalizePathname(parsed.pathname);

    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizePathname(pathname: string): string {
  if (pathname === "/") {
    return "/";
  }

  return pathname.replace(/\/+$/, "");
}

function isTrackingParam(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return TRACKING_PARAMS.has(normalizedKey) ||
    TRACKING_PARAM_PREFIXES.some(prefix => normalizedKey.startsWith(prefix));
}
