export interface RelevanceField {
  text?: string;
  weight: number;
}

export interface SourceText {
  title?: string;
  snippet?: string;
  content?: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "this", "that", "these",
  "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
  "who", "whom", "when", "where", "why", "how", "all", "each", "every",
  "both", "few", "more", "most", "other", "some", "such", "no", "not",
  "only", "own", "same", "so", "than", "too", "very", "just", "because",
  "as", "until", "while", "during", "before", "after", "above", "below",
  "between", "through",
]);

export function tokenizeMeaningfulText(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens = new Set<string>();
  const matches = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];

  for (const match of matches) {
    if (/^\p{Script=Han}+$/u.test(match)) {
      addCjkTokens(match, tokens);
      continue;
    }

    if (match.length > 2 && !STOP_WORDS.has(match)) {
      tokens.add(match);
    }
  }

  return Array.from(tokens);
}

export function scoreTextRelevance(query: string, fields: RelevanceField[]): number {
  const queryTerms = tokenizeMeaningfulText(query);
  if (queryTerms.length === 0) {
    return 0;
  }

  const maxWeight = fields.reduce((sum, field) => sum + field.weight, 0);
  const matchedTerms = new Set<string>();
  let weightedMatches = 0;

  for (const term of queryTerms) {
    for (const field of fields) {
      const fieldText = field.text?.toLowerCase();
      if (fieldText?.includes(term)) {
        weightedMatches += field.weight;
        matchedTerms.add(term);
      }
    }
  }

  const exactPhrase = query.trim().toLowerCase();
  const exactPhraseBonus = exactPhrase.length > 0 && fields.some(field => field.text?.toLowerCase().includes(exactPhrase))
    ? 0.15
    : 0;

  const coverage = matchedTerms.size / queryTerms.length;
  const weightedScore = maxWeight > 0
    ? weightedMatches / (queryTerms.length * maxWeight)
    : 0;

  return Math.min((weightedScore * 0.7) + (coverage * 0.3) + exactPhraseBonus, 1);
}

export function extractKeyPhrases(text: string, maxPhrases = 5): string[] {
  const tokens = tokenizeMeaningfulText(text);
  const phraseCounts = new Map<string, number>();
  const source = text.toLowerCase();

  for (const token of tokens) {
    const count = countOccurrences(source, token);
    if (count > 0) {
      phraseCounts.set(token, count);
    }
  }

  return Array.from(phraseCounts.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, maxPhrases)
    .map(([phrase]) => phrase);
}

export function extractRelevantSentences(query: string, sources: SourceText[], limit: number): string[] {
  const seen = new Set<string>();
  const sentences = sources.flatMap(source => splitSentences(source.content || source.snippet || ""));

  return sentences
    .map(sentence => ({
      text: sentence,
      score: scoreTextRelevance(query, [{ text: sentence, weight: 1 }]),
    }))
    .filter(sentence => {
      if (sentence.score <= 0 || seen.has(sentence.text)) {
        return false;
      }

      seen.add(sentence.text);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(sentence => sentence.text);
}

export function generateExtractiveAnswer(
  query: string,
  sources: SourceText[],
  format: "plain" | "summary" | "bullet_points" | "report" = "plain"
): string {
  const sentences = extractRelevantSentences(query, sources, format === "report" ? 8 : 3);

  if (sentences.length === 0) {
    const fallback = sources.find(source => source.snippet || source.content);
    return fallback?.snippet || fallback?.content || "No relevant information found.";
  }

  if (format === "bullet_points") {
    return sentences.map(sentence => `- ${sentence}`).join("\n");
  }

  if (format === "report") {
    return `Key information:\n${sentences.map(sentence => `- ${sentence}`).join("\n")}`;
  }

  return sentences.join(". ") + ".";
}

export function createInstructionMatcher(instructions?: string) {
  const terms = tokenizeMeaningfulText(instructions ?? "");

  return {
    hasInstructions: terms.length > 0,
    score(text: string): number {
      if (terms.length === 0) {
        return 0;
      }

      const normalized = text.toLowerCase();
      const matched = terms.filter(term => normalized.includes(term)).length;
      return matched / terms.length;
    },
  };
}

function addCjkTokens(text: string, tokens: Set<string>): void {
  if (text.length <= 1) {
    return;
  }

  tokens.add(text);

  if (text.length <= 2) {
    return;
  }

  for (let index = 0; index < text.length - 1; index++) {
    tokens.add(text.slice(index, index + 2));
  }
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?。！？]+/)
    .map(sentence => sentence.replace(/\s+/g, " ").trim())
    .filter(sentence => sentence.length > 30);
}

function countOccurrences(source: string, token: string): number {
  let count = 0;
  let index = source.indexOf(token);

  while (index !== -1) {
    count++;
    index = source.indexOf(token, index + token.length);
  }

  return count;
}
