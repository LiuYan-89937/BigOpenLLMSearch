import axios from "axios";
import { parseHtml, extractChunks, ParsedContent } from "../utils/html-parser.js";

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
  private userAgent = "Mozilla/5.0 (compatible; WebSearchMCP/1.0)";

  async extract(url: string, options: ExtractOptions = {}): Promise<ExtractedContent> {
    const {
      format = "markdown",
      includeImages = false,
      extractDepth = "basic",
      chunksPerSource = 3,
    } = options;

    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": this.userAgent,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        timeout: 30000,
        maxRedirects: 5,
      });

      const html = response.data;
      const parsed = parseHtml(html, url);

      let content: string;
      if (extractDepth === "advanced") {
        const chunks = extractChunks(parsed.content, chunksPerSource);
        content = chunks.join("\n\n[...]\n\n");
      } else {
        content = parsed.content.substring(0, 5000);
      }

      const result: ExtractedContent = {
        url,
        title: parsed.title,
        content: format === "markdown" ? parsed.markdown : content,
      };

      if (format === "markdown") {
        result.markdown = parsed.markdown;
      }

      if (includeImages) {
        result.images = parsed.images.map(img => img.src);
      }

      const favicon = parsed.metadata["favicon"] || 
                      parsed.images.find(img => img.src.includes("favicon"))?.src;
      if (favicon) {
        result.favicon = favicon;
      }

      return result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to extract content from ${url}: ${error.message}`);
      }
      throw error;
    }
  }

  async extractMultiple(urls: string[], options: ExtractOptions = {}): Promise<ExtractedContent[]> {
    const promises = urls.map(url => 
      this.extract(url, options).catch(error => ({
        url,
        title: "Error",
        content: `Failed to extract: ${error.message}`,
      }))
    );

    return Promise.all(promises);
  }

  async extractFromSearchResults(
    results: Array<{ url: string; snippet?: string }>,
    options: ExtractOptions = {}
  ): Promise<ExtractedContent[]> {
    const urls = results.map(r => r.url);
    return this.extractMultiple(urls, options);
  }
}

export const contentExtractor = new ContentExtractor();
