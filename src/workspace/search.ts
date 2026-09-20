import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WorkspaceFilesystem } from "./filesystem.js";
import { isSensitivePath, normalizeRelativePath } from "./security.js";

const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "target",
  "vendor",
]);

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

export async function searchInWorkspace(
  fsApi: WorkspaceFilesystem,
  query: string,
  scopePath?: string,
  options?: { allowSensitiveTargets?: boolean; maxFileBytes?: number }
): Promise<SearchMatch[]> {
  if (!query.trim()) {
    return [];
  }

  const allowSensitive = options?.allowSensitiveTargets ?? false;
  const maxFileBytes = options?.maxFileBytes ?? 2 * 1024 * 1024;
  const root = fsApi.root;
  const matches: SearchMatch[] = [];
  const maxMatches = 500;

  if (scopePath) {
    const displayScope = normalizeRelativePath(scopePath);
    const abs = await fsApi.resolveRelativePath(displayScope);
    const stat = await fs.stat(abs);

    if (stat.isFile()) {
      if (isSensitivePath(displayScope) && !allowSensitive) {
        throw new Error("Sensitive file search requires user approval before reading.");
      }
      await searchFile(abs, root, query, matches, maxMatches, allowSensitive, maxFileBytes);
      return matches;
    }

    if (stat.isDirectory()) {
      await walk(abs, root, query, matches, maxMatches, allowSensitive, maxFileBytes);
      return matches;
    }
  }

  await walk(root, root, query, matches, maxMatches, allowSensitive, maxFileBytes);
  return matches;
}

async function walk(
  dir: string,
  workspaceRoot: string,
  query: string,
  matches: SearchMatch[],
  maxMatches: number,
  allowSensitiveTargets: boolean,
  maxFileBytes: number
): Promise<void> {
  if (matches.length >= maxMatches) {
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (matches.length >= maxMatches) {
      break;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      await walk(full, workspaceRoot, query, matches, maxMatches, allowSensitiveTargets, maxFileBytes);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    await searchFile(full, workspaceRoot, query, matches, maxMatches, allowSensitiveTargets, maxFileBytes);
  }
}

async function searchFile(
  filePath: string,
  workspaceRoot: string,
  query: string,
  matches: SearchMatch[],
  maxMatches: number,
  allowSensitiveTargets: boolean,
  maxFileBytes: number
): Promise<void> {
  const relativeFile = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
  if (isSensitivePath(relativeFile) && !allowSensitiveTargets) {
    return;
  }

  let handle: import("node:fs/promises").FileHandle | undefined;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > maxFileBytes) {
      return;
    }
    handle = await fs.open(filePath, "r");
    const stream = handle.createReadStream({ encoding: "utf8" });
    let buffer = "";
    let lineNumber = 0;

    for await (const chunk of stream) {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        lineNumber += 1;
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.includes(query)) {
          matches.push({
            file: relativeFile,
            line: lineNumber,
            text: line.trimEnd(),
          });
          if (matches.length >= maxMatches) {
            return;
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    if (buffer.length > 0) {
      lineNumber += 1;
      if (buffer.includes(query)) {
        matches.push({
          file: relativeFile,
          line: lineNumber,
          text: buffer.trimEnd(),
        });
      }
    }
  } catch {
    // Skip unreadable files
  } finally {
    await handle?.close();
  }
}
