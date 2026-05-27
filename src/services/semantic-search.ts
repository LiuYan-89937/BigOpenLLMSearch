import { searchEngineManager, SearchOptions, SearchResponse } from "./search-engines.js";
import { contentExtractor, ExtractedContent } from "./content-extractor.js";

export interface SemanticSearchOptions extends SearchOptions {
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
      relevanceThreshold = 0.3,
      maxResults = 10,
      ...searchOptions
    } = options;

    const searchResponse = await searchEngineManager.search(query, {
      ...searchOptions,
      maxResults: maxResults * 2,
    });

    let results = searchResponse.results.map(result => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      relevanceScore: this.calculateRelevance(query, result.title, result.snippet),
      keyPhrases: this.extractKeyPhrases(result.snippet),
    }));

    results = results.filter(r => r.relevanceScore >= relevanceThreshold);
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    results = results.slice(0, maxResults);

    if (extractContent) {
      const urls = results.map(r => r.url);
      const contents = await contentExtractor.extractMultiple(urls, {
        format: "text",
        extractDepth: "basic",
      });

      const contentMap = new Map(contents.map(c => [c.url, c.content]));

      results = results.map(result => ({
        ...result,
        content: contentMap.get(result.url)?.substring(0, maxContentLength),
      }));
    }

    let answer: string | undefined;
    if (searchResponse.answer) {
      answer = searchResponse.answer;
    } else if (results.length > 0) {
      answer = this.generateSummary(query, results.slice(0, 3));
    }

    return {
      query,
      results,
      answer,
      responseTime: (Date.now() - startTime) / 1000,
    };
  }

  private calculateRelevance(query: string, title: string, snippet: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const titleLower = title.toLowerCase();
    const snippetLower = snippet.toLowerCase();

    let score = 0;
    let matchedTerms = 0;

    for (const term of queryTerms) {
      if (titleLower.includes(term)) {
        score += 0.4;
        matchedTerms++;
      }
      if (snippetLower.includes(term)) {
        score += 0.3;
        matchedTerms++;
      }
    }

    const termMatchRatio = matchedTerms / queryTerms.length;
    score += termMatchRatio * 0.3;

    return Math.min(score, 1);
  }

  private extractKeyPhrases(text: string): string[] {
    const words = text.toLowerCase().split(/\s+/);
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
      "being", "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "can", "this", "that", "these",
      "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
      "who", "whom", "when", "where", "why", "how", "all", "each", "every",
      "both", "few", "more", "most", "other", "some", "such", "no", "not",
      "only", "own", "same", "so", "than", "too", "very", "just", "because",
      "as", "until", "while", "of", "during", "before", "after", "above",
      "below", "between", "through", "during", "before", "after", "above",
      "below", "between",
    ]);

    const phrases: string[] = [];
    let currentPhrase: string[] = [];

    for (const word of words) {
      const cleanWord = word.replace(/[^a-z0-9]/g, "");
      if (cleanWord.length > 2 && !stopWords.has(cleanWord)) {
        currentPhrase.push(cleanWord);
      } else {
        if (currentPhrase.length >= 2) {
          phrases.push(currentPhrase.join(" "));
        }
        currentPhrase = [];
      }
    }

    if (currentPhrase.length >= 2) {
      phrases.push(currentPhrase.join(" "));
    }

    const phraseCounts = new Map<string, number>();
    phrases.forEach(p => {
      phraseCounts.set(p, (phraseCounts.get(p) || 0) + 1);
    });

    return Array.from(phraseCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([phrase]) => phrase);
  }

  private generateSummary(query: string, results: Array<{ title: string; snippet: string }>): string {
    const snippets = results.map(r => r.snippet).join(" ");
    const sentences = snippets.split(/[.!?]+/).filter(s => s.trim().length > 30);
    
    const queryTerms = query.toLowerCase().split(/\s+/);
    const relevantSentences = sentences
      .map(sentence => ({
        text: sentence.trim(),
        relevance: queryTerms.filter(term => 
          sentence.toLowerCase().includes(term)
        ).length,
      }))
      .filter(s => s.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 3);

    if (relevantSentences.length > 0) {
      return relevantSentences.map(s => s.text).join(". ") + ".";
    }

    return `Based on the search results for "${query}": ${results[0]?.snippet || "No relevant information found."}`;
  }
}

export const semanticSearch = new SemanticSearch();
