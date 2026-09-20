import { normalizeRelativePath } from "./sensitivePathDetector.js";

/** Operations on these paths are forbidden (not merely permission-gated). */
export function isProtectedPath(relativePath: string, operation: "delete" | "write" | "read"): boolean {
  const normalized = normalizeRelativePath(relativePath);

  if (operation === "delete") {
    if (normalized === ".git" || normalized.startsWith(".git/")) {
      return true;
    }
    if (normalized === "node_modules" || normalized.startsWith("node_modules/")) {
      return true;
    }
  }

  return false;
}

export function protectedPathMessage(relativePath: string): string {
  if (relativePath === ".git" || relativePath.startsWith(".git/")) {
    return "Deletion of the .git directory is disabled in LocalBridge.";
  }
  return "This path is protected and cannot be modified through LocalBridge.";
}
