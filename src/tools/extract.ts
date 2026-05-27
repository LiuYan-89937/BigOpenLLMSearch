import { z } from "zod";
import { contentExtractor, ExtractOptions } from "../services/content-extractor.js";
import { contentCache } from "../utils/cache.js";

const ExtractInputSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]).describe("One or more URLs to extract content from"),
  extract_depth: z.enum(["basic", "advanced"]).default("basic").describe(
    "'advanced' for more detailed extraction with chunks, 'basic' for faster extraction"
  ),
  format: z.enum(["markdown", "text"]).default("markdown").describe("Output format: 'markdown' or 'text'"),
  include_images: z.boolean().default(false).describe("Include images extracted from the pages"),
  chunks_per_source: z.number().min(1).max(5).default(3).describe("Number of content chunks per source (advanced mode only)"),
});

export type ExtractInput = z.infer<typeof ExtractInputSchema>;

export const extractToolDefinition = {
  name: "web_extract",
  description: "Extract clean, structured content from one or more web pages. Returns parsed text or markdown content with optional images. Useful for reading articles, documentation, or any web page content.",
  inputSchema: {
    type: "object" as const,
    properties: {
      urls: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
        description: "One or more URLs to extract content from",
      },
      extract_depth: {
        type: "string",
        enum: ["basic", "advanced"],
        default: "basic",
        description: "'advanced' for more detailed extraction with chunks, 'basic' for faster extraction",
      },
      format: {
        type: "string",
        enum: ["markdown", "text"],
        default: "markdown",
        description: "Output format: 'markdown' or 'text'",
      },
      include_images: {
        type: "boolean",
        default: false,
        description: "Include images extracted from the pages",
      },
      chunks_per_source: {
        type: "number",
        minimum: 1,
        maximum: 5,
        default: 3,
        description: "Number of content chunks per source (advanced mode only)",
      },
    },
    required: ["urls"],
  },
};

export class ExtractTool {
  static async execute(input: ExtractInput) {
    const urls = Array.isArray(input.urls) ? input.urls : [input.urls];
    
    const cacheKey = JSON.stringify(input);
    const cached = contentCache.get(cacheKey);
    if (cached) return cached;

    const options: ExtractOptions = {
      format: input.format,
      includeImages: input.include_images,
      extractDepth: input.extract_depth,
      chunksPerSource: input.chunks_per_source,
    };

    const results = await contentExtractor.extractMultiple(urls, options);

    const result = {
      results: results.map(r => ({
        url: r.url,
        title: r.title,
        content: r.content,
        markdown: r.markdown,
        images: r.images,
        favicon: r.favicon,
      })),
      total: results.length,
    };

    contentCache.set(cacheKey, result);
    return result;
  }
}
