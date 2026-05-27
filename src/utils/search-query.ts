import { getSearchTopicProfile, SearchTopic } from "../config/search-topics.js";

export interface SearchQueryFilters {
  includeDomains?: string[];
  excludeDomains?: string[];
  exactMatch?: boolean;
  topic?: SearchTopic;
  startDate?: string;
  endDate?: string;
}

export function buildSearchQuery(query: string, filters: SearchQueryFilters = {}): string {
  const normalizedQuery = query.trim();
  const baseQuery = filters.exactMatch ? quoteQuery(normalizedQuery) : normalizedQuery;
  const includeDomains = normalizeDomains(filters.includeDomains);
  const excludeDomains = normalizeDomains(filters.excludeDomains);
  const parts: string[] = [baseQuery];

  if (includeDomains.length > 0) {
    parts.push(`(${includeDomains.map(domain => `site:${domain}`).join(" OR ")})`);
  }

  const topicTerms = getSearchTopicProfile(filters.topic).queryTerms;
  const topicClause = buildTopicClause(topicTerms);
  if (topicClause && !containsTopicSignal(normalizedQuery, topicTerms)) {
    parts.push(topicClause);
  }

  if (filters.startDate) {
    parts.push(`after:${filters.startDate}`);
  }

  if (filters.endDate) {
    parts.push(`before:${filters.endDate}`);
  }

  for (const domain of excludeDomains) {
    parts.push(`-site:${domain}`);
  }

  return parts.filter(Boolean).join(" ").trim();
}

export function normalizeDomains(domains?: string[]): string[] {
  const normalized = new Set<string>();

  for (const domain of domains ?? []) {
    const candidate = normalizeDomain(domain);
    if (candidate) {
      normalized.add(candidate);
    }
  }

  return Array.from(normalized);
}

function quoteQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed;
  }

  return `"${trimmed.replace(/"/g, "\\\"")}"`;
}

function normalizeDomain(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    const host = trimmed
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");

    return host.includes(".") ? host : undefined;
  }
}

function buildTopicClause(terms: string[]): string | undefined {
  if (terms.length === 0) {
    return undefined;
  }

  return `(${terms.map(quoteTermIfNeeded).join(" OR ")})`;
}

function containsTopicSignal(query: string, terms: string[]): boolean {
  const normalizedQuery = query.toLowerCase();

  return terms.some(term => normalizedQuery.includes(term.toLowerCase()));
}

function quoteTermIfNeeded(term: string): string {
  return /\s/.test(term) ? quoteQuery(term) : term;
}
