# BigOpenLLMSearch

一个功能强大的 MCP (Model Context Protocol) 服务器，为 LLM 提供网页搜索、内容提取、网站爬取和网站地图能力。既可直接使用 Tavily，也可组合自建和其他商业搜索 Provider。

## 功能特性

| 功能 | 说明 |
|------|------|
| 🔍 **多引擎搜索** | 支持 Tavily、SearXNG、DuckDuckGo、Bing、Google、Brave、SerpApi |
| 📄 **内容提取** | 从网页中提取干净、结构化的内容 |
| 🕷️ **网站爬取** | 递归爬取网站，支持深度和广度控制 |
| 🗺️ **网站地图** | 全面发现网站结构和页面 |
| 🧠 **成熟检索** | Query planning、RRF 融合、正文/向量混合重排 |
| ⚡ **结果缓存** | 内置缓存机制，提升响应速度 |

## 快速开始

### 1. 安装 / 运行

```bash
# npm 包发布后，MCP 客户端可直接通过 npx 启动
npx -y bigopen-llm-search
```

本地开发时再克隆仓库：

```bash
git clone <repository-url>
cd WebSearchApi
npm install
npm run build
```

### 2. 配置搜索引擎

复制环境变量配置文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的搜索引擎配置。追求稳定召回时推荐 Tavily；完全自建时使用 SearXNG：

```env
# 方案一：Tavily；配置后默认使用 Tavily
TAVILY_API_KEY=你的Tavily密钥

# 方案二：已有 SearXNG 实例
SEARXNG_URL=http://127.0.0.1:8888

# 方案三：没有现成实例时，让 MCP 在首次搜索前自动拉起本地 Docker 容器
SEARXNG_AUTO_START=true
SEARXNG_DOCKER_PORT=8888
SEARXNG_LANGUAGE=zh-CN
SEARXNG_PAGE_COUNT=3

# 可选：显式指定搜索引擎
DEFAULT_SEARCH_ENGINE=tavily

# 可选：商业搜索 API
BING_API_KEY=你的Bing密钥
GOOGLE_API_KEY=你的Google密钥
GOOGLE_SEARCH_ENGINE_ID=你的Google搜索引擎ID
BRAVE_API_KEY=你的Brave密钥
SERPAPI_API_KEY=你的SerpApi密钥

# 可选：启用 include_answer 的 AI 生成答案
LLM_API_KEY=你的OpenAI兼容接口密钥
LLM_MODEL=你的模型名
LLM_BASE_URL=https://你的OpenAI兼容接口/v1

# 可选：启用正文 chunk 的向量重排
EMBEDDING_API_KEY=你的OpenAI兼容接口密钥
EMBEDDING_MODEL=你的embedding模型名
EMBEDDING_BASE_URL=https://你的OpenAI兼容接口/v1
```

> **默认顺序**：显式 `DEFAULT_SEARCH_ENGINE` 优先；否则依次选择已配置的 Tavily、SearXNG，最后降级为 DuckDuckGo。
> **自动 Docker**：`SEARXNG_AUTO_START=true` 需要本机已安装并启动 Docker。服务会创建/复用名为 `bigopen-llm-search-searxng` 的容器，并在 `~/.bigopen-llm-search/searxng/config/settings.yml` 生成启用 `json` 输出的 SearXNG 配置。
> **AI 答案**：`LLM_API_KEY` 和 `LLM_MODEL` 同时存在时，`include_answer` 会调用 OpenAI 兼容接口生成带来源约束的答案；未配置时会自动降级为基于搜索结果/正文的抽取式摘要。
> **成熟检索**：`web_search` 会执行 query planning、多路召回、URL 去重、RRF 融合和混合重排。配置 `EMBEDDING_MODEL` 后，advanced/semantic 搜索会对正文 chunks 做向量重排；未配置时自动降级为关键词和正文相关性重排。
> **Topic 策略**：`topic` 的查询扩展词和重排词集中放在 `config/search-topics.json`，不要在搜索代码里为具体关键词加特例。

### 3. 启动服务

```bash
npm start
```

### 4. 配置 MCP 客户端

#### Claude Desktop

编辑配置文件 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "web-search": {
      "command": "npx",
      "args": ["-y", "bigopen-llm-search"],
      "env": {
        "SEARXNG_AUTO_START": "true"
      }
    }
  }
}
```

#### Cursor

在 MCP 配置中添加：

```json
{
  "mcpServers": {
    "web-search": {
      "command": "npx",
      "args": ["-y", "bigopen-llm-search"],
      "env": {
        "SEARXNG_AUTO_START": "true"
      }
    }
  }
}
```

## 工具详细说明

### 1. web_search - 网页搜索

搜索网页获取实时信息。

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | string | 必填 | 搜索查询词 |
| `search_depth` | string | "basic" | 搜索深度：`ultra-fast`/`fast`/`basic`/`advanced` |
| `topic` | string | "general" | 搜索类别：`general`/`news`/`finance` |
| `max_results` | number | 5 | 最大结果数 (1-20) |
| `time_range` | string | - | 时间范围：`day`/`week`/`month`/`year` |
| `start_date` | string | - | 起始日期 (YYYY-MM-DD) |
| `end_date` | string | - | 结束日期 (YYYY-MM-DD) |
| `include_answer` | boolean | false | 是否包含答案；配置 LLM 时为 AI 生成，否则为抽取式摘要 |
| `include_raw_content` | boolean | false | 是否包含完整网页内容 |
| `include_images` | boolean | false | 是否包含图片 |
| `include_domains` | string[] | [] | 限定搜索域名 |
| `exclude_domains` | string[] | [] | 排除的域名 |
| `country` | string | - | 优先显示特定国家结果 |
| `exact_match` | boolean | false | 精确匹配模式 |
| `engine` | string | - | 指定搜索引擎 |
| `engines` | string[] | - | 指定多个搜索引擎做多路召回 |
| `language` | string | - | 搜索语言，传给支持的搜索引擎 |
| `searxng_engines` | string[] | - | 指定 SearXNG 上游 engines |
| `safesearch` | number | - | SearXNG 安全搜索等级：0/1/2 |
| `page_count` | number | - | SearXNG 召回页数 (1-5) |
| `max_recall_queries` | number | - | Query planner 最多生成的召回查询数 (1-6) |
| `candidate_limit` | number | - | RRF 融合后进入重排的候选上限 |
| `include_ranking_debug` | boolean | false | 返回召回查询、matched chunks 和 ranking signals |
| `semantic` | boolean | false | 启用正文/向量重排；配置 embedding 时使用向量 |

**使用示例：**

```json
{
  "query": "2024年人工智能最新进展",
  "search_depth": "advanced",
  "max_results": 10,
  "time_range": "month",
  "include_answer": true,
  "include_ranking_debug": true
}
```

### 2. web_extract - 内容提取

从网页中提取干净的内容。

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `urls` | string \| string[] | 必填 | 要提取的 URL（支持单个或数组） |
| `extract_depth` | string | "basic" | 提取深度：`basic`/`advanced` |
| `format` | string | "markdown" | 输出格式：`markdown`/`text` |
| `include_images` | boolean | false | 是否提取图片 |
| `chunks_per_source` | number | 3 | 每个源的内容块数 (1-5) |

**使用示例：**

```json
{
  "urls": ["https://example.com/article1", "https://example.com/article2"],
  "format": "markdown",
  "extract_depth": "advanced"
}
```

### 3. web_crawl - 网站爬取

从指定 URL 开始爬取网站。

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | string | 必填 | 起始 URL |
| `instructions` | string | - | 自然语言爬取指令 |
| `max_depth` | number | 2 | 最大爬取深度 (1-5) |
| `max_breadth` | number | 20 | 每页最大链接数 (1-50) |
| `limit` | number | 50 | 最大爬取页面数 (1-200) |
| `select_paths` | string[] | - | 仅爬取匹配的路径 |
| `select_domains` | string[] | - | 仅爬取指定域名 |
| `exclude_paths` | string[] | - | 排除的路径 |
| `exclude_domains` | string[] | - | 排除的域名 |
| `allow_external` | boolean | false | 是否允许外部域名 |

**使用示例：**

```json
{
  "url": "https://docs.example.com",
  "instructions": "查找所有 API 文档页面",
  "max_depth": 3,
  "select_paths": ["/api", "/docs"]
}
```

### 4. web_map - 网站地图

生成全面的网站地图。

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | string | 必填 | 起始 URL |
| `instructions` | string | - | 自然语言指令 |
| `max_depth` | number | 2 | 最大探索深度 (1-5) |
| `max_breadth` | number | 20 | 每页最大链接数 (1-50) |
| `limit` | number | 100 | 最大页面数 (1-500) |
| `select_paths` | string[] | - | 仅包含匹配的路径 |
| `select_domains` | string[] | - | 仅包含指定域名 |
| `exclude_paths` | string[] | - | 排除的路径 |
| `exclude_domains` | string[] | - | 排除的域名 |
| `allow_external` | boolean | false | 是否允许外部域名 |

**使用示例：**

```json
{
  "url": "https://example.com",
  "max_depth": 3,
  "limit": 200
}
```

## 搜索深度对比

| 深度 | 延迟 | 相关性 | 说明 |
|------|------|--------|------|
| `ultra-fast` | 最低 | 良好 | 保留搜索引擎原始顺序，最少候选扩展 |
| `fast` | 低 | 较好 | 快速获取结果，并做轻量后过滤 |
| `basic` | 中等 | 较好 | 扩展候选结果并按标题/摘要/URL 相关性重排 |
| `advanced` | 高 | 最佳 | 扩展更多候选结果，强化相关性重排；配合 `include_raw_content` 可提取正文 |

## 与 Tavily 功能对比

| 功能 | Tavily | 本项目 |
|------|--------|--------|
| 网页搜索 | ✅ | ✅ 可直接使用 Tavily，并支持另外 6 个搜索引擎 |
| 内容提取 | ✅ | ✅ 支持 markdown/text 格式 |
| 网站爬取 | ✅ | ✅ 支持深度/广度控制 |
| 网站地图 | ✅ | ✅ 支持路径过滤 |
| 成熟检索 | ✅ | ✅ Query planning + RRF + 正文/向量混合重排 |
| 自定义搜索引擎 | ❌ | ✅ 支持多种搜索引擎 |
| 开源免费 | ❌ | ✅ 完全开源 |

## 开发命令

```bash
# 开发模式（热重载）
npm run dev

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

## 项目结构

```
BigOpenLLMSearch/
├── config/
│   └── search-topics.json      # topic 查询扩展与重排策略
├── src/
│   ├── index.ts                 # MCP 服务器入口
│   ├── tools/
│   │   ├── search.ts           # 搜索工具
│   │   ├── extract.ts          # 提取工具
│   │   ├── crawl.ts            # 爬取工具
│   │   └── map.ts              # 地图工具
│   ├── services/
│   │   ├── search-engines.ts   # 搜索引擎集成
│   │   ├── content-extractor.ts # 内容提取
│   │   ├── web-crawler.ts      # 网页爬虫
│   │   ├── site-mapper.ts      # 网站地图
│   │   ├── search-pipeline.ts  # 成熟搜索管线
│   │   ├── search-planner.ts   # 查询规划
│   │   ├── search-fusion.ts    # URL 去重与 RRF 融合
│   │   ├── search-reranker.ts  # 正文/向量混合重排
│   │   └── embedding-client.ts # 向量接口
│   └── utils/
│       ├── html-parser.ts      # HTML 解析
│       └── cache.ts            # 缓存机制
├── package.json
├── tsconfig.json
├── .env.example                # 环境变量模板
└── README.md
```

## 缓存机制

- 搜索结果缓存：10 分钟
- 内容提取缓存：30 分钟
- 最大缓存条目：500-1000

## 错误处理

所有工具返回统一的错误格式：

```json
{
  "error": "错误描述信息"
}
```

## 许可证

MIT

## 致谢

- [Model Context Protocol](https://modelcontextprotocol.io) - MCP 规范
- [Anthropic](https://www.anthropic.com) - Claude Desktop
- 设计灵感来源于 [Tavily](https://tavily.com)
