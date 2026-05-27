import { z } from "zod";
import { siteMapper, MapOptions } from "../services/site-mapper.js";
import { contentCache } from "../utils/cache.js";

const MapInputSchema = z.object({
  url: z.string().url().describe("The starting URL to map"),
  instructions: z.string().optional().describe("Natural language instructions for mapping (e.g., 'Find all pages about API documentation')"),
  max_depth: z.number().min(1).max(5).default(2).describe("Maximum depth to explore from the starting URL"),
  max_breadth: z.number().min(1).max(50).default(20).describe("Maximum number of links to follow per page"),
  limit: z.number().min(1).max(500).default(100).describe("Maximum number of pages to discover"),
  select_paths: z.array(z.string()).optional().describe("Only include paths matching these patterns"),
  select_domains: z.array(z.string()).optional().describe("Only include these domains"),
  exclude_paths: z.array(z.string()).optional().describe("Exclude paths matching these patterns"),
  exclude_domains: z.array(z.string()).optional().describe("Exclude these domains"),
  allow_external: z.boolean().default(false).describe("Allow mapping external domains"),
});

export type MapInput = z.infer<typeof MapInputSchema>;

export const mapToolDefinition = {
  name: "web_map",
  description: "Generate a comprehensive site map by discovering all pages on a website. Explores the site structure like a graph to find documentation, product pages, and other content. Useful for understanding site organization.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: { type: "string", description: "The starting URL to map" },
      instructions: { type: "string", description: "Natural language instructions for mapping" },
      max_depth: { type: "number", minimum: 1, maximum: 5, default: 2, description: "Maximum depth to explore" },
      max_breadth: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Maximum links per page" },
      limit: { type: "number", minimum: 1, maximum: 500, default: 100, description: "Maximum pages to discover" },
      select_paths: { type: "array", items: { type: "string" }, description: "Only include matching paths" },
      select_domains: { type: "array", items: { type: "string" }, description: "Only include these domains" },
      exclude_paths: { type: "array", items: { type: "string" }, description: "Exclude matching paths" },
      exclude_domains: { type: "array", items: { type: "string" }, description: "Exclude these domains" },
      allow_external: { type: "boolean", default: false, description: "Allow external domains" },
    },
    required: ["url"],
  },
};

export class MapTool {
  static async execute(input: MapInput) {
    const cacheKey = JSON.stringify(input);
    const cached = contentCache.get(cacheKey);
    if (cached) return cached;

    const options: MapOptions = {
      maxDepth: input.max_depth,
      maxBreadth: input.max_breadth,
      limit: input.limit,
      selectPaths: input.select_paths,
      selectDomains: input.select_domains,
      excludePaths: input.exclude_paths,
      excludeDomains: input.exclude_domains,
      allowExternal: input.allow_external,
      instructions: input.instructions,
    };

    const [mapResult, sitemapUrls] = await Promise.all([
      siteMapper.map(input.url, options),
      siteMapper.discoverSitemap(input.url),
    ]);

    const response = {
      start_url: mapResult.startUrl,
      pages: mapResult.pages.map(page => ({
        url: page.url,
        title: page.title,
        description: page.description,
        depth: page.depth,
      })),
      total_pages: mapResult.totalPages,
      sitemap_urls: sitemapUrls,
    };

    contentCache.set(cacheKey, response);
    return response;
  }
}
