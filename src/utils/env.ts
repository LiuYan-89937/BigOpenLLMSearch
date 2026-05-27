import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let loaded = false;

export function loadEnvFile(): void {
  if (loaded) {
    return;
  }

  loaded = true;

  for (const envPath of candidateEnvPaths()) {
    if (existsSync(envPath)) {
      applyEnvFile(envPath);
      return;
    }
  }
}

function candidateEnvPaths(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(process.cwd(), ".env"),
    resolve(moduleDir, "../..", ".env"),
  ];
}

function applyEnvFile(envPath: string): void {
  const content = readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = unquoteValue(trimmed.slice(separatorIndex + 1).trim());

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function unquoteValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
