import { z } from "zod";
import { searchEngineManager, SearchOptions } from "../services/search-engines.js";
import { semanticSearch } from "../services/semantic-search.js";
import { contentExtractor } from "../services/content-extractor.js";
import { searchCache } from "../utils/cache.js";

const SearchInputSchema = z.object({
  query: z.string().describe("The search query to execute"),
  search_depth: z.enum(["basic", "advanced", "fast", "ultra-fast"]).default("basic").describe(
    "Controls latency vs relevance: 'advanced' for highest relevance, 'basic' for balanced, 'fast' for lower latency, 'ultra-fast' for minimum latency"
  ),
  topic: z.enum(["general", "news", "finance"]).default("general").describe(
    "Category of search: 'news' for real-time updates, 'finance' for financial data, 'general' for broader searches"
  ),
  max_results: z.number().min(1).max(20).default(5).describe("Maximum number of search results to return"),
  time_range: z.enum(["day", "week", "month", "year"]).optional().describe("Filter results by time range"),
  start_date: z.string().optional().describe("Return results after this date (YYYY-MM-DD format)"),
  end_date: z.string().optional().describe("Return results before this date (YYYY-MM-DD format)"),
  include_answer: z.boolean().default(false).describe("Include an LLM-generated answer to the query"),
  include_raw_content: z.boolean().default(false).describe("Include the full parsed content of each result"),
  include_images: z.boolean().default(false).describe("Include images in the response"),
  include_domains: z.array(z.string()).default([]).describe("Domains to specifically include in results"),
  exclude_domains: z.array(z.string()).default([]).describe("Domains to exclude from results"),
  country: z.string().optional().describe("Boost results from a specific country"),
  exact_match: z.boolean().default(false).describe("Only return results containing exact quoted phrases"),
  engine: z.string().optional().describe("Search engine to use (bing, google, duckduckgo, brave, serpapi, searxng)"),
  semantic: z.boolean().default(false).describe("Enable semantic search with relevance scoring"),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

export const searchToolDefinition = {
  name: "web_search",
  description: "Search the web for real-time information. Supports multiple search engines (Bing, Google, DuckDuckGo, Brave, SerpApi, SearXNG) with options for basic, advanced, fast, or ultra-fast search depths. Can include answers, images, and filter by domain, time range, and country.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "The search query to execute" },
      search_depth: { 
        type: "string", 
        enum: ["basic", "advanced", "fast", "ultra-fast"],
        default: "basic",
        description: "Controls latency vs relevance: 'advanced' for highest relevance, 'basic' for balanced, 'fast' for lower latency, 'ultra-fast' for minimum latency"
      },
      topic: {
        type: "string",
        enum: ["general", "news", "finance"],
        default: "general",
        description: "Category of search: 'news' for real-time updates, 'finance' for financial data, 'general' for broader searches"
      },
      max_results: { type: "number", minimum: 1, maximum: 20, default: 5, description: "Maximum number of search results to return" },
      time_range: { type: "string", enum: ["day", "week", "month", "year"], description: "Filter results by time range" },
      start_date: { type: "string", description: "Return results after this date (YYYY-MM-DD format)" },
      end_date: { type: "string", description: "Return results before this date (YYYY-MM-DD format)" },
      include_answer: { type: "boolean", default: false, description: "Include an LLM-generated answer to the query" },
      include_raw_content: { type: "boolean", default: false, description: "Include the full parsed content of each result" },
      include_images: { type: "boolean", default: false, description: "Include images in the response" },
      include_domains: { type: "array", items: { type: "string" }, default: [], description: "Domains to specifically include in results" },
      exclude_domains: { type: "array", items: { type: "string" }, default: [], description: "Domains to exclude from results" },
      country: { type: "string", description: "Boost results from a specific country" },
      exact_match: { type: "boolean", default: false, description: "Only return results containing exact quoted phrases" },
      engine: { type: "string", description: "Search engine to use (bing, google, duckduckgo, brave, serpapi, searxng)" },
      semantic: { type: "boolean", default: false, description: "Enable semantic search with relevance scoring" },
    },
    required: ["query"],
  },
};

export class SearchTool {
  static async execute(input: SearchInput) {
    const cacheKey = JSON.stringify(input);
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;

    let result: any;

    if (input.semantic) {
      result = await semanticSearch.search(input.query, {
        maxResults: input.max_results,
        searchDepth: input.search_depth,
        topic: input.topic,
        timeRange: input.time_range,
        startDate: input.start_date,
        endDate: input.end_date,
        includeAnswer: input.include_answer,
        includeRawContent: input.include_raw_content,
        includeImages: input.include_images,
        includeDomains: input.include_domains,
        excludeDomains: input.exclude_domains,
        country: input.country,
        exactMatch: input.exact_match,
        extractContent: input.include_raw_content,
      });
    } else {
      const searchOptions: SearchOptions = {
        maxResults: input.max_results,
        searchDepth: input.search_depth,
        topic: input.topic,
        timeRange: input.time_range,
        startDate: input.start_date,
        endDate: input.end_date,
        includeAnswer: input.include_answer,
        includeRawContent: input.include_raw_content,
        includeImages: input.include_images,
        includeDomains: input.include_domains,
        excludeDomains: input.exclude_domains,
        country: input.country,
        exactMatch: input.exact_match,
      };

      result = await searchEngineManager.search(input.query, {
        ...searchOptions,
        engine: input.engine,
      });

      if (input.include_raw_content && result.results.length > 0) {
        const urls = result.results.map((r: any) => r.url);
        const contents = await contentExtractor.extractMultiple(urls, {
          format: input.include_raw_content === true ? "markdown" : input.include_raw_content as any,
          extractDepth: input.search_depth === "advanced" ? "advanced" : "basic",
        });

        const contentMap = new Map(contents.map(c => [c.url, c]));
        result.results = result.results.map((r: any) => ({
          ...r,
          raw_content: contentMap.get(r.url)?.content,
        }));
      }
    }

    result.available_engines = searchEngineManager.getAvailableEngines();

    searchCache.set(cacheKey, result);
    return result;
  }
}
