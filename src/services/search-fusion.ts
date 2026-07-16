import { SearchResult } from "./search-engines.js";
import { canonicalizeUrl } from "../utils/url-canonicalize.js";

export interface RecallCandidate extends SearchResult {
  recallQuery: string;
  sourceEngine: string;
  providerRank: number;
  canonicalUrl: string;
}

export interface FusedSearchResult extends SearchResult {
  canonicalUrl: string;
  recallQueries: string[];
  sourceEngines: string[];
  providerRanks: Record<string, number>;
  rankingSignals: {
    rrf: number;
    lexical?: number;
    vector?: number;
    freshness?: number;
    final?: number;
  };
  matchedChunks?: string[];
  raw_content?: string;
}

export interface FusionOptions {
  rrfK?: number;
}

interface FusedAccumulator {
  result: FusedSearchResult;
  seenRuns: Set<string>;
}

export function createRecallCandidates(
  results: SearchResult[],
  recallQuery: string,
  sourceEngine: string
): RecallCandidate[] {
  return results.flatMap((result, index) => {
    const canonicalUrl = canonicalizeUrl(result.url);
    if (!canonicalUrl) {
      return [];
    }

    return [{
      ...result,
      recallQuery,
      sourceEngine,
      providerRank: index + 1,
      canonicalUrl,
    }];
  });
}

export function fuseRecallCandidates(
  candidates: RecallCandidate[],
  options: FusionOptions = {}
): FusedSearchResult[] {
  const rrfK = options.rrfK ?? 60;
  const groups = new Map<string, FusedAccumulator>();

  for (const candidate of candidates) {
    const runKey = `${candidate.sourceEngine}:${candidate.recallQuery}`;
    const contribution = 1 / (rrfK + candidate.providerRank);
    const current = groups.get(candidate.canonicalUrl);

    if (!current) {
      groups.set(candidate.canonicalUrl, {
        result: {
          title: candidate.title,
          url: candidate.url,
          canonicalUrl: candidate.canonicalUrl,
          snippet: candidate.snippet,
          publishedDate: candidate.publishedDate,
          favicon: candidate.favicon,
          images: candidate.images,
          engine: candidate.sourceEngine,
          score: contribution,
          recallQueries: [candidate.recallQuery],
          sourceEngines: [candidate.sourceEngine],
          providerRanks: { [runKey]: candidate.providerRank },
          rankingSignals: { rrf: contribution },
        },
        seenRuns: new Set([runKey]),
      });
      continue;
    }

    const { result, seenRuns } = current;
    if (!seenRuns.has(runKey)) {
      result.rankingSignals.rrf += contribution;
      result.score = result.rankingSignals.rrf;
      result.providerRanks[runKey] = candidate.providerRank;
      seenRuns.add(runKey);
    }

    if (!result.recallQueries.includes(candidate.recallQuery)) {
      result.recallQueries.push(candidate.recallQuery);
    }

    if (!result.sourceEngines.includes(candidate.sourceEngine)) {
      result.sourceEngines.push(candidate.sourceEngine);
    }

    if (candidate.snippet.length > result.snippet.length) {
      result.snippet = candidate.snippet;
    }

    if (candidate.title.length > result.title.length) {
      result.title = candidate.title;
    }

    if (!result.publishedDate && candidate.publishedDate) {
      result.publishedDate = candidate.publishedDate;
    }

    if (!result.favicon && candidate.favicon) {
      result.favicon = candidate.favicon;
    }

    if (candidate.images?.length) {
      result.images = Array.from(new Set([...(result.images ?? []), ...candidate.images]));
    }
  }

  return Array.from(groups.values())
    .map(group => group.result)
    .sort((a, b) => b.rankingSignals.rrf - a.rankingSignals.rrf);
}
