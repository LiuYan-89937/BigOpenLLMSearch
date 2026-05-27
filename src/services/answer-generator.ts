import axios from "axios";
import { generateExtractiveAnswer, SourceText } from "../utils/text-analysis.js";
import { loadEnvFile } from "../utils/env.js";

loadEnvFile();

export interface AnswerSource extends SourceText {
  url?: string;
}

export interface GenerateAnswerOptions {
  query: string;
  sources: AnswerSource[];
  format?: "plain" | "summary" | "bullet_points" | "report";
  fallbackAnswer?: string;
}

interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export class AnswerGenerator {
  async generate(options: GenerateAnswerOptions): Promise<string> {
    const fallback = options.fallbackAnswer || generateExtractiveAnswer(
      options.query,
      options.sources,
      options.format ?? "plain"
    );
    const config = this.getConfig();

    if (!config || options.sources.length === 0) {
      return fallback;
    }

    try {
      return await this.generateWithOpenAiCompatibleApi(config, options);
    } catch {
      return fallback;
    }
  }

  isConfigured(): boolean {
    return this.getConfig() !== undefined;
  }

  private getConfig(): LlmConfig | undefined {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL;
    const baseUrl = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

    if (!apiKey || !model) {
      return undefined;
    }

    return {
      apiKey,
      model,
      baseUrl: baseUrl.replace(/\/$/, ""),
      maxTokens: parseInteger(process.env.LLM_MAX_TOKENS, 900),
      temperature: parseNumber(process.env.LLM_TEMPERATURE, 0.2),
    };
  }

  private async generateWithOpenAiCompatibleApi(
    config: LlmConfig,
    options: GenerateAnswerOptions
  ): Promise<string> {
    const response = await axios.post(
      `${config.baseUrl}/chat/completions`,
      {
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [
          {
            role: "system",
            content: [
              "You generate grounded answers for a web search MCP tool.",
              "Use only the provided sources.",
              "Cite sources with bracketed numbers like [1].",
              "If the sources are insufficient, say what is missing.",
              "Answer in the same language as the user query.",
            ].join(" "),
          },
          {
            role: "user",
            content: buildPrompt(options),
          },
        ],
      },
      {
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const answer = response.data?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || answer.trim().length === 0) {
      throw new Error("LLM response did not contain an answer");
    }

    return answer.trim();
  }
}

function buildPrompt(options: GenerateAnswerOptions): string {
  const format = options.format ?? "plain";
  const sourceBlock = options.sources
    .slice(0, 8)
    .map((source, index) => {
      const parts = [
        `[${index + 1}] ${source.title || "Untitled"}`,
        source.url ? `URL: ${source.url}` : undefined,
        source.snippet ? `Snippet: ${source.snippet}` : undefined,
        source.content ? `Content: ${source.content.substring(0, 2500)}` : undefined,
      ].filter(Boolean);

      return parts.join("\n");
    })
    .join("\n\n");

  return [
    `Query: ${options.query}`,
    `Required format: ${format}`,
    "Sources:",
    sourceBlock,
  ].join("\n\n");
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const answerGenerator = new AnswerGenerator();
