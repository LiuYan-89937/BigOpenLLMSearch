import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SearchTopic = "general" | "news" | "finance";

export interface SearchTopicProfile {
  nativeCategory?: "news";
  queryTerms: string[];
  rankingTerms: string[];
}

type RawTopicProfiles = Partial<Record<SearchTopic, Partial<SearchTopicProfile>>>;

let cachedProfiles: Record<SearchTopic, SearchTopicProfile> | undefined;

export function getSearchTopicProfile(topic: SearchTopic = "general"): SearchTopicProfile {
  return loadSearchTopicProfiles()[topic];
}

function loadSearchTopicProfiles(): Record<SearchTopic, SearchTopicProfile> {
  if (cachedProfiles) {
    return cachedProfiles;
  }

  const rawProfiles = readConfiguredProfiles();
  cachedProfiles = {
    general: normalizeProfile(rawProfiles.general),
    news: normalizeProfile(rawProfiles.news),
    finance: normalizeProfile(rawProfiles.finance),
  };

  return cachedProfiles;
}

function readConfiguredProfiles(): RawTopicProfiles {
  for (const configPath of candidateConfigPaths()) {
    if (!existsSync(configPath)) {
      continue;
    }

    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (isRawTopicProfiles(parsed)) {
      return parsed;
    }

    throw new Error(`Invalid search topic config: ${configPath}`);
  }

  return {};
}

function candidateConfigPaths(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(process.cwd(), "config/search-topics.json"),
    resolve(moduleDir, "../..", "config/search-topics.json"),
  ];
}

function normalizeProfile(profile?: Partial<SearchTopicProfile>): SearchTopicProfile {
  return {
    nativeCategory: profile?.nativeCategory === "news" ? "news" : undefined,
    queryTerms: normalizeTerms(profile?.queryTerms),
    rankingTerms: normalizeTerms(profile?.rankingTerms),
  };
}

function normalizeTerms(terms?: string[]): string[] {
  return Array.from(new Set(
    (terms ?? [])
      .map(term => term.trim())
      .filter(Boolean)
  ));
}

function isRawTopicProfiles(value: unknown): value is RawTopicProfiles {
  return typeof value === "object" && value !== null;
}
