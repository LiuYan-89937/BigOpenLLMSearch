import * as cheerio from "cheerio";
import { fetchText } from "../utils/http-client.js";
import { parseHtml } from "../utils/html-parser.js";
import { createInstructionMatcher } from "../utils/text-analysis.js";
import { matchesDomain, normalizeHttpUrl } from "../utils/url-policy.js";

export interface MapOptions {
  maxDepth?: number;
  maxBreadth?: number;
  limit?: number;
  selectPaths?: string[];
  selectDomains?: string[];
  excludePaths?: string[];
  excludeDomains?: string[];
  allowExternal?: boolean;
  instructions?: string;
}

export interface SiteMapEntry {
  url: string;
  title: string;
  description?: string;
  depth: number;
}

export interface SiteMapResult {
  startUrl: string;
  pages: SiteMapEntry[];
  totalPages: number;
  errors: Array<{ url: string; error: string }>;
}

interface MapQueueItem {
  url: string;
  depth: number;
}

interface MapContext extends Required<Pick<MapOptions, "maxDepth" | "maxBreadth" | "limit" | "allowExternal">> {
  selectPaths?: string[];
  selectDomains?: string[];
  excludePaths?: string[];
  excludeDomains?: string[];
  startDomain: string;
  instructionMatcher: ReturnType<typeof createInstructionMatcher>;
}

export class SiteMapper {
  async map(startUrl: string, options: MapOptions = {}): Promise<SiteMapResult> {
    const normalizedStartUrl = normalizeHttpUrl(startUrl);
    if (!normalizedStartUrl) {
      throw new Error(`Invalid start URL: ${startUrl}`);
    }

    const context: MapContext = {
      maxDepth: options.maxDepth ?? 2,
      maxBreadth: options.maxBreadth ?? 20,
      limit: options.limit ?? 100,
      selectPaths: options.selectPaths,
      selectDomains: options.selectDomains,
      excludePaths: options.excludePaths,
      excludeDomains: options.excludeDomains,
      allowExternal: options.allowExternal ?? false,
      startDomain: new URL(normalizedStartUrl).hostname,
      instructionMatcher: createInstructionMatcher(options.instructions),
    };
    const visited = new Set<string>();
    const pages: SiteMapEntry[] = [];
    const errors: Array<{ url: string; error: string }> = [];
    const queue: MapQueueItem[] = [{ url: normalizedStartUrl, depth: 0 }];

    while (queue.length > 0 && pages.length < context.limit) {
      const batch = takeBatch(queue, visited, context);
      if (batch.length === 0) {
        continue;
      }

      const fetchedPages = await Promise.all(batch.map(item => this.fetchPageInfo(item)));
      for (const result of fetchedPages) {
        if ("error" in result) {
          errors.push(result.error);
          continue;
        }

        if (pages.length >= context.limit) {
          break;
        }

        pages.push(result.entry);

        if (result.entry.depth < context.maxDepth) {
          queue.push(...rankLinks(result.links, context)
            .filter(link => !visited.has(link.url))
            .slice(0, context.maxBreadth)
            .map(link => ({ url: link.url, depth: result.entry.depth + 1 })));
        }
      }
    }

    return {
      startUrl: normalizedStartUrl,
      pages,
      totalPages: pages.length,
      errors,
    };
  }

  async discoverSitemap(baseUrl: string): Promise<string[]> {
    const normalizedBaseUrl = normalizeHttpUrl(baseUrl);
    if (!normalizedBaseUrl) {
      throw new Error(`Invalid base URL: ${baseUrl}`);
    }

    const origin = new URL(normalizedBaseUrl).origin;
    const sitemapUrls = [
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap-index.xml`,
      `${origin}/sitemap.txt`,
    ];
    const discoveredUrls = new Set<string>();

    for (const sitemapUrl of sitemapUrls) {
      try {
        const response = await fetchText(sitemapUrl, {
          timeoutMs: 10000,
          maxRedirects: 3,
          allowedContentTypes: [
            "application/xml",
            "text/xml",
            "text/plain",
            "text/html",
          ],
        });

        for (const url of extractSitemapLocations(response.body)) {
          discoveredUrls.add(url);
        }
      } catch {
        continue;
      }
    }

    return Array.from(discoveredUrls);
  }

  private async fetchPageInfo(
    item: MapQueueItem
  ): Promise<{ entry: SiteMapEntry; links: Array<{ url: string; text: string }> } | { error: { url: string; error: string } }> {
    try {
      const response = await fetchText(item.url, {
        timeoutMs: 15000,
        maxRedirects: 3,
      });
      const parsed = parseHtml(response.body, response.url);
      const links = parsed.links
        .map(link => ({
          url: normalizeHttpUrl(link.href, response.url),
          text: link.text,
        }))
        .filter((link): link is { url: string; text: string } => Boolean(link.url));

      return {
        entry: {
          url: item.url,
          title: parsed.title,
          description: parsed.description,
          depth: item.depth,
        },
        links,
      };
    } catch (error) {
      return {
        error: {
          url: item.url,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

function takeBatch(queue: MapQueueItem[], visited: Set<string>, context: MapContext): MapQueueItem[] {
  const batch: MapQueueItem[] = [];

  while (queue.length > 0 && batch.length < Math.min(context.maxBreadth, 5)) {
    const item = queue.shift();
    if (!item || visited.has(item.url) || item.depth > context.maxDepth) {
      continue;
    }

    if (!shouldVisitUrl(item.url, context)) {
      continue;
    }

    visited.add(item.url);
    batch.push(item);
  }

  return batch;
}

function shouldVisitUrl(url: string, context: MapContext): boolean {
  const parsed = new URL(url);
  if (!context.allowExternal && parsed.hostname !== context.startDomain) {
    return false;
  }

  if (context.excludeDomains?.length && matchesDomain(parsed.hostname, context.excludeDomains)) {
    return false;
  }

  if (context.selectDomains?.length && !matchesDomain(parsed.hostname, context.selectDomains)) {
    return false;
  }

  if (context.excludePaths?.some(path => parsed.pathname.includes(path))) {
    return false;
  }

  if (context.selectPaths?.length && !context.selectPaths.some(path => parsed.pathname.includes(path))) {
    return false;
  }

  return true;
}

function rankLinks(
  links: Array<{ url: string; text: string }>,
  context: MapContext
): Array<{ url: string; text: string }> {
  if (!context.instructionMatcher.hasInstructions) {
    return links;
  }

  return [...links].sort((a, b) => {
    const scoreA = context.instructionMatcher.score(`${a.text} ${a.url}`);
    const scoreB = context.instructionMatcher.score(`${b.text} ${b.url}`);
    return scoreB - scoreA;
  });
}

function extractSitemapLocations(content: string): string[] {
  if (content.trim().startsWith("<")) {
    const $ = cheerio.load(content, { xmlMode: true });
    return $("loc").map((_, element) => $(element).text().trim()).get().filter(Boolean);
  }

  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith("http://") || line.startsWith("https://"));
}

export const siteMapper = new SiteMapper();
