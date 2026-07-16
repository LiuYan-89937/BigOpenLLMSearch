import axios from "axios";
import { loadEnvFile } from "../utils/env.js";

loadEnvFile();

interface EmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  batchSize: number;
}

export class EmbeddingClient {
  isConfigured(): boolean {
    return this.getConfig() !== undefined;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const config = this.getConfig();
    if (!config) {
      throw new Error("Embedding client is not configured");
    }

    const embeddings: number[][] = [];
    for (let index = 0; index < texts.length; index += config.batchSize) {
      const batch = texts.slice(index, index + config.batchSize);
      const response = await axios.post(
        `${config.baseUrl}/embeddings`,
        {
          model: config.model,
          input: batch,
        },
        {
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );

      const batchEmbeddings = response.data?.data
        ?.sort((a: any, b: any) => a.index - b.index)
        ?.map((item: any) => item.embedding);

      if (!Array.isArray(batchEmbeddings) || batchEmbeddings.length !== batch.length) {
        throw new Error("Embedding response did not match input batch");
      }

      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  private getConfig(): EmbeddingConfig | undefined {
    const apiKey = process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.EMBEDDING_MODEL;
    const baseUrl = process.env.EMBEDDING_BASE_URL ||
      process.env.LLM_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1";

    if (!apiKey || !model) {
      return undefined;
    }

    return {
      apiKey,
      model,
      baseUrl: baseUrl.replace(/\/$/, ""),
      batchSize: parsePositiveInteger(process.env.EMBEDDING_BATCH_SIZE, 32),
    };
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const embeddingClient = new EmbeddingClient();
