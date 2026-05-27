import { z } from "zod";
import { webCrawler, CrawlOptions } from "../services/web-crawler.js";
import { contentCache } from "../utils/cache.js";

const CrawlInputSchema = z.object({
  url: z.string().url().describe("The starting URL to crawl from"),
  instructions: z.string().optional().describe("Natural language instructions for the crawl (e.g., 'Find all pages about Python SDK')"),
  max_depth: z.number().min(1).max(5).default(2).describe("Maximum depth to crawl from the starting URL"),
  max_breadth: z.number().min(1).max(50).default(20).describe("Maximum number of links to follow per page"),
  limit: z.number().min(1).max(200).default(50).describe("Maximum number of pages to crawl"),
  select_paths: z.array(z.string()).optional().describe("Only crawl paths matching these patterns"),
  select_domains: z.array(z.string()).optional().describe("Only crawl these domains"),
  exclude_paths: z.array(z.string()).optional().describe("Exclude paths matching these patterns"),
  exclude_domains: z.array(z.string()).optional().describe("Exclude these domains"),
  allow_external: z.boolean().default(false).describe("Allow crawling external domains"),
  include_images: z.boolean().default(false).describe("Include images from crawled pages"),
  extract_depth: z.enum(["basic", "advanced"]).default("basic").describe("Content extraction depth"),
});

export type CrawlInput = z.infer<typeof CrawlInputSchema>;

export const crawlToolDefinition = {
  name: "web_crawl",
  description: "Crawl a website starting from a URL, following links up to a specified depth. Can discover and extract content from multiple pages. Supports path and domain filtering for focused crawling.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: { type: "string", description: "The starting URL to crawl from" },
      instructions: { type: "string", description: "Natural language instructions for the crawl" },
      max_depth: { type: "number", minimum: 1, maximum: 5, default: 2, description: "Maximum depth to crawl" },
      max_breadth: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Maximum links per page" },
      limit: { type: "number", minimum: 1, maximum: 200, default: 50, description: "Maximum pages to crawl" },
      select_paths: { type: "array", items: { type: "string" }, description: "Only crawl matching paths" },
      select_domains: { type: "array", items: { type: "string" }, description: "Only crawl these domains" },
      exclude_paths: { type: "array", items: { type: "string" }, description: "Exclude matching paths" },
      exclude_domains: { type: "array", items: { type: "string" }, description: "Exclude these domains" },
      allow_external: { type: "boolean", default: false, description: "Allow external domains" },
      include_images: { type: "boolean", default: false, description: "Include images" },
      extract_depth: { type: "string", enum: ["basic", "advanced"], default: "basic", description: "Extraction depth" },
    },
    required: ["url"],
  },
};

export class CrawlTool {
  static async execute(input: CrawlInput) {
    const cacheKey = JSON.stringify(input);
    const cached = contentCache.get(cacheKey);
    if (cached) return cached;

    const options: CrawlOptions = {
      maxDepth: input.max_depth,
      maxBreadth: input.max_breadth,
      limit: input.limit,
      selectPaths: input.select_paths,
      selectDomains: input.select_domains,
      excludePaths: input.exclude_paths,
      excludeDomains: input.exclude_domains,
      allowExternal: input.allow_external,
      includeImages: input.include_images,
      extractDepth: input.extract_depth,
      instructions: input.instructions,
    };

    const result = await webCrawler.crawl(input.url, options);

    const response = {
      start_url: result.startUrl,
      pages: result.pages.map(page => ({
        url: page.url,
        title: page.title,
        content: page.content,
        depth: page.depth,
        links_count: page.links.length,
      })),
      total_pages: result.totalPages,
      errors: result.errors,
    };

    contentCache.set(cacheKey, response);
    return response;
  }
}
