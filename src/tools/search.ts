import { z } from "zod";
import {
  searchEngineManager,
  SearchOptions,
  SUPPORTED_SEARCH_ENGINE_NAMES,
} from "../services/search-engines.js";
import { searchPipeline } from "../services/search-pipeline.js";
import { searchCache } from "../utils/cache.js";
import { parseToolInput } from "../utils/tool-input.js";

const availableSearchEngineNames = searchEngineManager.getAvailableEngines();

const SearchInputSchema = z.object({
  query: z.string().trim().min(1).describe("The search query to execute"),
  search_depth: z.enum(["basic", "advanced", "fast", "ultra-fast"]).default("basic").describe(
    "Controls latency vs relevance: 'advanced' for highest relevance, 'basic' for balanced, 'fast' for lower latency, 'ultra-fast' for minimum latency"
  ),
  topic: z.enum(["general", "news", "finance"]).default("general").describe(
    "Category of search: 'news' for real-time updates, 'finance' for financial data, 'general' for broader searches"
  ),
  max_results: z.number().min(1).max(20).default(5).describe("Maximum number of search results to return"),
  time_range: z.enum(["day", "week", "month", "year"]).optional().describe("Filter results by time range"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Return results after this date (YYYY-MM-DD format)"),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Return results before this date (YYYY-MM-DD format)"),
  include_answer: z.boolean().default(false).describe("Include an answer generated from search sources"),
  include_raw_content: z.boolean().default(false).describe("Include the full parsed content of each result"),
  include_images: z.boolean().default(false).describe("Include images in the response"),
  include_domains: z.array(z.string()).default([]).describe("Domains to specifically include in results"),
  exclude_domains: z.array(z.string()).default([]).describe("Domains to exclude from results"),
  country: z.string().optional().describe("Boost results from a specific country"),
  exact_match: z.boolean().default(false).describe("Only return results containing exact quoted phrases"),
  engine: z.enum(SUPPORTED_SEARCH_ENGINE_NAMES).optional().describe("Search engine to use"),
  engines: z.array(z.enum(SUPPORTED_SEARCH_ENGINE_NAMES)).optional().describe("Search engines to use for multi-provider recall"),
  language: z.string().optional().describe("Preferred search language, passed to engines that support it"),
  searxng_engines: z.array(z.string()).optional().describe("Specific SearXNG upstream engines to use"),
  safesearch: z.number().min(0).max(2).optional().describe("SearXNG safesearch level: 0, 1, or 2"),
  page_count: z.number().min(1).max(5).optional().describe("Number of SearXNG pages to recall"),
  max_recall_queries: z.number().min(1).max(6).optional().describe("Maximum number of recall queries produced by the query planner"),
  candidate_limit: z.number().min(1).max(200).optional().describe("Maximum fused candidates to rerank"),
  include_ranking_debug: z.boolean().default(false).describe("Include recall queries, matched chunks, and ranking signals"),
  semantic: z.boolean().default(false).describe("Enable content-aware reranking; embeddings are used when configured"),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

export const searchToolDefinition = {
  name: "web_search",
  description: "Search the web for real-time information through Tavily, SearXNG, DuckDuckGo, Bing, Google, Brave, or SerpApi. Results use one query-planning, multi-recall, RRF fusion, and content/vector reranking pipeline.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", minLength: 1, description: "The search query to execute" },
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
      include_answer: { type: "boolean", default: false, description: "Include an answer generated from search sources" },
      include_raw_content: { type: "boolean", default: false, description: "Include the full parsed content of each result" },
      include_images: { type: "boolean", default: false, description: "Include images in the response" },
      include_domains: { type: "array", items: { type: "string" }, default: [], description: "Domains to specifically include in results" },
      exclude_domains: { type: "array", items: { type: "string" }, default: [], description: "Domains to exclude from results" },
      country: { type: "string", description: "Boost results from a specific country" },
      exact_match: { type: "boolean", default: false, description: "Only return results containing exact quoted phrases" },
      engine: { type: "string", enum: availableSearchEngineNames, description: "Search engine to use" },
      engines: { type: "array", items: { type: "string", enum: availableSearchEngineNames }, description: "Search engines to use for multi-provider recall" },
      language: { type: "string", description: "Preferred search language, passed to engines that support it" },
      searxng_engines: { type: "array", items: { type: "string" }, description: "Specific SearXNG upstream engines to use" },
      safesearch: { type: "number", minimum: 0, maximum: 2, description: "SearXNG safesearch level: 0, 1, or 2" },
      page_count: { type: "number", minimum: 1, maximum: 5, description: "Number of SearXNG pages to recall" },
      max_recall_queries: { type: "number", minimum: 1, maximum: 6, description: "Maximum number of recall queries produced by the query planner" },
      candidate_limit: { type: "number", minimum: 1, maximum: 200, description: "Maximum fused candidates to rerank" },
      include_ranking_debug: { type: "boolean", default: false, description: "Include recall queries, matched chunks, and ranking signals" },
      semantic: { type: "boolean", default: false, description: "Enable content-aware reranking; embeddings are used when configured" },
    },
    required: ["query"],
  },
};

export class SearchTool {
  static async execute(rawInput: unknown) {
    const input = parseToolInput(SearchInputSchema, rawInput);
    const cacheKey = JSON.stringify(input);
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;

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
      engines: input.engines,
      language: input.language,
      searxngEngines: input.searxng_engines,
      safesearch: input.safesearch,
      pageCount: input.page_count,
      maxRecallQueries: input.max_recall_queries,
      candidateLimit: input.candidate_limit,
      includeRankingDebug: input.include_ranking_debug,
      semantic: input.semantic,
    };

    const result = await searchPipeline.search(input.query, {
      ...searchOptions,
      engine: input.engine,
    });

    result.available_engines = searchEngineManager.getAvailableEngines();

    searchCache.set(cacheKey, result);
    return result;
  }
}
