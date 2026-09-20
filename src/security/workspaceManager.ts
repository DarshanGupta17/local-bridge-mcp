import * as path from "node:path";
import type * as vscode from "vscode";
import { WorkspaceFilesystem, WorkspacePathError } from "../workspace/filesystem.js";
import { normalizeRelativePath } from "./sensitivePathDetector.js";

export interface ResolvedWorkspacePath {
  /** Path relative to the workspace root (no multi-root folder prefix). */
  relativePath: string;
  /** Path shown to users and MCP clients (may include `folderName/` prefix). */
  displayPath: string;
  fs: WorkspaceFilesystem;
  rootName: string;
}

export class WorkspaceManager {
  private constructor(private readonly entries: { name: string; fs: WorkspaceFilesystem }[]) {}

  static async create(folders: readonly vscode.WorkspaceFolder[]): Promise<WorkspaceManager> {
    if (!folders.length) {
      throw new WorkspacePathError("No workspace folders are open.");
    }
    const entries: { name: string; fs: WorkspaceFilesystem }[] = [];
    for (const folder of folders) {
      const fsApi = await WorkspaceFilesystem.create(folder.uri.fsPath);
      entries.push({ name: folder.name, fs: fsApi });
    }
    return new WorkspaceManager(entries);
  }

  get roots(): { name: string; path: string }[] {
    return this.entries.map((e) => ({ name: e.name, path: e.fs.root }));
  }

  get primary(): WorkspaceFilesystem {
    return this.entries[0]!.fs;
  }

  /** Backward-compatible single-root accessor. */
  get filesystem(): WorkspaceFilesystem {
    return this.primary;
  }

  pickRootForRelative(relativePath: string): ResolvedWorkspacePath {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized || normalized === ".") {
      const first = this.entries[0]!;
      return {
        relativePath: ".",
        displayPath: ".",
        fs: first.fs,
        rootName: first.name,
      };
    }

    const segments = normalized.split("/").filter(Boolean);
    if (this.entries.length > 1 && segments.length > 1) {
      const head = segments[0]!;
      const match = this.entries.find((e) => e.name === head);
      if (match) {
        const inner = segments.slice(1).join("/");
        return {
          relativePath: inner || ".",
          displayPath: `${match.name}/${inner}`.replace(/\/$/, ""),
          fs: match.fs,
          rootName: match.name,
        };
      }
    }

    const first = this.entries[0]!;
    return {
      relativePath: normalized,
      displayPath: normalized,
      fs: first.fs,
      rootName: first.name,
    };
  }

  async resolve(relativePath: string): Promise<ResolvedWorkspacePath> {
    const picked = this.pickRootForRelative(relativePath);
    await picked.fs.resolveRelativePath(picked.relativePath);
    return picked;
  }

  async resolveAbsolute(relativePath: string): Promise<ResolvedWorkspacePath & { absolutePath: string }> {
    const picked = this.pickRootForRelative(relativePath);
    const absolutePath = await picked.fs.resolveRelativePath(picked.relativePath);
    return { ...picked, absolutePath };
  }

  /** Search all workspace roots when no scope is provided. */
  allFilesystems(): WorkspaceFilesystem[] {
    return this.entries.map((e) => e.fs);
  }
}
