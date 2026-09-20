import * as path from "node:path";
import type { WorkspaceFilesystem } from "./filesystem.js";

const READ_PROTECTED_BASENAMES = new Set([
  "credentials.json",
  "secrets.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519",
  "id_dsa",
]);

const READ_PROTECTED_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks"];

const READ_PROTECTED_PATH_PATTERNS = [
  /^\.git\/config$/i,
  /^\.docker\/config\.json$/i,
  /^config[/\\]secrets(?:[/\\]|$)/i,
  /^secrets(?:[/\\]|$)/i,
  /^credentials(?:[/\\]|$)/i,
  /^\.ssh(?:[/\\]|$)/i,
];

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

/**
 * Paths that require explicit user approval before read/search exposure or high-risk mutations.
 */
export function isSensitivePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);

  const base = path.posix.basename(normalized);
  if (base === ".env" || base.startsWith(".env.")) {
    return true;
  }

  if (READ_PROTECTED_BASENAMES.has(base)) {
    return true;
  }

  const ext = path.posix.extname(base).toLowerCase();
  if (READ_PROTECTED_EXTENSIONS.includes(ext)) {
    return true;
  }

  for (const pattern of READ_PROTECTED_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

/** True when read_file must prompt (secrets, keys, common local DB credential files). */
export function requiresReadPermission(relativePath: string): boolean {
  if (isSensitivePath(relativePath)) {
    return true;
  }

  const normalized = normalizeRelativePath(relativePath);
  const base = path.posix.basename(normalized).toLowerCase();

  if (/\.(sqlite|sqlite3|db)$/i.test(base)) {
    return true;
  }

  if (base === "database.json" || base === "databases.json" || base === "db.json") {
    return true;
  }

  return false;
}

/** Resolve path and ensure it stays inside the workspace (throws WorkspacePathError). */
export async function validateWorkspacePath(
  fsApi: WorkspaceFilesystem,
  relativePath: string
): Promise<string> {
  return fsApi.resolveRelativePath(relativePath);
}

export async function isPathInsideWorkspace(
  fsApi: WorkspaceFilesystem,
  relativePath: string
): Promise<boolean> {
  try {
    await validateWorkspacePath(fsApi, relativePath);
    return true;
  } catch {
    return false;
  }
}

/** Directories that must never be deleted via delete_directory (checked before permission UI). */
export function isDeleteDirectoryBlocked(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized === ".git" || normalized.startsWith(".git/")) {
    return true;
  }
  if (normalized === "node_modules" || normalized.startsWith("node_modules/")) {
    return true;
  }
  return false;
}

export function isSensitiveDirectoryPath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  if (isSensitivePath(normalized)) {
    return true;
  }
  const segments = normalized.split("/").filter(Boolean);
  for (let i = 1; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join("/");
    if (isSensitivePath(prefix)) {
      return true;
    }
  }
  return false;
}
