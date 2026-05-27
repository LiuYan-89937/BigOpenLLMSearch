import axios from "axios";
import { parseHtml } from "../utils/html-parser.js";

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
}

export class SiteMapper {
  private visited = new Set<string>();
  private userAgent = "Mozilla/5.0 (compatible; WebSearchMCP/1.0)";

  async map(startUrl: string, options: MapOptions = {}): Promise<SiteMapResult> {
    const {
      maxDepth = 2,
      maxBreadth = 20,
      limit = 100,
      selectPaths,
      selectDomains,
      excludePaths,
      excludeDomains,
      allowExternal = false,
    } = options;

    this.visited.clear();
    const pages: SiteMapEntry[] = [];
    const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];

    const startDomain = new URL(startUrl).hostname;

    while (queue.length > 0 && pages.length < limit) {
      const batch = queue.splice(0, Math.min(maxBreadth, 5));
      
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
          const entry = await this.fetchPageInfo(url, depth);
          pages.push(entry);

          if (depth < maxDepth) {
            const links = await this.extractLinks(url);
            const newLinks = links
              .filter(link => !this.visited.has(link))
              .slice(0, maxBreadth);

            for (const link of newLinks) {
              queue.push({ url: link, depth: depth + 1 });
            }
          }
        } catch (error) {
          console.error(`Failed to fetch ${url}:`, error);
        }
      });

      await Promise.all(promises);
    }

    return {
      startUrl,
      pages,
      totalPages: pages.length,
    };
  }

  private async fetchPageInfo(url: string, depth: number): Promise<SiteMapEntry> {
    const response = await axios.get(url, {
      headers: { "User-Agent": this.userAgent },
      timeout: 15000,
      maxRedirects: 3,
    });

    const parsed = parseHtml(response.data, url);

    return {
      url,
      title: parsed.title,
      description: parsed.description,
      depth,
    };
  }

  private async extractLinks(url: string): Promise<string[]> {
    try {
      const response = await axios.get(url, {
        headers: { "User-Agent": this.userAgent },
        timeout: 15000,
        maxRedirects: 3,
      });

      const parsed = parseHtml(response.data, url);
      
      return parsed.links
        .map(link => {
          try {
            return new URL(link.href, url).href;
          } catch {
            return null;
          }
        })
        .filter((link): link is string => link !== null);
    } catch {
      return [];
    }
  }

  async discoverSitemap(baseUrl: string): Promise<string[]> {
    const sitemapUrls = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/sitemap-index.xml`,
      `${baseUrl}/sitemap.txt`,
    ];

    const discoveredUrls: string[] = [];

    for (const sitemapUrl of sitemapUrls) {
      try {
        const response = await axios.get(sitemapUrl, {
          headers: { "User-Agent": this.userAgent },
          timeout: 10000,
        });

        if (response.status === 200) {
          const content = response.data;
          
          if (typeof content === "string" && content.includes("<?xml")) {
            const urlMatches = content.match(/<loc>(.*?)<\/loc>/g);
            if (urlMatches) {
              urlMatches.forEach((match: string) => {
                const url = match.replace(/<\/?loc>/g, "");
                discoveredUrls.push(url);
              });
            }
          } else if (typeof content === "string") {
            const urls = content.split("\n").filter((line: string) => line.trim().startsWith("http"));
            discoveredUrls.push(...urls);
          }
        }
      } catch {
        continue;
      }
    }

    return discoveredUrls;
  }
}

export const siteMapper = new SiteMapper();
