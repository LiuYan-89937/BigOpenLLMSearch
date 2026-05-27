import axios from "axios";
import { parseHtml, ParsedContent } from "../utils/html-parser.js";

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
}

export interface CrawlResult {
  startUrl: string;
  pages: CrawledPage[];
  totalPages: number;
  errors: Array<{ url: string; error: string }>;
}

export class WebCrawler {
  private visited = new Set<string>();
  private userAgent = "Mozilla/5.0 (compatible; WebSearchMCP/1.0)";

  async crawl(startUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
    const {
      maxDepth = 2,
      maxBreadth = 10,
      limit = 50,
      selectPaths,
      selectDomains,
      excludePaths,
      excludeDomains,
      allowExternal = false,
      includeImages = false,
      extractDepth = "basic",
    } = options;

    this.visited.clear();
    const pages: CrawledPage[] = [];
    const errors: Array<{ url: string; error: string }> = [];
    const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];

    const startDomain = new URL(startUrl).hostname;

    while (queue.length > 0 && pages.length < limit) {
      const batch = queue.splice(0, maxBreadth);
      
      const promises = batch.map(async ({ url, depth }) => {
        if (this.visited.has(url)) return;
        if (depth > maxDepth) return;
        if (pages.length >= limit) return;

        const urlObj = new URL(url);
        const domain = urlObj.hostname;

        if (!allowExternal && domain !== startDomain) return;

        if (excludeDomains?.some(d => domain.includes(d))) return;
        if (selectDomains?.length && !selectDomains.some(d => domain.includes(d))) return;

        const path = urlObj.pathname;
        if (excludePaths?.some(p => path.includes(p))) return;
        if (selectPaths?.length && !selectPaths.some(p => path.includes(p))) return;

        this.visited.add(url);

        try {
          const page = await this.fetchPage(url, depth, extractDepth);
          pages.push(page);

          if (depth < maxDepth) {
            const newLinks = page.links
              .filter(link => !this.visited.has(link))
              .slice(0, maxBreadth);

            for (const link of newLinks) {
              queue.push({ url: link, depth: depth + 1 });
            }
          }
        } catch (error) {
          errors.push({
            url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      await Promise.all(promises);
    }

    return {
      startUrl,
      pages,
      totalPages: pages.length,
      errors,
    };
  }

  private async fetchPage(url: string, depth: number, extractDepth: string): Promise<CrawledPage> {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": this.userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 30000,
      maxRedirects: 5,
    });

    const html = response.data;
    const parsed = parseHtml(html, url);

    const links = parsed.links
      .map(link => {
        try {
          return new URL(link.href, url).href;
        } catch {
          return null;
        }
      })
      .filter((link): link is string => link !== null);

    const content = extractDepth === "advanced" 
      ? parsed.content 
      : parsed.content.substring(0, 2000);

    return {
      url,
      title: parsed.title,
      content,
      depth,
      links,
      metadata: parsed.metadata,
    };
  }
}

export const webCrawler = new WebCrawler();
