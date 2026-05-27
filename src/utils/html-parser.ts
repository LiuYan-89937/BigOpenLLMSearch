import * as cheerio from "cheerio";
import TurndownService from "turndown";

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export interface ParsedContent {
  title: string;
  description: string;
  content: string;
  markdown: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  images: Array<{ src: string; alt?: string }>;
  headings: Array<{ level: number; text: string }>;
  metadata: Record<string, string>;
}

export function parseHtml(html: string, url?: string): ParsedContent {
  const $ = cheerio.load(html);

  $("script, style, nav, footer, header, aside, iframe, noscript").remove();

  const title = $("title").text().trim() || 
                $("h1").first().text().trim() || 
                $("meta[property='og:title']").attr("content") || "";

  const description = $("meta[name='description']").attr("content") || 
                      $("meta[property='og:description']").attr("content") || 
                      $("p").first().text().substring(0, 200).trim();

  const links: Array<{ text: string; href: string }> = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href && text && !href.startsWith("#") && !href.startsWith("javascript:")) {
      try {
        const absoluteUrl = url ? new URL(href, url).href : href;
        links.push({ text, href: absoluteUrl });
      } catch {
        links.push({ text, href });
      }
    }
  });

  const images: Array<{ src: string; alt?: string }> = [];
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    const alt = $(el).attr("alt");
    if (src) {
      try {
        const absoluteUrl = url ? new URL(src, url).href : src;
        images.push({ src: absoluteUrl, alt });
      } catch {
        images.push({ src, alt });
      }
    }
  });

  const headings: Array<{ level: number; text: string }> = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = parseInt(el.tagName.substring(1));
    const text = $(el).text().trim();
    if (text) {
      headings.push({ level, text });
    }
  });

  const metadata: Record<string, string> = {};
  $("meta").each((_, el) => {
    const name = $(el).attr("name") || $(el).attr("property");
    const content = $(el).attr("content");
    if (name && content) {
      metadata[name] = content;
    }
  });

  const bodyHtml = $("body").html() || "";
  const markdown = turndownService.turndown(bodyHtml);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  const mainContent = extractMainContent($);

  return {
    title,
    description,
    content: mainContent,
    markdown,
    text,
    links,
    images,
    headings,
    metadata,
  };
}

function extractMainContent($: cheerio.CheerioAPI): string {
  const contentSelectors = [
    "article",
    '[role="main"]',
    "main",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content",
    "#content",
  ];

  for (const selector of contentSelectors) {
    const element = $(selector);
    if (element.length && element.text().trim().length > 100) {
      return element.text().replace(/\s+/g, " ").trim();
    }
  }

  const paragraphs: string[] = [];
  $("p").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 50) {
      paragraphs.push(text);
    }
  });

  return paragraphs.join("\n\n");
}

export function extractChunks(content: string, maxChunks: number = 3, chunkSize: number = 500): string[] {
  const chunks: string[] = [];
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  let currentChunk = "";
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
      if (chunks.length >= maxChunks) break;
    }
    currentChunk += sentence + ". ";
  }
  
  if (currentChunk.trim() && chunks.length < maxChunks) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}
