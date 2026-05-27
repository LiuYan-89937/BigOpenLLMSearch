# BigOpenLLMSearch

一个功能强大的 MCP (Model Context Protocol) 服务器，为 LLM 提供网页搜索、内容提取、网站爬取和深度研究能力。对标 Tavily，提供全面的联网搜索解决方案。

## 功能特性

| 功能 | 说明 |
|------|------|
| 🔍 **多引擎搜索** | 支持 Bing、Google、DuckDuckGo、Brave、SerpApi、SearXNG |
| 📄 **内容提取** | 从网页中提取干净、结构化的内容 |
| 🕷️ **网站爬取** | 递归爬取网站，支持深度和广度控制 |
| 🗺️ **网站地图** | 全面发现网站结构和页面 |
| 📊 **深度研究** | 多源搜索分析，生成研究报告 |
| 🧠 **语义搜索** | 相关性评分和关键短语提取 |
| ⚡ **结果缓存** | 内置缓存机制，提升响应速度 |

## 快速开始

### 1. 安装

```bash
# 克隆项目
git clone <repository-url>
cd WebSearchApi

# 安装依赖
npm install

# 构建项目
npm run build
```

### 2. 配置搜索引擎

复制环境变量配置文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的 API Key：

```env
# 必填：选择至少一个搜索引擎
BING_API_KEY=你的Bing密钥
GOOGLE_API_KEY=你的Google密钥
GOOGLE_SEARCH_ENGINE_ID=你的Google搜索引擎ID
BRAVE_API_KEY=你的Brave密钥
SERPAPI_API_KEY=你的SerpApi密钥
SEARXNG_URL=https://你的SearXNG实例地址
```

> **提示**：DuckDuckGo 无需 API Key，默认可用。如果未配置其他引擎，将使用 DuckDuckGo。

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
      "command": "node",
      "args": ["/你的路径/WebSearchApi/dist/index.js"],
      "env": {
        "BING_API_KEY": "你的Bing密钥",
        "GOOGLE_API_KEY": "你的Google密钥",
        "GOOGLE_SEARCH_ENGINE_ID": "你的搜索引擎ID"
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
      "command": "node",
      "args": ["/你的路径/WebSearchApi/dist/index.js"],
      "env": {}
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
| `include_answer` | boolean | false | 是否包含 AI 生成的答案 |
| `include_raw_content` | boolean | false | 是否包含完整网页内容 |
| `include_images` | boolean | false | 是否包含图片 |
| `include_domains` | string[] | [] | 限定搜索域名 |
| `exclude_domains` | string[] | [] | 排除的域名 |
| `country` | string | - | 优先显示特定国家结果 |
| `exact_match` | boolean | false | 精确匹配模式 |
| `engine` | string | - | 指定搜索引擎 |
| `semantic` | boolean | false | 启用语义搜索 |

**使用示例：**

```json
{
  "query": "2024年人工智能最新进展",
  "search_depth": "advanced",
  "max_results": 10,
  "time_range": "month",
  "include_answer": true
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

### 5. web_research - 深度研究

对特定主题进行全面研究。

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | string | 必填 | 研究问题或主题 |
| `max_sources` | number | 10 | 最大来源数 (3-20) |
| `search_depth` | string | "advanced" | 搜索深度：`basic`/`advanced` |
| `include_answer` | boolean | true | 是否生成综合答案 |
| `output_format` | string | "report" | 输出格式：`report`/`summary`/`bullet_points` |
| `time_range` | string | - | 时间范围过滤 |
| `engines` | string[] | - | 使用的搜索引擎 |

**使用示例：**

```json
{
  "query": "人工智能对医疗行业的影响",
  "max_sources": 15,
  "output_format": "report",
  "time_range": "year"
}
```

## 搜索深度对比

| 深度 | 延迟 | 相关性 | 说明 |
|------|------|--------|------|
| `ultra-fast` | 最低 | 良好 | 适合时间敏感的查询 |
| `fast` | 低 | 较好 | 快速获取结果 |
| `basic` | 中等 | 较好 | 通用搜索 |
| `advanced` | 高 | 最佳 | 最高相关性，每个源返回多个片段 |

## 与 Tavily 功能对比

| 功能 | Tavily | 本项目 |
|------|--------|--------|
| 网页搜索 | ✅ | ✅ 支持 6 个搜索引擎 |
| 内容提取 | ✅ | ✅ 支持 markdown/text 格式 |
| 网站爬取 | ✅ | ✅ 支持深度/广度控制 |
| 网站地图 | ✅ | ✅ 支持路径过滤 |
| 深度研究 | ✅ | ✅ 多源分析 + 报告生成 |
| 语义搜索 | ✅ | ✅ 相关性评分 + 关键短语提取 |
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
├── src/
│   ├── index.ts                 # MCP 服务器入口
│   ├── tools/
│   │   ├── search.ts           # 搜索工具
│   │   ├── extract.ts          # 提取工具
│   │   ├── crawl.ts            # 爬取工具
│   │   ├── map.ts              # 地图工具
│   │   └── research.ts         # 研究工具
│   ├── services/
│   │   ├── search-engines.ts   # 搜索引擎集成
│   │   ├── content-extractor.ts # 内容提取
│   │   ├── web-crawler.ts      # 网页爬虫
│   │   ├── site-mapper.ts      # 网站地图
│   │   └── semantic-search.ts  # 语义搜索
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
