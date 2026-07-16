import axios from "axios";
import { SearchTopic } from "../config/search-topics.js";
import { tokenizeMeaningfulText } from "../utils/text-analysis.js";
import { loadEnvFile } from "../utils/env.js";

loadEnvFile();

export type RecallQueryIntent = "original" | "keyword" | "expanded" | "translated";

export interface RecallQuery {
  query: string;
  intent: RecallQueryIntent;
}

export interface SearchPlan {
  originalQuery: string;
  normalizedQuery: string;
  recallQueries: RecallQuery[];
  topic: SearchTopic;
  language?: string;
}

export interface SearchPlanOptions {
  topic?: SearchTopic;
  language?: string;
  maxQueries?: number;
  searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
}

interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export class SearchPlanner {
  async plan(query: string, options: SearchPlanOptions = {}): Promise<SearchPlan> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    const maxQueries = resolveMaxQueries(options);
    const fallbackQueries = fallbackRecallQueries(normalizedQuery, maxQueries);
    const recallQueries = await this.planWithLlm(normalizedQuery, options, fallbackQueries)
      .catch(() => fallbackQueries);

    return {
      originalQuery: query,
      normalizedQuery,
      recallQueries: dedupeRecallQueries(recallQueries).slice(0, maxQueries),
      topic: options.topic ?? "general",
      language: options.language,
    };
  }

  private async planWithLlm(
    query: string,
    options: SearchPlanOptions,
    fallbackQueries: RecallQuery[]
  ): Promise<RecallQuery[]> {
    if (!shouldUseLlmRewrite(options.searchDepth)) {
      return fallbackQueries;
    }

    const config = getLlmConfig();
    if (!config) {
      return fallbackQueries;
    }

    const response = await axios.post(
      `${config.baseUrl}/chat/completions`,
      {
        model: config.model,
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Generate web search recall queries.",
              "Return only JSON with a queries array.",
              "Each item must have query and intent.",
              "Do not answer the user question.",
              "Prefer precise searchable phrases.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              query,
              topic: options.topic ?? "general",
              language: options.language,
              max_queries: options.maxQueries,
              intents: ["original", "keyword", "expanded", "translated"],
            }),
          },
        ],
      },
      {
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    const parsed = typeof content === "string" ? JSON.parse(content) : undefined;
    const queries = Array.isArray(parsed?.queries) ? parsed.queries : [];

    const plannedQueries = queries.flatMap((item: any) => {
      const plannedQuery = typeof item?.query === "string" ? item.query.trim() : "";
      const intent = normalizeIntent(item?.intent);
      return plannedQuery ? [{ query: plannedQuery, intent }] : [];
    });

    return plannedQueries.length ? [fallbackQueries[0], ...plannedQueries] : fallbackQueries;
  }
}

function fallbackRecallQueries(query: string, maxQueries: number): RecallQuery[] {
  const queries: RecallQuery[] = [{ query, intent: "original" }];
  const terms = tokenizeMeaningfulText(query);

  if (terms.length >= 4) {
    queries.push({
      query: terms.slice(0, Math.min(terms.length, 8)).join(" "),
      intent: "keyword",
    });
  }

  if (query.length > 80 && terms.length >= 6) {
    queries.push({
      query: terms.slice(Math.max(terms.length - 8, 0)).join(" "),
      intent: "expanded",
    });
  }

  return dedupeRecallQueries(queries).slice(0, maxQueries);
}

function resolveMaxQueries(options: SearchPlanOptions): number {
  const configured = parsePositiveInteger(process.env.SEARCH_MAX_RECALL_QUERIES, 4);
  const capped = Math.min(Math.max(options.maxQueries ?? configured, 1), 6);

  switch (options.searchDepth) {
    case "advanced":
      return capped;
    case "basic":
      return Math.min(capped, 3);
    case "fast":
    case "ultra-fast":
    default:
      return 1;
  }
}

function shouldUseLlmRewrite(searchDepth?: SearchPlanOptions["searchDepth"]): boolean {
  const mode = (process.env.SEARCH_QUERY_REWRITE ?? "auto").trim().toLowerCase();
  if (mode === "off" || mode === "false" || mode === "0") {
    return false;
  }

  if (searchDepth === "fast" || searchDepth === "ultra-fast") {
    return false;
  }

  return true;
}

function getLlmConfig(): LlmConfig | undefined {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.SEARCH_QUERY_REWRITE_MODEL || process.env.LLM_MODEL || process.env.OPENAI_MODEL;
  const baseUrl = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  if (!apiKey || !model) {
    return undefined;
  }

  return {
    apiKey,
    model,
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
}

function normalizeIntent(intent: unknown): RecallQueryIntent {
  if (intent === "keyword" || intent === "expanded" || intent === "translated") {
    return intent;
  }

  return "expanded";
}

function dedupeRecallQueries(queries: RecallQuery[]): RecallQuery[] {
  const seen = new Set<string>();
  const deduped: RecallQuery[] = [];

  for (const query of queries) {
    const normalized = query.query.trim().replace(/\s+/g, " ").toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push({
      ...query,
      query: query.query.trim().replace(/\s+/g, " "),
    });
  }

  return deduped;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const searchPlanner = new SearchPlanner();
