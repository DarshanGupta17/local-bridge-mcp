import type { WorkspaceFilesystem } from "./filesystem.js";
import {
  isSensitivePath,
  isSensitiveDirectoryPath,
  normalizeRelativePath,
  requiresReadPermission,
} from "../security/sensitivePathDetector.js";
import { isProtectedPath } from "../security/protectedPaths.js";

export {
  isSensitivePath,
  isSensitiveDirectoryPath,
  normalizeRelativePath,
  requiresReadPermission,
};

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

export function isDeleteDirectoryBlocked(relativePath: string): boolean {
  return isProtectedPath(normalizeRelativePath(relativePath), "delete");
}
