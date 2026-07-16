import { contentExtractor } from "./content-extractor.js";
import { embeddingClient } from "./embedding-client.js";
import { FusedSearchResult } from "./search-fusion.js";
import { scoreTextRelevance } from "../utils/text-analysis.js";

export interface SearchRerankOptions {
  query: string;
  searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
  maxResults: number;
  includeRawContent?: boolean | "markdown" | "text";
  includeRankingDebug?: boolean;
  semantic?: boolean;
  topN?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  weights?: Partial<RerankWeights>;
}

interface RerankWeights {
  rrf: number;
  lexical: number;
  vector: number;
  freshness: number;
}

interface ChunkCandidate {
  resultIndex: number;
  text: string;
}

const DEFAULT_WEIGHTS: RerankWeights = {
  rrf: 0.25,
  lexical: 0.3,
  vector: 0.35,
  freshness: 0.1,
};

export class SearchReranker {
  async rerank(results: FusedSearchResult[], options: SearchRerankOptions): Promise<FusedSearchResult[]> {
    if (results.length === 0) {
      return [];
    }

    const workingResults = results.map(result => ({
      ...result,
      rankingSignals: { ...result.rankingSignals },
    }));
    const maxRrf = Math.max(...workingResults.map(result => result.rankingSignals.rrf), 0.000001);
    const shouldExtractContent = shouldUseContentRerank(options);
    const rerankTopN = Math.min(
      options.topN ?? parsePositiveInteger(process.env.SEARCH_RERANK_TOP_N, 40),
      workingResults.length
    );

    if (shouldExtractContent && rerankTopN > 0) {
      await this.attachContentSignals(workingResults, {
        ...options,
        topN: rerankTopN,
        chunkSize: options.chunkSize ?? parsePositiveInteger(process.env.SEARCH_CHUNK_SIZE, 1000),
        chunkOverlap: options.chunkOverlap ?? parsePositiveInteger(process.env.SEARCH_CHUNK_OVERLAP, 150),
      });
    }

    const hasVectorSignals = workingResults.some(result => result.rankingSignals.vector !== undefined);
    const weights = normalizedWeights(resolveWeights(options.weights), hasVectorSignals);
    for (const result of workingResults) {
      const lexical = result.rankingSignals.lexical ?? scoreTextRelevance(options.query, [
        { text: result.title, weight: 0.45 },
        { text: result.snippet, weight: 0.35 },
        { text: result.url, weight: 0.2 },
      ]);
      const freshness = result.rankingSignals.freshness ?? freshnessScore(result.publishedDate);
      const vector = result.rankingSignals.vector ?? 0;
      const rrf = result.rankingSignals.rrf / maxRrf;

      const finalScore = (weights.rrf * rrf) +
        (weights.lexical * lexical) +
        (weights.vector * vector) +
        (weights.freshness * freshness);

      result.rankingSignals = {
        ...result.rankingSignals,
        rrf,
        lexical,
        vector,
        freshness,
        final: finalScore,
      };
      result.score = finalScore;

    }

    return workingResults
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, options.maxResults);
  }

  private async attachContentSignals(results: FusedSearchResult[], options: RequiredContentOptions): Promise<void> {
    const contentTargets = results.slice(0, options.topN);
    const extractedContents = await contentExtractor.extractMultiple(
      contentTargets.map(result => result.url),
      {
        format: "text",
        extractDepth: options.searchDepth === "advanced" ? "advanced" : "basic",
        chunksPerSource: 5,
      }
    );

    const chunkCandidates: ChunkCandidate[] = [];
    for (const [index, content] of extractedContents.entries()) {
      const result = contentTargets[index];
      const chunks = splitIntoChunks(content.content, options.chunkSize, options.chunkOverlap);
      const scoredChunks = chunks
        .map(text => ({
          text,
          score: scoreTextRelevance(options.query, [{ text, weight: 1 }]),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      result.content = content.content;
      if (options.includeRawContent) {
        result.raw_content = content.content;
      }

      result.matchedChunks = scoredChunks.map(chunk => chunk.text);
      result.rankingSignals.lexical = Math.max(
        result.rankingSignals.lexical ?? 0,
        ...scoredChunks.map(chunk => chunk.score),
        scoreTextRelevance(options.query, [
          { text: result.title, weight: 0.25 },
          { text: result.snippet, weight: 0.25 },
          { text: scoredChunks.map(chunk => chunk.text).join("\n"), weight: 0.5 },
        ])
      );

      for (const chunk of scoredChunks) {
        chunkCandidates.push({
          resultIndex: results.indexOf(result),
          text: chunk.text,
        });
      }
    }

    if (embeddingClient.isConfigured() && chunkCandidates.length > 0) {
      await this.attachVectorSignals(options.query, results, chunkCandidates);
    }
  }

  private async attachVectorSignals(
    query: string,
    results: FusedSearchResult[],
    chunks: ChunkCandidate[]
  ): Promise<void> {
    try {
      const embeddings = await embeddingClient.embedTexts([query, ...chunks.map(chunk => chunk.text)]);
      const queryEmbedding = embeddings[0];
      const chunkEmbeddings = embeddings.slice(1);

      for (const [index, chunk] of chunks.entries()) {
        const score = cosineSimilarity(queryEmbedding, chunkEmbeddings[index]);
        const result = results[chunk.resultIndex];
        result.rankingSignals.vector = Math.max(result.rankingSignals.vector ?? 0, score);
      }
    } catch {
      return;
    }
  }
}

type RequiredContentOptions = SearchRerankOptions & Required<Pick<SearchRerankOptions, "topN" | "chunkSize" | "chunkOverlap">>;

function shouldUseContentRerank(options: SearchRerankOptions): boolean {
  if (options.includeRawContent || options.semantic) {
    return true;
  }

  if (options.searchDepth === "advanced") {
    return parseBoolean(process.env.SEARCH_ENABLE_CONTENT_RERANK, true);
  }

  return parseBoolean(process.env.SEARCH_ENABLE_CONTENT_RERANK, false);
}

function resolveWeights(overrides?: Partial<RerankWeights>): RerankWeights {
  return {
    rrf: parseNumber(process.env.SEARCH_RERANK_RRF_WEIGHT, overrides?.rrf ?? DEFAULT_WEIGHTS.rrf),
    lexical: parseNumber(process.env.SEARCH_RERANK_LEXICAL_WEIGHT, overrides?.lexical ?? DEFAULT_WEIGHTS.lexical),
    vector: parseNumber(process.env.SEARCH_RERANK_VECTOR_WEIGHT, overrides?.vector ?? DEFAULT_WEIGHTS.vector),
    freshness: parseNumber(process.env.SEARCH_RERANK_FRESHNESS_WEIGHT, overrides?.freshness ?? DEFAULT_WEIGHTS.freshness),
  };
}

function normalizedWeights(weights: RerankWeights, vectorEnabled: boolean): RerankWeights {
  const activeWeights = {
    ...weights,
    vector: vectorEnabled ? weights.vector : 0,
  };
  const total = activeWeights.rrf + activeWeights.lexical + activeWeights.vector + activeWeights.freshness;
  if (total <= 0) {
    return DEFAULT_WEIGHTS;
  }

  return {
    rrf: activeWeights.rrf / total,
    lexical: activeWeights.lexical / total,
    vector: activeWeights.vector / total,
    freshness: activeWeights.freshness / total,
  };
}

function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  const step = Math.max(chunkSize - overlap, 1);
  for (let index = 0; index < normalized.length; index += step) {
    const chunk = normalized.slice(index, index + chunkSize).trim();
    if (chunk.length > 80) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

function freshnessScore(publishedDate?: string): number {
  if (!publishedDate) {
    return 0;
  }

  const timestamp = Date.parse(publishedDate);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  const ageDays = Math.max((Date.now() - timestamp) / 86_400_000, 0);
  if (ageDays <= 7) {
    return 1;
  }
  if (ageDays <= 30) {
    return 0.7;
  }
  if (ageDays <= 365) {
    return 0.35;
  }

  return 0.1;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return Math.max(0, dot / (Math.sqrt(normA) * Math.sqrt(normB)));
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export const searchReranker = new SearchReranker();
