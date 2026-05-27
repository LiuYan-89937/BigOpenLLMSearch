import axios from "axios";
import { assertSafeHttpUrl, UrlPolicyOptions } from "./url-policy.js";

export interface FetchTextOptions extends UrlPolicyOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedContentTypes?: string[];
  headers?: Record<string, string>;
}

export interface FetchTextResult {
  url: string;
  body: string;
  contentType: string;
  status: number;
}

const DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; WebSearchMCP/1.0)";
const DEFAULT_ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
  "text/plain",
];

export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<FetchTextResult> {
  const maxRedirects = options.maxRedirects ?? 5;
  return fetchTextWithRedirects(url, options, maxRedirects);
}

async function fetchTextWithRedirects(
  url: string,
  options: FetchTextOptions,
  redirectsRemaining: number
): Promise<FetchTextResult> {
  const safeUrl = await assertSafeHttpUrl(url, options);
  const response = await axios.get(safeUrl, {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      "Accept-Language": "en-US,en;q=0.5",
      ...options.headers,
    },
    timeout: options.timeoutMs ?? 30000,
    maxRedirects: 0,
    maxContentLength: options.maxBytes ?? 2 * 1024 * 1024,
    maxBodyLength: options.maxBytes ?? 2 * 1024 * 1024,
    responseType: "text",
    transformResponse: [data => data],
    validateStatus: status => (status >= 200 && status < 400),
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.location;
    if (!location) {
      throw new Error(`Redirect response from ${safeUrl} did not include a location header`);
    }

    if (redirectsRemaining <= 0) {
      throw new Error(`Too many redirects while fetching ${safeUrl}`);
    }

    const nextUrl = new URL(location, safeUrl).href;
    return fetchTextWithRedirects(nextUrl, options, redirectsRemaining - 1);
  }

  const contentType = String(response.headers["content-type"] ?? "");
  ensureAllowedContentType(safeUrl, contentType, options.allowedContentTypes ?? DEFAULT_ALLOWED_CONTENT_TYPES);

  return {
    url: safeUrl,
    body: response.data,
    contentType,
    status: response.status,
  };
}

function ensureAllowedContentType(url: string, contentType: string, allowedContentTypes: string[]): void {
  if (!contentType) {
    return;
  }

  const normalized = contentType.split(";")[0].trim().toLowerCase();
  if (!allowedContentTypes.includes(normalized)) {
    throw new Error(`Unsupported content type for ${url}: ${contentType}`);
  }
}
