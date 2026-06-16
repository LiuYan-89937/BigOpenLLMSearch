import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import axios from "axios";

interface CommandResult {
  stdout: string;
  stderr: string;
  failed: boolean;
}

interface SearXNGDockerConfig {
  baseUrl: string;
  containerName: string;
  image: string;
  hostPort: string;
  configDir: string;
  dataDir: string;
  startTimeoutMs: number;
}

let startupPromise: Promise<void> | undefined;

export function isSearXNGAutoStartEnabled(): boolean {
  return parseBoolean(process.env.SEARXNG_AUTO_START);
}

export function resolveSearXNGBaseUrl(): string {
  const configuredUrl = process.env.SEARXNG_URL?.trim();
  if (configuredUrl) {
    return trimTrailingSlash(configuredUrl);
  }

  return `http://127.0.0.1:${resolveSearXNGDockerPort()}`;
}

export async function ensureSearXNGRuntime(): Promise<void> {
  if (!isSearXNGAutoStartEnabled()) {
    return;
  }

  startupPromise ??= startSearXNGDockerRuntime();
  await startupPromise;
}

async function startSearXNGDockerRuntime(): Promise<void> {
  const config = resolveDockerConfig();
  if (!isLocalHttpUrl(config.baseUrl)) {
    throw new Error("SEARXNG_AUTO_START only supports local SEARXNG_URL values such as http://127.0.0.1:8888");
  }

  await ensureDockerAvailable();
  ensureSearXNGDirectories(config);

  const containerState = await inspectContainer(config.containerName);
  if (containerState === "running") {
    await waitForHttp(config.baseUrl, config.startTimeoutMs);
    return;
  }

  if (containerState === "stopped") {
    await dockerCommand(["start", config.containerName]);
  } else {
    await dockerCommand([
      "run",
      "--name", config.containerName,
      "-d",
      "-p", `127.0.0.1:${config.hostPort}:8080`,
      "-v", `${config.configDir}:/etc/searxng`,
      "-v", `${config.dataDir}:/var/cache/searxng`,
      config.image,
    ]);
  }

  await waitForHttp(config.baseUrl, config.startTimeoutMs);
}

function resolveDockerConfig(): SearXNGDockerConfig {
  return {
    baseUrl: resolveSearXNGBaseUrl(),
    containerName: process.env.SEARXNG_DOCKER_CONTAINER_NAME?.trim() || "bigopen-llm-search-searxng",
    image: process.env.SEARXNG_DOCKER_IMAGE?.trim() || "docker.io/searxng/searxng:latest",
    hostPort: resolveSearXNGDockerPort(),
    configDir: resolvePath(process.env.SEARXNG_DOCKER_CONFIG_DIR, ".bigopen-llm-search/searxng/config"),
    dataDir: resolvePath(process.env.SEARXNG_DOCKER_DATA_DIR, ".bigopen-llm-search/searxng/data"),
    startTimeoutMs: parsePositiveInteger(process.env.SEARXNG_DOCKER_START_TIMEOUT_MS, 30_000),
  };
}

function resolveSearXNGDockerPort(): string {
  const configuredPort = process.env.SEARXNG_DOCKER_PORT?.trim();
  if (configuredPort) {
    return configuredPort;
  }

  const urlPort = extractPort(process.env.SEARXNG_URL);
  if (urlPort) {
    return urlPort;
  }

  return "8888";
}

async function ensureDockerAvailable(): Promise<void> {
  const result = await dockerCommand(["version", "--format", "{{.Server.Version}}"], true);
  if (result.failed) {
    throw new Error(`Docker is not available or not running: ${formatCommandFailure(result)}`);
  }
}

async function inspectContainer(containerName: string): Promise<"missing" | "running" | "stopped"> {
  const result = await dockerCommand(["container", "inspect", containerName, "--format", "{{.State.Running}}"], true);
  if (!result.failed) {
    return result.stdout.trim() === "true" ? "running" : "stopped";
  }

  const failure = `${result.stdout}\n${result.stderr}`;
  if (failure.includes("No such object") || failure.includes("No such container")) {
    return "missing";
  }

  throw new Error(`Unable to inspect SearXNG Docker container '${containerName}': ${formatCommandFailure(result)}`);
}

function ensureSearXNGDirectories(config: SearXNGDockerConfig): void {
  const settingsPath = join(config.configDir, "settings.yml");
  mkdirSync(config.configDir, { recursive: true });
  mkdirSync(config.dataDir, { recursive: true });

  if (existsSync(settingsPath)) {
    return;
  }

  const secretKey = randomBytes(32).toString("hex");
  writeFileSync(settingsPath, [
    "use_default_settings: true",
    "",
    "server:",
    "  bind_address: \"0.0.0.0\"",
    `  secret_key: "${secretKey}"`,
    "",
    "search:",
    "  formats:",
    "    - html",
    "    - json",
    "",
  ].join("\n"));
}

function dockerCommand(args: string[], allowFailure = false): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { timeout: 60_000 }, (error, stdout, stderr) => {
      const result = {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        failed: Boolean(error),
      };

      if (error && !allowFailure) {
        reject(new Error(`Docker command failed: docker ${args.join(" ")}\n${formatCommandFailure(result)}`));
        return;
      }

      resolve(result);
    });
  });
}

async function waitForHttp(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      await axios.get(baseUrl, {
        timeout: 2_000,
        validateStatus: status => status >= 200 && status < 500,
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(1_000);
    }
  }

  throw new Error(`SearXNG did not become reachable at ${baseUrl} within ${timeoutMs}ms. Last error: ${lastError}`);
}

function parseBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolvePath(configuredPath: string | undefined, defaultPath: string): string {
  const targetPath = configuredPath?.trim() || join(homedir(), defaultPath);
  if (targetPath.startsWith("~/")) {
    return join(homedir(), targetPath.slice(2));
  }

  return resolve(targetPath);
}

function extractPort(url: string | undefined): string | undefined {
  if (!url?.trim()) {
    return undefined;
  }

  try {
    return new URL(url).port || undefined;
  } catch {
    return undefined;
  }
}

function isLocalHttpUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return ["http:", "https:"].includes(parsedUrl.protocol)
      && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function formatCommandFailure(result: CommandResult): string {
  return [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") || "no output";
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
