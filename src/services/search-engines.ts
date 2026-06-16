import axios from "axios";
import { buildSearchQuery, normalizeDomains } from "../utils/search-query.js";
import { scoreTextRelevance } from "../utils/text-analysis.js";
import { matchesDomain } from "../utils/url-policy.js";
import { loadEnvFile } from "../utils/env.js";
import { getSearchTopicProfile, SearchTopic } from "../config/search-topics.js";
import {
  ensureSearXNGRuntime,
  isSearXNGAutoStartEnabled,
  resolveSearXNGBaseUrl,
} from "./searxng-runtime.js";

loadEnvFile();

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  score?: number;
  publishedDate?: string;
  favicon?: string;
  images?: string[];
  engine?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  answer?: string;
  images?: string[];
  responseTime: number;
  totalResults?: number;
  engine?: string;
  engines?: string[];
  errors?: Array<{ engine: string; error: string }>;
}

export interface SearchOptions {
  maxResults?: number;
  searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
  topic?: SearchTopic;
  timeRange?: "day" | "week" | "month" | "year";
  startDate?: string;
  endDate?: string;
  includeAnswer?: boolean | "basic" | "advanced";
  includeRawContent?: boolean | "markdown" | "text";
  includeImages?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  country?: string;
  exactMatch?: boolean;
}

export interface SearchEngine {
  name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}

interface SearchContext {
  query: string;
  providerQuery: string;
  options: SearchOptions;
  startTime: number;
}

export class BingSearchEngine implements SearchEngine {
  name = "bing";

  constructor(private apiKey: string) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const context = createSearchContext(query, options);
    const topicProfile = getSearchTopicProfile(options.topic);
    const params: Record<string, unknown> = {
      q: context.providerQuery,
      count: Math.min(context.options.maxResults ?? 10, 50),
      responseFilter: topicProfile.nativeCategory === "news" ? "News" : "Webpages",
    };

    if (options.country) {
      params.cc = options.country.toUpperCase();
    }

    const freshness = mapBingFreshness(options.timeRange);
    if (freshness) {
      params.freshness = freshness;
    }

    const response = await axios.get("https://api.bing.microsoft.com/v7.0/search", {
      headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
      params,
    });

    const webResults = response.data.webPages?.value ?? [];
    const newsResults = response.data.news?.value ?? [];
    const results: SearchResult[] = [...webResults, ...newsResults].map((item: any) => ({
      title: item.name,
      url: item.url,
      snippet: item.snippet || item.description || "",
      favicon: item.deepLinks?.[0]?.thumbnailUrl,
      publishedDate: item.datePublished,
      images: item.image?.thumbnail?.contentUrl ? [item.image.thumbnail.contentUrl] : undefined,
      engine: this.name,
    }));

    return finalizeEngineResponse(context, this.name, results, response.data.webPages?.totalEstimatedMatches);
  }
}

export class GoogleSearchEngine implements SearchEngine {
  name = "google";

  constructor(
    private apiKey: string,
    private searchEngineId: string
  ) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const context = createSearchContext(query, options);
    const params: Record<string, unknown> = {
      key: this.apiKey,
      cx: this.searchEngineId,
      q: context.providerQuery,
      num: Math.min(context.options.maxResults ?? 10, 10),
    };

    const dateRestrict = mapGoogleDateRestrict(options.timeRange);
    if (dateRestrict) {
      params.dateRestrict = dateRestrict;
    }

    if (options.startDate || options.endDate) {
      params.sort = buildGoogleDateSort(options.startDate, options.endDate);
    }

    if (options.country) {
      params.gl = options.country.toLowerCase();
    }

    const response = await axios.get("https://www.googleapis.com/customsearch/v1", { params });
    const results: SearchResult[] = (response.data.items ?? []).map((item: any) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet || "",
      favicon: item.pagemap?.cse_thumbnail?.[0]?.src,
      images: item.pagemap?.cse_image?.map((img: any) => img.src),
      engine: this.name,
    }));

    return finalizeEngineResponse(
      context,
      this.name,
      results,
      Number.parseInt(response.data.searchInformation?.totalResults ?? "0", 10)
    );
  }
}

export class DuckDuckGoSearchEngine implements SearchEngine {
  name = "duckduckgo";

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const context = createSearchContext(query, options);
    const response = await axios.get("https://api.duckduckgo.com/", {
      params: {
        q: context.providerQuery,
        format: "json",
        no_html: 1,
        skip_disambig: 1,
      },
    });

    const results: SearchResult[] = [];

    if (response.data.AbstractText && response.data.AbstractURL) {
      results.push({
        title: response.data.Heading || query,
        url: response.data.AbstractURL,
        snippet: response.data.AbstractText,
        engine: this.name,
      });
    }

    for (const topic of flattenDuckDuckGoTopics(response.data.RelatedTopics ?? [])) {
      if (topic.FirstURL && topic.Text) {
        results.push({
          title: topic.Text.split(" - ")[0] || topic.Text.substring(0, 80),
          url: topic.FirstURL,
          snippet: topic.Text,
          engine: this.name,
        });
      }
    }

    return finalizeEngineResponse(context, this.name, results);
  }
}

export class BraveSearchEngine implements SearchEngine {
  name = "brave";

  constructor(private apiKey: string) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const context = createSearchContext(query, options);
    const topicProfile = getSearchTopicProfile(options.topic);
    const endpoint = topicProfile.nativeCategory === "news"
      ? "https://api.search.brave.com/res/v1/news/search"
      : "https://api.search.brave.com/res/v1/web/search";
    const params: Record<string, unknown> = {
      q: context.providerQuery,
      count: Math.min(context.options.maxResults ?? 10, 20),
    };

    const freshness = mapBraveFreshness(options.timeRange);
    if (freshness) {
      params.freshness = freshness;
    }

    if (options.country) {
      params.country = options.country.toUpperCase();
    }

    const response = await axios.get(endpoint, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.apiKey,
      },
      params,
    });

    const items = response.data.web?.results ?? response.data.results ?? response.data.news?.results ?? [];
    const results: SearchResult[] = items.map((item: any) => ({
      title: item.title,
      url: item.url,
      snippet: item.description || item.snippet || "",
      favicon: item.meta_url?.favicon,
      publishedDate: item.age || item.page_age,
      images: item.thumbnail?.src ? [item.thumbnail.src] : undefined,
      engine: this.name,
    }));

    return finalizeEngineResponse(context, this.name, results, response.data.web?.totalResults);
  }
}

export class SerpApiSearchEngine implements SearchEngine {
  name = "serpapi";

  constructor(private apiKey: string) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const context = createSearchContext(query, options);
    const params: Record<string, unknown> = {
      api_key: this.apiKey,
      q: context.providerQuery,
      engine: "google",
      num: Math.min(context.options.maxResults ?? 10, 100),
    };

    if (options.country) {
      params.gl = options.country.toLowerCase();
    }

    const timeRange = mapSerpApiTimeRange(options.timeRange);
    if (timeRange) {
      params.tbs = timeRange;
    }

    const response = await axios.get("https://serpapi.com/search", { params });
    const results: SearchResult[] = (response.data.organic_results ?? []).map((item: any) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet || "",
      favicon: item.favicon,
      publishedDate: item.date,
      score: item.position,
      engine: this.name,
    }));
    const answer = response.data.answer_box?.answer || response.data.answer_box?.snippet;

    return {
      ...finalizeEngineResponse(
        context,
        this.name,
        results,
        response.data.search_information?.total_results
      ),
      answer,
    };
  }
}

export class SearXNGSearchEngine implements SearchEngine {
  name = "searxng";

  constructor(private baseUrl: string) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const context = createSearchContext(query, options);
    const topicProfile = getSearchTopicProfile(options.topic);
    const params: Record<string, unknown> = {
      q: context.providerQuery,
      format: "json",
      pageno: 1,
    };

    if (topicProfile.nativeCategory === "news") {
      params.categories = "news";
    }

    if (options.timeRange) {
      params.time_range = options.timeRange;
    }

    const response = await axios.get(`${this.baseUrl.replace(/\/$/, "")}/search`, { params });
    const results: SearchResult[] = (response.data.results ?? []).map((item: any) => ({
      title: item.title,
      url: item.url,
      snippet: item.content || "",
      publishedDate: item.publishedDate,
      score: item.score,
      engine: this.name,
    }));

    return finalizeEngineResponse(context, this.name, results, response.data.number_of_results);
  }
}

export class SearchEngineManager {
  private engines: Map<string, SearchEngine> = new Map();
  private defaultEngine: string;

  constructor() {
    this.engines.set("duckduckgo", new DuckDuckGoSearchEngine());

    if (process.env.BING_API_KEY) {
      this.engines.set("bing", new BingSearchEngine(process.env.BING_API_KEY));
    }

    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
      this.engines.set("google", new GoogleSearchEngine(
        process.env.GOOGLE_API_KEY,
        process.env.GOOGLE_SEARCH_ENGINE_ID
      ));
    }

    if (process.env.BRAVE_API_KEY) {
      this.engines.set("brave", new BraveSearchEngine(process.env.BRAVE_API_KEY));
    }

    if (process.env.SERPAPI_API_KEY) {
      this.engines.set("serpapi", new SerpApiSearchEngine(process.env.SERPAPI_API_KEY));
    }

    if (process.env.SEARXNG_URL || isSearXNGAutoStartEnabled()) {
      this.engines.set("searxng", new SearXNGSearchEngine(resolveSearXNGBaseUrl()));
    }

    this.defaultEngine = selectDefaultEngine(process.env.DEFAULT_SEARCH_ENGINE, this.engines);
  }

  getEngine(name?: string): SearchEngine {
    const engineName = name || this.defaultEngine;
    const engine = this.engines.get(engineName);
    if (!engine) {
      throw new Error(`Search engine '${engineName}' not available. Available engines: ${this.getAvailableEngines().join(", ")}`);
    }

    return engine;
  }

  getAvailableEngines(): string[] {
    return Array.from(this.engines.keys());
  }

  async search(query: string, options: SearchOptions & { engine?: string } = {}): Promise<SearchResponse> {
    const requestedMaxResults = options.maxResults ?? 10;
    const engine = this.getEngine(options.engine);
    await this.ensureEngineReady(engine.name);
    const response = await engine.search(query, {
      ...options,
      maxResults: candidateLimit(requestedMaxResults, options),
    });
    const filteredResults = rankResults(
      filterResults(response.results, query, options),
      query,
      options
    ).slice(0, requestedMaxResults);
    const results = options.includeImages
      ? filteredResults
      : filteredResults.map(({ images, ...result }) => result);

    return {
      ...response,
      query,
      results,
      images: options.includeImages ? collectImages(results) : undefined,
      answer: options.includeAnswer ? response.answer : undefined,
      engine: engine.name,
    };
  }

  async multiSearch(query: string, options: SearchOptions & { engines?: string[] } = {}): Promise<SearchResponse> {
    const startedAt = Date.now();
    const engineNames = options.engines?.length ? options.engines : [this.defaultEngine];
    const responses = await Promise.all(engineNames.map(async engineName => {
      try {
        return await this.search(query, { ...options, engine: engineName });
      } catch (error) {
        return {
          query,
          results: [],
          responseTime: 0,
          engine: engineName,
          errors: [{
            engine: engineName,
            error: error instanceof Error ? error.message : String(error),
          }],
        } satisfies SearchResponse;
      }
    }));

    const allResults: SearchResult[] = [];
    const seenUrls = new Set<string>();
    const errors = responses.flatMap(response => response.errors ?? []);

    for (const response of responses) {
      for (const result of response.results) {
        if (!seenUrls.has(result.url)) {
          seenUrls.add(result.url);
          allResults.push(result);
        }
      }
    }

    return {
      query,
      results: allResults.slice(0, options.maxResults ?? 20),
      images: collectImages(allResults),
      responseTime: (Date.now() - startedAt) / 1000,
      engines: engineNames,
      errors: errors.length ? errors : undefined,
    };
  }

  private async ensureEngineReady(engineName: string): Promise<void> {
    if (engineName === "searxng") {
      await ensureSearXNGRuntime();
    }
  }
}

function selectDefaultEngine(configuredEngine: string | undefined, engines: Map<string, SearchEngine>): string {
  const normalizedEngine = configuredEngine?.trim().toLowerCase();
  if (normalizedEngine && engines.has(normalizedEngine)) {
    return normalizedEngine;
  }

  if (engines.has("searxng")) {
    return "searxng";
  }

  return "duckduckgo";
}

function createSearchContext(query: string, options: SearchOptions): SearchContext {
  return {
    query,
    providerQuery: buildSearchQuery(query, options),
    options,
    startTime: Date.now(),
  };
}

function finalizeEngineResponse(
  context: SearchContext,
  engine: string,
  results: SearchResult[],
  totalResults?: number
): SearchResponse {
  return {
    query: context.query,
    results: results.slice(0, context.options.maxResults ?? 10),
    responseTime: (Date.now() - context.startTime) / 1000,
    totalResults,
    images: collectImages(results),
    engine,
  };
}

function candidateLimit(maxResults: number, options: SearchOptions): number {
  const multiplier = candidateMultiplier(options);
  return Math.min(Math.max(maxResults * multiplier, maxResults), 50);
}

function candidateMultiplier(options: SearchOptions): number {
  if (hasResultFilters(options)) {
    return 2;
  }

  switch (options.searchDepth) {
    case "advanced":
      return 3;
    case "basic":
      return 2;
    case "fast":
    case "ultra-fast":
    default:
      return 1;
  }
}

function hasResultFilters(options: SearchOptions): boolean {
  return Boolean(options.exactMatch || options.includeDomains?.length || options.excludeDomains?.length);
}

function filterResults(results: SearchResult[], query: string, options: SearchOptions): SearchResult[] {
  const includeDomains = normalizeDomains(options.includeDomains);
  const excludeDomains = normalizeDomains(options.excludeDomains);
  const exactPhrase = query.trim().toLowerCase();

  return results.filter(result => {
    let hostname: string;
    try {
      hostname = new URL(result.url).hostname;
    } catch {
      return false;
    }

    if (includeDomains.length && !matchesDomain(hostname, includeDomains)) {
      return false;
    }

    if (excludeDomains.length && matchesDomain(hostname, excludeDomains)) {
      return false;
    }

    if (options.exactMatch) {
      const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
      if (!haystack.includes(exactPhrase)) {
        return false;
      }
    }

    return true;
  });
}

function rankResults(results: SearchResult[], query: string, options: SearchOptions): SearchResult[] {
  if (options.searchDepth === "ultra-fast") {
    return results;
  }

  return [...results].sort((a, b) => {
    const scoreA = combinedResultScore(a, query, options);
    const scoreB = combinedResultScore(b, query, options);
    return scoreB - scoreA;
  });
}

function combinedResultScore(result: SearchResult, query: string, options: SearchOptions): number {
  const relevanceScore = scoreTextRelevance(query, [
    { text: result.title, weight: 0.45 },
    { text: result.snippet, weight: 0.35 },
    { text: result.url, weight: 0.2 },
  ]);
  const topicTerms = getSearchTopicProfile(options.topic).rankingTerms;
  const topicScore = topicTerms.length > 0
    ? scoreTextRelevance(topicTerms.join(" "), [
      { text: result.title, weight: 0.5 },
      { text: result.snippet, weight: 0.35 },
      { text: result.url, weight: 0.15 },
    ])
    : 0;
  const providerScore = result.score ? 1 / Math.max(result.score, 1) : 0;

  if (options.searchDepth === "advanced") {
    return (relevanceScore * 0.75) + (topicScore * 0.1) + (providerScore * 0.15);
  }

  return (relevanceScore * 0.65) + (topicScore * 0.05) + (providerScore * 0.3);
}

function collectImages(results: SearchResult[]): string[] | undefined {
  const images = Array.from(new Set(results.flatMap(result => result.images ?? [])));
  return images.length ? images : undefined;
}

function mapBingFreshness(timeRange?: SearchOptions["timeRange"]): string | undefined {
  switch (timeRange) {
    case "day": return "Day";
    case "week": return "Week";
    case "month": return "Month";
    case "year": return "Year";
    default: return undefined;
  }
}

function mapGoogleDateRestrict(timeRange?: SearchOptions["timeRange"]): string | undefined {
  switch (timeRange) {
    case "day": return "d1";
    case "week": return "w1";
    case "month": return "m1";
    case "year": return "y1";
    default: return undefined;
  }
}

function buildGoogleDateSort(startDate?: string, endDate?: string): string | undefined {
  const start = startDate?.replace(/-/g, "") ?? "";
  const end = endDate?.replace(/-/g, "") ?? "";

  if (!start && !end) {
    return undefined;
  }

  return `date:r:${start}:${end}`;
}

function mapBraveFreshness(timeRange?: SearchOptions["timeRange"]): string | undefined {
  switch (timeRange) {
    case "day": return "pd";
    case "week": return "pw";
    case "month": return "pm";
    case "year": return "py";
    default: return undefined;
  }
}

function mapSerpApiTimeRange(timeRange?: SearchOptions["timeRange"]): string | undefined {
  switch (timeRange) {
    case "day": return "qdr:d";
    case "week": return "qdr:w";
    case "month": return "qdr:m";
    case "year": return "qdr:y";
    default: return undefined;
  }
}

function flattenDuckDuckGoTopics(topics: any[]): any[] {
  return topics.flatMap(topic => {
    if (Array.isArray(topic.Topics)) {
      return flattenDuckDuckGoTopics(topic.Topics);
    }

    return [topic];
  });
}

export const searchEngineManager = new SearchEngineManager();
