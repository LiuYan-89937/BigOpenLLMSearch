import { fetchText } from "../utils/http-client.js";
import { extractChunks, parseHtml } from "../utils/html-parser.js";

export interface ExtractOptions {
  format?: "markdown" | "text";
  includeImages?: boolean;
  extractDepth?: "basic" | "advanced";
  chunksPerSource?: number;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  markdown?: string;
  images?: string[];
  favicon?: string;
}

export class ContentExtractor {
  async extract(url: string, options: ExtractOptions = {}): Promise<ExtractedContent> {
    const {
      format = "markdown",
      includeImages = false,
      extractDepth = "basic",
      chunksPerSource = 3,
    } = options;

    const response = await fetchText(url);
    const parsed = parseHtml(response.body, response.url);
    const plainText = parsed.content || parsed.text;
    const textContent = extractDepth === "advanced"
      ? extractChunks(plainText, chunksPerSource).join("\n\n[...]\n\n")
      : plainText.substring(0, 5000);
    const markdownContent = extractDepth === "advanced"
      ? extractChunks(parsed.markdown, chunksPerSource, 1200).join("\n\n[...]\n\n")
      : parsed.markdown;

    const result: ExtractedContent = {
      url,
      title: parsed.title,
      content: format === "markdown" ? markdownContent : textContent,
    };

    if (format === "markdown") {
      result.markdown = markdownContent;
    }

    if (includeImages) {
      result.images = parsed.images.map(image => image.src);
    }

    const favicon = parsed.metadata.icon ||
      parsed.metadata["shortcut icon"] ||
      parsed.metadata["og:image"] ||
      parsed.images.find(image => image.src.includes("favicon"))?.src;
    if (favicon) {
      result.favicon = favicon;
    }

    return result;
  }

  async extractMultiple(urls: string[], options: ExtractOptions = {}): Promise<ExtractedContent[]> {
    const results = await Promise.all(urls.map(async url => {
      try {
        return await this.extract(url, options);
      } catch (error) {
        return {
          url,
          title: "Error",
          content: `Failed to extract: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }));

    return results;
  }

  async extractFromSearchResults(
    results: Array<{ url: string; snippet?: string }>,
    options: ExtractOptions = {}
  ): Promise<ExtractedContent[]> {
    return this.extractMultiple(results.map(result => result.url), options);
  }
}

export const contentExtractor = new ContentExtractor();
