import { searchEngineManager, SearchOptions } from "./search-engines.js";
import { contentExtractor } from "./content-extractor.js";
import {
  extractKeyPhrases,
  generateExtractiveAnswer,
  scoreTextRelevance,
} from "../utils/text-analysis.js";
import { answerGenerator } from "./answer-generator.js";

export interface SemanticSearchOptions extends SearchOptions {
  engine?: string;
  extractContent?: boolean;
  maxContentLength?: number;
  relevanceThreshold?: number;
}

export interface SemanticSearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  relevanceScore: number;
  keyPhrases: string[];
  engine?: string;
}

export interface SemanticSearchResponse {
  query: string;
  results: SemanticSearchResult[];
  answer?: string;
  responseTime: number;
}

export class SemanticSearch {
  async search(query: string, options: SemanticSearchOptions = {}): Promise<SemanticSearchResponse> {
    const startTime = Date.now();
    const {
      extractContent = false,
      maxContentLength = 2000,
      relevanceThreshold = 0.25,
      maxResults = 10,
      ...searchOptions
    } = options;

    const searchResponse = await searchEngineManager.search(query, {
      ...searchOptions,
      maxResults: maxResults * 2,
    });

    let results: SemanticSearchResult[] = searchResponse.results.map(result => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      relevanceScore: scoreTextRelevance(query, [
        { text: result.title, weight: 0.45 },
        { text: result.snippet, weight: 0.35 },
        { text: result.url, weight: 0.2 },
      ]),
      keyPhrases: extractKeyPhrases(`${result.title} ${result.snippet}`),
      engine: result.engine,
    }));

    if (extractContent && results.length > 0) {
      const contents = await contentExtractor.extractMultiple(results.map(result => result.url), {
        format: "text",
        extractDepth: "basic",
      });
      const contentMap = new Map(contents.map(content => [content.url, content.content]));

      results = results.map(result => {
        const content = contentMap.get(result.url);
        const contentSnippet = content?.substring(0, maxContentLength);
        const relevanceScore = scoreTextRelevance(query, [
          { text: result.title, weight: 0.35 },
          { text: result.snippet, weight: 0.25 },
          { text: contentSnippet, weight: 0.4 },
        ]);

        return {
          ...result,
          content: contentSnippet,
          relevanceScore,
          keyPhrases: extractKeyPhrases(`${result.title} ${result.snippet} ${contentSnippet ?? ""}`),
        };
      });
    }

    results = results
      .filter(result => result.relevanceScore >= relevanceThreshold)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxResults);

    const fallbackAnswer = searchResponse.answer || (results.length
      ? generateExtractiveAnswer(query, results, "plain")
      : undefined);
    const answer = options.includeAnswer && fallbackAnswer
      ? await answerGenerator.generate({
        query,
        sources: results,
        format: "plain",
        fallbackAnswer,
      })
      : undefined;

    return {
      query,
      results,
      answer,
      responseTime: (Date.now() - startTime) / 1000,
    };
  }
}

export const semanticSearch = new SemanticSearch();
