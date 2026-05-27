import axios from "axios";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  score?: number;
  publishedDate?: string;
  favicon?: string;
  images?: string[];
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  answer?: string;
  images?: string[];
  responseTime: number;
  totalResults?: number;
}

export interface SearchOptions {
  maxResults?: number;
  searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
  topic?: "general" | "news" | "finance";
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

export class BingSearchEngine implements SearchEngine {
  name = "bing";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const startTime = Date.now();
    const { maxResults = 10, timeRange, startDate, endDate } = options;

    const params: any = {
      q: query,
      count: maxResults,
      mkt: options.country ? `${options.country}-${options.country.toUpperCase()}` : "en-US",
      responseFilter: "Webpages",
    };

    if (timeRange) {
      const now = new Date();
      let freshness: string;
      switch (timeRange) {
        case "day": freshness = "Day"; break;
        case "week": freshness = "Week"; break;
        case "month": freshness = "Month"; break;
        case "year": freshness = "Year"; break;
        default: freshness = "";
      }
      if (freshness) params.freshness = freshness;
    }

    try {
      const response = await axios.get("https://api.bing.microsoft.com/v7.0/search", {
        headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
        params,
      });

      const results: SearchResult[] = (response.data.webPages?.value || []).map((item: any) => ({
        title: item.name,
        url: item.url,
        snippet: item.snippet,
        content: options.includeRawContent ? undefined : undefined,
        favicon: item.deepLinks?.[0]?.thumbnailUrl,
      }));

      return {
        query,
        results,
        responseTime: (Date.now() - startTime) / 1000,
        totalResults: response.data.webPages?.totalEstimatedMatches,
      };
    } catch (error) {
      throw new Error(`Bing search failed: ${error}`);
    }
  }
}

export class GoogleSearchEngine implements SearchEngine {
  name = "google";
  private apiKey: string;
  private searchEngineId: string;

  constructor(apiKey: string, searchEngineId: string) {
    this.apiKey = apiKey;
    this.searchEngineId = searchEngineId;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const startTime = Date.now();
    const { maxResults = 10, timeRange, startDate, endDate } = options;

    const params: any = {
      key: this.apiKey,
      cx: this.searchEngineId,
      q: query,
      num: maxResults,
    };

    if (timeRange) {
      const now = new Date();
      let dateRestrict: string;
      switch (timeRange) {
        case "day": dateRestrict = "d1"; break;
        case "week": dateRestrict = "w1"; break;
        case "month": dateRestrict = "m1"; break;
        case "year": dateRestrict = "y1"; break;
        default: dateRestrict = "";
      }
      if (dateRestrict) params.dateRestrict = dateRestrict;
    }

    if (startDate) {
      params.sort = `date:r:${startDate.replace(/-/g, "")}:`;
    }

    try {
      const response = await axios.get("https://www.googleapis.com/customsearch/v1", { params });

      const results: SearchResult[] = (response.data.items || []).map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        favicon: item.pagemap?.cse_thumbnail?.[0]?.src,
        images: item.pagemap?.cse_image?.map((img: any) => img.src),
      }));

      return {
        query,
        results,
        responseTime: (Date.now() - startTime) / 1000,
        totalResults: parseInt(response.data.searchInformation?.totalResults || "0"),
      };
    } catch (error) {
      throw new Error(`Google search failed: ${error}`);
    }
  }
}

export class DuckDuckGoSearchEngine implements SearchEngine {
  name = "duckduckgo";

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const startTime = Date.now();
    const { maxResults = 10 } = options;

    try {
      const response = await axios.get("https://api.duckduckgo.com/", {
        params: {
          q: query,
          format: "json",
          no_html: 1,
          skip_disambig: 1,
        },
      });

      const results: SearchResult[] = [];

      if (response.data.AbstractText) {
        results.push({
          title: response.data.Heading || query,
          url: response.data.AbstractURL,
          snippet: response.data.AbstractText,
        });
      }

      (response.data.RelatedTopics || []).slice(0, maxResults - results.length).forEach((topic: any) => {
        if (topic.FirstURL && topic.Text) {
          results.push({
            title: topic.Text.split(" - ")[0] || topic.Text.substring(0, 50),
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      });

      return {
        query,
        results,
        responseTime: (Date.now() - startTime) / 1000,
      };
    } catch (error) {
      throw new Error(`DuckDuckGo search failed: ${error}`);
    }
  }
}

export class BraveSearchEngine implements SearchEngine {
  name = "brave";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const startTime = Date.now();
    const { maxResults = 10, timeRange, country } = options;

    const params: any = {
      q: query,
      count: maxResults,
    };

    if (timeRange) {
      switch (timeRange) {
        case "day": params.freshness = "pd"; break;
        case "week": params.freshness = "pw"; break;
        case "month": params.freshness = "pm"; break;
        case "year": params.freshness = "py"; break;
      }
    }

    if (country) {
      params.country = country;
    }

    try {
      const response = await axios.get("https://api.search.brave.com/res/v1/web/search", {
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": this.apiKey,
        },
        params,
      });

      const results: SearchResult[] = (response.data.web?.results || []).map((item: any) => ({
        title: item.title,
        url: item.url,
        snippet: item.description,
        favicon: item.meta_url?.favicon,
        publishedDate: item.age,
      }));

      return {
        query,
        results,
        responseTime: (Date.now() - startTime) / 1000,
        totalResults: response.data.web?.totalResults,
      };
    } catch (error) {
      throw new Error(`Brave search failed: ${error}`);
    }
  }
}

export class SerpApiSearchEngine implements SearchEngine {
  name = "serpapi";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const startTime = Date.now();
    const { maxResults = 10, timeRange, country, includeDomains, excludeDomains } = options;

    const params: any = {
      api_key: this.apiKey,
      q: query,
      engine: "google",
      num: maxResults,
    };

    if (country) {
      params.gl = country;
    }

    if (timeRange) {
      switch (timeRange) {
        case "day": params.tbs = "qdr:d"; break;
        case "week": params.tbs = "qdr:w"; break;
        case "month": params.tbs = "qdr:m"; break;
        case "year": params.tbs = "qdr:y"; break;
      }
    }

    if (includeDomains?.length) {
      params.q += ` site:${includeDomains.join(" OR site:")}`;
    }

    if (excludeDomains?.length) {
      excludeDomains.forEach(domain => {
        params.q += ` -site:${domain}`;
      });
    }

    try {
      const response = await axios.get("https://serpapi.com/search", { params });

      const results: SearchResult[] = (response.data.organic_results || []).map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        favicon: item.favicon,
        publishedDate: item.date,
        score: item.position,
      }));

      let answer: string | undefined;
      if (response.data.answer_box) {
        answer = response.data.answer_box.answer || response.data.answer_box.snippet;
      }

      return {
        query,
        results,
        answer,
        responseTime: (Date.now() - startTime) / 1000,
        totalResults: response.data.search_information?.total_results,
      };
    } catch (error) {
      throw new Error(`SerpApi search failed: ${error}`);
    }
  }
}

export class SearXNGSearchEngine implements SearchEngine {
  name = "searxng";
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const startTime = Date.now();
    const { maxResults = 10, timeRange } = options;

    const params: any = {
      q: query,
      format: "json",
      pageno: 1,
    };

    if (timeRange) {
      switch (timeRange) {
        case "day": params.time_range = "day"; break;
        case "week": params.time_range = "week"; break;
        case "month": params.time_range = "month"; break;
        case "year": params.time_range = "year"; break;
      }
    }

    try {
      const response = await axios.get(`${this.baseUrl}/search`, { params });

      const results: SearchResult[] = (response.data.results || []).slice(0, maxResults).map((item: any) => ({
        title: item.title,
        url: item.url,
        snippet: item.content,
        publishedDate: item.publishedDate,
        score: item.score,
      }));

      return {
        query,
        results,
        responseTime: (Date.now() - startTime) / 1000,
        totalResults: response.data.number_of_results,
      };
    } catch (error) {
      throw new Error(`SearXNG search failed: ${error}`);
    }
  }
}

export class SearchEngineManager {
  private engines: Map<string, SearchEngine> = new Map();
  private defaultEngine: string;

  constructor() {
    this.defaultEngine = "duckduckgo";
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

    if (process.env.SEARXNG_URL) {
      this.engines.set("searxng", new SearXNGSearchEngine(process.env.SEARXNG_URL));
    }
  }

  getEngine(name?: string): SearchEngine {
    const engineName = name || this.defaultEngine;
    const engine = this.engines.get(engineName);
    if (!engine) {
      throw new Error(`Search engine '${engineName}' not available. Available engines: ${Array.from(this.engines.keys()).join(", ")}`);
    }
    return engine;
  }

  getAvailableEngines(): string[] {
    return Array.from(this.engines.keys());
  }

  async search(query: string, options: SearchOptions & { engine?: string } = {}): Promise<SearchResponse> {
    const engine = this.getEngine(options.engine);
    return engine.search(query, options);
  }

  async multiSearch(query: string, options: SearchOptions & { engines?: string[] } = {}): Promise<SearchResponse> {
    const engines = options.engines || [this.defaultEngine];
    const searchPromises = engines.map(engineName => {
      const engine = this.getEngine(engineName);
      return engine.search(query, options).catch(error => ({
        query,
        results: [],
        responseTime: 0,
        error: error.message,
      }));
    });

    const responses = await Promise.all(searchPromises);
    
    const allResults: SearchResult[] = [];
    const seenUrls = new Set<string>();

    for (const response of responses) {
      if ('results' in response) {
        for (const result of response.results) {
          if (!seenUrls.has(result.url)) {
            seenUrls.add(result.url);
            allResults.push(result);
          }
        }
      }
    }

    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));

    return {
      query,
      results: allResults.slice(0, options.maxResults || 20),
      responseTime: Math.max(...responses.map(r => r.responseTime)),
    };
  }
}

export const searchEngineManager = new SearchEngineManager();
