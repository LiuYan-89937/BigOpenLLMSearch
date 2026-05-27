import { fetchText } from "../utils/http-client.js";
import { parseHtml } from "../utils/html-parser.js";
import { createInstructionMatcher } from "../utils/text-analysis.js";
import { matchesDomain, normalizeHttpUrl } from "../utils/url-policy.js";

export interface CrawlOptions {
  maxDepth?: number;
  maxBreadth?: number;
  limit?: number;
  selectPaths?: string[];
  selectDomains?: string[];
  excludePaths?: string[];
  excludeDomains?: string[];
  allowExternal?: boolean;
  includeImages?: boolean;
  extractDepth?: "basic" | "advanced";
  instructions?: string;
}

export interface CrawledPage {
  url: string;
  title: string;
  content: string;
  depth: number;
  links: string[];
  metadata: Record<string, string>;
  images?: string[];
}

export interface CrawlResult {
  startUrl: string;
  pages: CrawledPage[];
  totalPages: number;
  errors: Array<{ url: string; error: string }>;
}

interface CrawlQueueItem {
  url: string;
  depth: number;
}

interface CrawlContext extends Required<Pick<CrawlOptions, "maxDepth" | "maxBreadth" | "limit" | "allowExternal" | "includeImages" | "extractDepth">> {
  selectPaths?: string[];
  selectDomains?: string[];
  excludePaths?: string[];
  excludeDomains?: string[];
  startDomain: string;
  instructionMatcher: ReturnType<typeof createInstructionMatcher>;
}

export class WebCrawler {
  async crawl(startUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
    const normalizedStartUrl = normalizeHttpUrl(startUrl);
    if (!normalizedStartUrl) {
      throw new Error(`Invalid start URL: ${startUrl}`);
    }

    const context: CrawlContext = {
      maxDepth: options.maxDepth ?? 2,
      maxBreadth: options.maxBreadth ?? 10,
      limit: options.limit ?? 50,
      selectPaths: options.selectPaths,
      selectDomains: options.selectDomains,
      excludePaths: options.excludePaths,
      excludeDomains: options.excludeDomains,
      allowExternal: options.allowExternal ?? false,
      includeImages: options.includeImages ?? false,
      extractDepth: options.extractDepth ?? "basic",
      startDomain: new URL(normalizedStartUrl).hostname,
      instructionMatcher: createInstructionMatcher(options.instructions),
    };
    const visited = new Set<string>();
    const pages: CrawledPage[] = [];
    const errors: Array<{ url: string; error: string }> = [];
    const queue: CrawlQueueItem[] = [{ url: normalizedStartUrl, depth: 0 }];

    while (queue.length > 0 && pages.length < context.limit) {
      const batch = takeBatch(queue, visited, context);
      if (batch.length === 0) {
        continue;
      }

      const fetchedPages = await Promise.all(batch.map(item => this.fetchPage(item, context)));
      for (const result of fetchedPages) {
        if ("error" in result) {
          errors.push(result.error);
          continue;
        }

        if (pages.length >= context.limit) {
          break;
        }

        pages.push(result.page);

        if (result.page.depth < context.maxDepth) {
          queue.push(...rankLinks(result.links, context)
            .filter(link => !visited.has(link.url))
            .slice(0, context.maxBreadth)
            .map(link => ({ url: link.url, depth: result.page.depth + 1 })));
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

  private async fetchPage(
    item: CrawlQueueItem,
    context: CrawlContext
  ): Promise<{ page: CrawledPage; links: Array<{ url: string; text: string }> } | { error: { url: string; error: string } }> {
    try {
      const response = await fetchText(item.url);
      const parsed = parseHtml(response.body, response.url);
      const contentSource = parsed.content || parsed.text;
      const content = context.extractDepth === "advanced"
        ? contentSource
        : contentSource.substring(0, 2000);
      const links = parsed.links
        .map(link => ({
          url: normalizeHttpUrl(link.href, response.url),
          text: link.text,
        }))
        .filter((link): link is { url: string; text: string } => Boolean(link.url));

      return {
        page: {
          url: item.url,
          title: parsed.title,
          content,
          depth: item.depth,
          links: links.map(link => link.url),
          metadata: parsed.metadata,
          images: context.includeImages ? parsed.images.map(image => image.src) : undefined,
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

function takeBatch(queue: CrawlQueueItem[], visited: Set<string>, context: CrawlContext): CrawlQueueItem[] {
  const batch: CrawlQueueItem[] = [];

  while (queue.length > 0 && batch.length < context.maxBreadth) {
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

function shouldVisitUrl(url: string, context: CrawlContext): boolean {
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
  context: CrawlContext
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

export const webCrawler = new WebCrawler();
