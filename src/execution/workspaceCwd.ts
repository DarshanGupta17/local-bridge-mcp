import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LocalBridgeError } from "../core/errors.js";
import type { WorkspaceManager } from "../security/workspaceManager.js";
import { normalizeRelativePath } from "../security/sensitivePathDetector.js";

export async function resolveCommandCwd(
  workspace: WorkspaceManager,
  cwdRelative?: string
): Promise<string> {
  if (cwdRelative === undefined || cwdRelative.trim() === "" || cwdRelative.trim() === ".") {
    return workspace.primary.root;
  }

  const resolved = await workspace.resolveAbsolute(normalizeRelativePath(cwdRelative));
  const stat = await fs.stat(resolved.absolutePath).catch(() => undefined);
  if (!stat?.isDirectory()) {
    throw new LocalBridgeError("OPERATION_NOT_SUPPORTED", "cwd must be an existing workspace directory.");
  }
  return resolved.absolutePath;
}

export function isPathInsideRoot(root: string, target: string): boolean {
  const rootNorm = path.resolve(root);
  const targetNorm = path.resolve(target);
  const rel = path.relative(rootNorm, targetNorm);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
