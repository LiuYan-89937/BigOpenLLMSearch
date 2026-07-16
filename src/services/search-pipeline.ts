import {
  searchEngineManager,
  SearchOptions,
  SearchResponse,
  SearchResult,
} from "./search-engines.js";
import { answerGenerator } from "./answer-generator.js";
import { createRecallCandidates, fuseRecallCandidates, FusedSearchResult, RecallCandidate } from "./search-fusion.js";
import { searchPlanner } from "./search-planner.js";
import { searchReranker } from "./search-reranker.js";

export interface SearchPipelineOptions extends SearchOptions {
  engine?: string;
}

interface RecallError {
  engine: string;
  error: string;
}

export class SearchPipeline {
  async search(query: string, options: SearchPipelineOptions = {}): Promise<SearchResponse> {
    const startedAt = Date.now();
    const requestedMaxResults = options.maxResults ?? 10;
    const plan = await searchPlanner.plan(query, {
      topic: options.topic,
      language: options.language,
      maxQueries: options.maxRecallQueries,
      searchDepth: options.searchDepth,
    });
    const engineNames = resolveEngineNames(options);
    const perRunLimit = resolvePerRunLimit(options, requestedMaxResults);
    const { candidates, errors } = await this.recallCandidates(plan.recallQueries.map(item => item.query), engineNames, {
      ...options,
      maxResults: perRunLimit,
    });
    const fusedResults = fuseRecallCandidates(candidates, {
      rrfK: parsePositiveInteger(process.env.SEARCH_RRF_K, 60),
    }).slice(0, resolveCandidateLimit(options, requestedMaxResults));
    const rerankedResults = await searchReranker.rerank(fusedResults, {
      query: plan.normalizedQuery,
      searchDepth: options.searchDepth,
      maxResults: requestedMaxResults,
      includeRawContent: options.includeRawContent,
      includeRankingDebug: options.includeRankingDebug,
      semantic: options.semantic,
    });
    const responseResults = formatResults(rerankedResults, options);
    const answer = options.includeAnswer
      ? await answerGenerator.generate({
        query: plan.normalizedQuery,
        sources: rerankedResults,
        format: "plain",
      })
      : undefined;

    return {
      query,
      results: responseResults,
      answer,
      images: options.includeImages ? collectImages(responseResults) : undefined,
      responseTime: (Date.now() - startedAt) / 1000,
      engines: engineNames,
      errors: errors.length ? errors : undefined,
      search_plan: options.includeRankingDebug
        ? { recall_queries: plan.recallQueries.map(item => item.query) }
        : undefined,
    };
  }

  private async recallCandidates(
    recallQueries: string[],
    engineNames: string[],
    options: SearchPipelineOptions
  ): Promise<{ candidates: RecallCandidate[]; errors: RecallError[] }> {
    const candidates: RecallCandidate[] = [];
    const errors: RecallError[] = [];
    const recallRuns = recallQueries.flatMap(recallQuery =>
      engineNames.map(engineName => ({ recallQuery, engineName }))
    );

    await Promise.all(recallRuns.map(async run => {
      try {
        const response = await searchEngineManager.recall(run.recallQuery, {
          ...options,
          engine: run.engineName,
        });
        candidates.push(...createRecallCandidates(
          response.results,
          run.recallQuery,
          response.engine ?? run.engineName
        ));
      } catch (error) {
        errors.push({
          engine: run.engineName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));

    return { candidates, errors };
  }
}

function resolveEngineNames(options: SearchPipelineOptions): string[] {
  if (options.engines?.length) {
    return Array.from(new Set(options.engines.map(engine => engine.trim()).filter(Boolean)));
  }

  if (options.engine) {
    return [options.engine];
  }

  return [searchEngineManager.getDefaultEngineName()];
}

function resolvePerRunLimit(options: SearchPipelineOptions, requestedMaxResults: number): number {
  const base = Math.max(requestedMaxResults, 10);
  switch (options.searchDepth) {
    case "advanced":
      return Math.min(Math.max(base * 4, 40), 80);
    case "basic":
      return Math.min(Math.max(base * 3, 30), 60);
    case "fast":
      return Math.min(Math.max(base * 2, 20), 40);
    case "ultra-fast":
    default:
      return Math.min(base, 20);
  }
}

function resolveCandidateLimit(options: SearchPipelineOptions, requestedMaxResults: number): number {
  if (options.candidateLimit) {
    return options.candidateLimit;
  }

  const configuredLimit = parsePositiveInteger(process.env.SEARCH_CANDIDATE_LIMIT, 0);
  if (configuredLimit > 0) {
    return configuredLimit;
  }

  switch (options.searchDepth) {
    case "advanced":
      return Math.max(requestedMaxResults * 10, 100);
    case "basic":
      return Math.max(requestedMaxResults * 6, 60);
    case "fast":
      return Math.max(requestedMaxResults * 4, 40);
    case "ultra-fast":
    default:
      return Math.max(requestedMaxResults * 2, 20);
  }
}

function formatResults(results: FusedSearchResult[], options: SearchPipelineOptions): SearchResult[] {
  return results.map(result => {
    const formatted: any = {
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      score: result.score,
      publishedDate: result.publishedDate,
      favicon: result.favicon,
      engine: result.sourceEngines?.[0] ?? result.engine,
    };

    if (options.includeImages && result.images?.length) {
      formatted.images = result.images;
    }

    if (options.includeRawContent && result.raw_content) {
      formatted.raw_content = result.raw_content;
    }

    if (options.includeRankingDebug) {
      formatted.recall_queries = result.recallQueries;
      formatted.source_engines = result.sourceEngines;
      formatted.matched_chunks = result.matchedChunks;
      formatted.ranking_signals = result.rankingSignals;
    }

    return formatted;
  });
}

function collectImages(results: SearchResult[]): string[] | undefined {
  const images = Array.from(new Set(results.flatMap(result => result.images ?? [])));
  return images.length ? images : undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const searchPipeline = new SearchPipeline();
