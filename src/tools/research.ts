import { z } from "zod";
import { searchEngineManager } from "../services/search-engines.js";
import { contentExtractor } from "../services/content-extractor.js";
import { contentCache } from "../utils/cache.js";
import {
  buildResearchQueries,
  extractRelevantSentences,
  scoreTextRelevance,
} from "../utils/text-analysis.js";
import { parseToolInput } from "../utils/tool-input.js";
import { answerGenerator } from "../services/answer-generator.js";

const ResearchInputSchema = z.object({
  query: z.string().trim().min(1).describe("The research question or topic to investigate"),
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
      query: { type: "string", minLength: 1, description: "The research question or topic to investigate" },
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
  static async execute(rawInput: unknown): Promise<ResearchResult> {
    const input = parseToolInput(ResearchInputSchema, rawInput);
    const startTime = Date.now();
    const cacheKey = JSON.stringify(input);
    const cached = contentCache.get(cacheKey);
    if (cached) return cached;
    
    const searchQueries = buildResearchQueries(input.query);
    
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
        relevance: scoreTextRelevance(input.query, [
          { text: source.title, weight: 0.45 },
          { text: source.snippet, weight: 0.35 },
          { text: 'content' in extracted ? extracted.content : source.snippet, weight: 0.2 },
        ]),
      };
    });

    enrichedSources.sort((a, b) => b.relevance - a.relevance);

    const keyFindings = this.extractKeyFindings(input.query, enrichedSources);

    let answer: string | undefined;
    if (input.include_answer) {
      answer = await answerGenerator.generate({
        query: input.query,
        sources: enrichedSources,
        format: input.output_format,
        fallbackAnswer: this.generateResearchAnswer(input.query, enrichedSources, input.output_format),
      });
    }

    const response = {
      query: input.query,
      answer,
      sources: enrichedSources,
      key_findings: keyFindings,
      response_time: (Date.now() - startTime) / 1000,
    };

    contentCache.set(cacheKey, response);
    return response;
  }

  private static extractKeyFindings(query: string, sources: Array<{ title: string; snippet: string; content?: string }>): string[] {
    return extractRelevantSentences(query, sources.slice(0, 5), 5);
  }

  private static generateResearchAnswer(
    query: string,
    sources: Array<{ title: string; snippet: string; content?: string }>,
    format: string
  ): string {
    const sentences = extractRelevantSentences(query, sources, format === "report" ? 8 : 3);
    if (sentences.length === 0) {
      return sources[0]?.snippet || sources[0]?.content || "No relevant information found.";
    }

    switch (format) {
      case "bullet_points":
        return `Research findings for "${query}":\n\n${sentences.map(sentence => `- ${sentence}`).join("\n")}`;
      
      case "summary":
        return `Summary of research on "${query}": ${sentences.join(". ")}.`;
      
      case "report":
      default:
        return `Research Report: ${query}\n\nKey information:\n${sentences.map(sentence => `- ${sentence}`).join("\n")}\n\nSources: ${sources.slice(0, 3).map(s => s.title).join(", ")}`;
    }
  }
}
