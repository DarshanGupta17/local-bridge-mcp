import * as fs from "node:fs/promises";
import { LocalBridgeError } from "../core/errors.js";
import { WorkspacePathError } from "../workspace/filesystem.js";
import type { WorkspaceManager, ResolvedWorkspacePath } from "./workspaceManager.js";
import {
  isSensitivePath,
  isSensitiveDirectoryPath,
  requiresReadPermission,
  normalizeRelativePath,
} from "./sensitivePathDetector.js";
import { isProtectedPath, protectedPathMessage } from "./protectedPaths.js";
import type { LocalBridgeLimits } from "../config/limits.js";
import { isLikelyBinaryBuffer, detectMimeHint } from "../filesystem/binary.js";

export type FileOperation =
  | "read"
  | "search"
  | "write"
  | "create"
  | "delete"
  | "create_directory"
  | "delete_directory";

export interface PathClassification {
  sensitive: boolean;
  protected: boolean;
  requiresReadPrompt: boolean;
}

export class SecurityEngine {
  constructor(
    private readonly workspace: WorkspaceManager,
    readonly limits: LocalBridgeLimits
  ) {}

  classify(relativePath: string): PathClassification {
    const display = normalizeRelativePath(relativePath);
    return {
      sensitive: isSensitivePath(display) || isSensitiveDirectoryPath(display),
      protected: false,
      requiresReadPrompt: requiresReadPermission(display),
    };
  }

  assertNotProtected(relativePath: string, operation: FileOperation): void {
    const picked = this.workspace.pickRootForRelative(relativePath);
    const inner = picked.relativePath;

    if (operation === "delete_directory" && isProtectedPath(inner, "delete")) {
      throw new LocalBridgeError("PROTECTED_PATH", protectedPathMessage(inner));
    }
    if (operation === "delete" && isProtectedPath(inner, "delete")) {
      throw new LocalBridgeError("PROTECTED_PATH", protectedPathMessage(inner));
    }
  }

  async resolvePath(relativePath: string): Promise<ResolvedWorkspacePath> {
    try {
      return await this.workspace.resolve(relativePath);
    } catch (err) {
      throw mapPathError(err);
    }
  }

  async validateRead(relativePath: string): Promise<ResolvedWorkspacePath & { size: number }> {
    const resolved = await this.resolvePath(relativePath);
    const stat = await resolved.fs.statRelative(resolved.relativePath);
    if (stat.isDirectory()) {
      throw new LocalBridgeError("FILE_IS_DIRECTORY", `Path is a directory, not a file: ${resolved.displayPath}`);
    }
    if (stat.size > this.limits.maxReadFileSize) {
      throw new LocalBridgeError(
        "FILE_TOO_LARGE",
        `File exceeds LocalBridge's maximum readable size (${this.limits.maxReadFileSize} bytes).`
      );
    }
    return { ...resolved, size: stat.size };
  }

  async readTextOrBinaryMetadata(
    relativePath: string
  ): Promise<{ kind: "text"; content: string } | { kind: "binary"; meta: string }> {
    const validated = await this.validateRead(relativePath);
    const abs = await validated.fs.resolveRelativePath(validated.relativePath);
    const buf = await fs.readFile(abs);
    if (isLikelyBinaryBuffer(buf)) {
      const mime = detectMimeHint(validated.displayPath);
      return {
        kind: "binary",
        meta: [
          `Binary file. Text content is not available through read_file.`,
          `Path: ${validated.displayPath}`,
          `Size: ${validated.size} bytes`,
          mime ? `Type hint: ${mime}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    return { kind: "text", content: buf.toString("utf8") };
  }

  assertWriteSize(content: string): void {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > this.limits.maxWriteFileSize) {
      throw new LocalBridgeError(
        "FILE_TOO_LARGE",
        `Content exceeds LocalBridge's maximum writable size (${this.limits.maxWriteFileSize} bytes).`
      );
    }
  }

  mapError(err: unknown): LocalBridgeError | Error {
    if (err instanceof LocalBridgeError) {
      return err;
    }
    return mapPathError(err);
  }
}

function mapPathError(err: unknown): LocalBridgeError {
  if (err instanceof WorkspacePathError) {
    const msg = err.message;
    if (msg.includes("symlink")) {
      return new LocalBridgeError("SYMLINK_ESCAPE", msg);
    }
    if (msg.includes("outside") || msg.includes("traversal")) {
      return new LocalBridgeError("PATH_OUTSIDE_WORKSPACE", msg);
    }
    if (msg.includes("not found")) {
      return new LocalBridgeError("FILE_NOT_FOUND", msg);
    }
    if (msg.includes("already exists")) {
      return new LocalBridgeError("FILE_ALREADY_EXISTS", msg);
    }
    if (msg.includes("directory")) {
      return new LocalBridgeError("FILE_IS_DIRECTORY", msg);
    }
    return new LocalBridgeError("PATH_OUTSIDE_WORKSPACE", msg);
  }
  if (err instanceof Error) {
    return new LocalBridgeError("OPERATION_NOT_SUPPORTED", err.message);
  }
  return new LocalBridgeError("OPERATION_NOT_SUPPORTED", "Operation failed.");
}
