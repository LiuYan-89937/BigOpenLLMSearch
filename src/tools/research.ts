import { z } from "zod";
import { searchEngineManager, SearchOptions } from "../services/search-engines.js";
import { contentExtractor } from "../services/content-extractor.js";
import { semanticSearch } from "../services/semantic-search.js";
import { contentCache } from "../utils/cache.js";

const ResearchInputSchema = z.object({
  query: z.string().describe("The research question or topic to investigate"),
  max_sources: z.number().min(3).max(20).default(10).describe("Maximum number of sources to analyze"),
  search_depth: z.enum(["basic", "advanced"]).default("advanced").describe("Search depth for finding sources"),
  include_answer: z.boolean().default(true).describe("Generate a comprehensive answer from the research"),
  output_format: z.enum(["report", "summary", "bullet_points"]).default("report").describe("Format of the research output"),
  time_range: z.enum(["day", "week", "month", "year"]).optional().describe("Filter sources by time range"),
  engines: z.array(z.string()).optional().describe("Search engines to use for research"),
});

export type ResearchInput = z.infer<typeof ResearchInputSchema>;

export interface ResearchResult {
  query: string;
  answer?: string;
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
    content?: string;
    relevance: number;
  }>;
  key_findings: string[];
  response_time: number;
}

export const researchToolDefinition = {
  name: "web_research",
  description: "Perform comprehensive research on a topic by conducting multiple searches, analyzing sources, and generating a detailed research report. Ideal for in-depth investigation, fact-checking, and gathering information from multiple perspectives.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "The research question or topic to investigate" },
      max_sources: { type: "number", minimum: 3, maximum: 20, default: 10, description: "Maximum number of sources to analyze" },
      search_depth: { type: "string", enum: ["basic", "advanced"], default: "advanced", description: "Search depth for finding sources" },
      include_answer: { type: "boolean", default: true, description: "Generate a comprehensive answer" },
      output_format: { 
        type: "string", 
        enum: ["report", "summary", "bullet_points"], 
        default: "report",
        description: "Format of the research output"
      },
      time_range: { type: "string", enum: ["day", "week", "month", "year"], description: "Filter sources by time range" },
      engines: { type: "array", items: { type: "string" }, description: "Search engines to use" },
    },
    required: ["query"],
  },
};

export class ResearchTool {
  static async execute(input: ResearchInput): Promise<ResearchResult> {
    const startTime = Date.now();
    
    const searchQueries = this.generateSearchQueries(input.query);
    
    const searchPromises = searchQueries.map(query =>
      searchEngineManager.multiSearch(query, {
        maxResults: Math.ceil(input.max_sources / searchQueries.length),
        searchDepth: input.search_depth,
        timeRange: input.time_range,
        engines: input.engines,
      })
    );

    const searchResults = await Promise.all(searchPromises);
    
    const allSources = new Map<string, any>();
    for (const result of searchResults) {
      for (const r of result.results) {
        if (!allSources.has(r.url)) {
          allSources.set(r.url, r);
        }
      }
    }

    const sources = Array.from(allSources.values()).slice(0, input.max_sources);

    const extractPromises = sources.map(source =>
      contentExtractor.extract(source.url, {
        format: "text",
        extractDepth: input.search_depth === "advanced" ? "advanced" : "basic",
        chunksPerSource: 3,
      }).catch(error => ({
        url: source.url,
        title: source.title,
        content: source.snippet,
        error: error.message,
      }))
    );

    const extractedContents = await Promise.all(extractPromises);

    const enrichedSources = sources.map((source, index) => {
      const extracted = extractedContents[index];
      return {
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        content: 'content' in extracted ? extracted.content : source.snippet,
        relevance: this.calculateRelevance(input.query, source.title, source.snippet),
      };
    });

    enrichedSources.sort((a, b) => b.relevance - a.relevance);

    const keyFindings = this.extractKeyFindings(input.query, enrichedSources);

    let answer: string | undefined;
    if (input.include_answer) {
      answer = this.generateResearchAnswer(input.query, enrichedSources, input.output_format);
    }

    return {
      query: input.query,
      answer,
      sources: enrichedSources,
      key_findings: keyFindings,
      response_time: (Date.now() - startTime) / 1000,
    };
  }

  private static generateSearchQueries(query: string): string[] {
    const queries = [query];
    
    const words = query.split(/\s+/);
    if (words.length > 3) {
      queries.push(words.slice(0, Math.ceil(words.length / 2)).join(" "));
    }

    queries.push(`${query} latest developments`);
    queries.push(`${query} analysis`);

    return queries.slice(0, 3);
  }

  private static calculateRelevance(query: string, title: string, snippet: string): number {
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

    score += (matchedTerms / queryTerms.length) * 0.3;

    return Math.min(score, 1);
  }

  private static extractKeyFindings(query: string, sources: Array<{ title: string; snippet: string; content?: string }>): string[] {
    const findings: string[] = [];
    const seen = new Set<string>();

    for (const source of sources.slice(0, 5)) {
      const text = source.content || source.snippet;
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 30);

      for (const sentence of sentences.slice(0, 2)) {
        const trimmed = sentence.trim();
        if (trimmed.length > 30 && !seen.has(trimmed)) {
          seen.add(trimmed);
          findings.push(trimmed);
          if (findings.length >= 5) break;
        }
      }

      if (findings.length >= 5) break;
    }

    return findings;
  }

  private static generateResearchAnswer(
    query: string,
    sources: Array<{ title: string; snippet: string; content?: string }>,
    format: string
  ): string {
    const relevantContent = sources
      .slice(0, 5)
      .map(s => s.content || s.snippet)
      .join("\n\n");

    const sentences = relevantContent.split(/[.!?]+/).filter(s => s.trim().length > 30);
    
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
      .slice(0, 8);

    if (relevantSentences.length === 0) {
      return `Based on the research for "${query}": ${sources[0]?.snippet || "No relevant information found."}`;
    }

    switch (format) {
      case "bullet_points":
        return `Research findings for "${query}":\n\n${relevantSentences.map(s => `• ${s.text}`).join("\n")}`;
      
      case "summary":
        return `Summary of research on "${query}": ${relevantSentences.slice(0, 3).map(s => s.text).join(". ")}.`;
      
      case "report":
      default:
        return `Research Report: ${query}\n\nKey Information:\n${relevantSentences.map(s => `- ${s.text}`).join("\n")}\n\nSources: ${sources.slice(0, 3).map(s => s.title).join(", ")}`;
    }
  }
}
