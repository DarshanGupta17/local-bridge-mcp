import * as path from "node:path";

const SENSITIVE_BASENAMES = new Set([
  "credentials.json",
  "secrets.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519",
  "id_dsa",
]);

const SENSITIVE_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks"];

const SENSITIVE_PATH_PATTERNS = [
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

export function isSensitivePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const base = path.posix.basename(normalized);

  if (base === ".env" || base.startsWith(".env.")) {
    return true;
  }
  if (SENSITIVE_BASENAMES.has(base)) {
    return true;
  }
  const ext = path.posix.extname(base).toLowerCase();
  if (SENSITIVE_EXTENSIONS.includes(ext)) {
    return true;
  }
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
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
    if (isSensitivePath(segments.slice(0, i).join("/"))) {
      return true;
    }
  }
  return false;
}

export function requiresReadPermission(relativePath: string): boolean {
  if (isSensitivePath(relativePath)) {
    return true;
  }
  const base = path.posix.basename(normalizeRelativePath(relativePath)).toLowerCase();
  if (/\.(sqlite|sqlite3|db)$/i.test(base)) {
    return true;
  }
  if (base === "database.json" || base === "databases.json" || base === "db.json") {
    return true;
  }
  return false;
}
