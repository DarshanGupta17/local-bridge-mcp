import * as fs from "node:fs/promises";
import * as path from "node:path";
import { normalizeRelativePath } from "./security.js";

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

export class WorkspaceFilesystem {
  private readonly workspaceRoot: string;
  private readonly workspaceRootReal: string;

  private constructor(workspaceRoot: string, workspaceRootReal: string) {
    this.workspaceRoot = workspaceRoot;
    this.workspaceRootReal = workspaceRootReal;
  }

  static async create(workspaceRoot: string): Promise<WorkspaceFilesystem> {
    const resolved = path.resolve(workspaceRoot);
    let real: string;
    try {
      real = await fs.realpath(resolved);
    } catch {
      throw new WorkspacePathError(`Workspace folder is not accessible: ${workspaceRoot}`);
    }
    return new WorkspaceFilesystem(resolved, real);
  }

  get root(): string {
    return this.workspaceRoot;
  }

  get rootReal(): string {
    return this.workspaceRootReal;
  }

  absolutePathForRelative(relativePath: string): string {
    const normalized = normalizeRelativePath(relativePath);
    return path.join(this.workspaceRoot, ...normalized.split("/").filter(Boolean));
  }

  async resolveRelativePath(relativePath: string): Promise<string> {
    if (!relativePath || typeof relativePath !== "string") {
      throw new WorkspacePathError("Path is required.");
    }

    if (path.isAbsolute(relativePath)) {
      throw new WorkspacePathError("Absolute paths are not allowed.");
    }

    const normalized = normalizeRelativePath(relativePath);
    if (normalized.includes("\0")) {
      throw new WorkspacePathError("Invalid path.");
    }

    const segments = normalized.split("/");
    for (const segment of segments) {
      if (segment === "..") {
        throw new WorkspacePathError("Path traversal outside the workspace is not allowed.");
      }
    }

    const joined = path.join(this.workspaceRoot, ...segments.filter(Boolean));
    const resolved = path.resolve(joined);

    if (!isPathInside(this.workspaceRoot, resolved)) {
      throw new WorkspacePathError("Path resolves outside the workspace.");
    }

    let realTarget: string;
    try {
      realTarget = await fs.realpath(resolved);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        if (!await this.isResolvedPathInsideWorkspace(resolved)) {
          throw new WorkspacePathError("Path resolves outside the workspace.");
        }
        return resolved;
      }
      throw err;
    }

    if (!isPathInside(this.workspaceRootReal, realTarget)) {
      throw new WorkspacePathError("Path resolves outside the workspace (symlink escape).");
    }

    return realTarget;
  }

  async statRelative(relativePath: string): Promise<import("node:fs").Stats> {
    const abs = await this.resolveRelativePath(relativePath);
    return fs.stat(abs);
  }

  async fileExists(relativePath: string): Promise<boolean> {
    try {
      const stat = await this.statRelative(relativePath);
      return stat.isFile();
    } catch (err: unknown) {
      if (err instanceof WorkspacePathError) {
        throw err;
      }
      return false;
    }
  }

  async readFile(relativePath: string): Promise<string> {
    const abs = await this.resolveRelativePath(relativePath);
    try {
      return await fs.readFile(abs, "utf8");
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        throw new WorkspacePathError(`File not found: ${relativePath}`);
      }
      if (code === "EISDIR") {
        throw new WorkspacePathError(`Path is a directory, not a file: ${relativePath}`);
      }
      throw err;
    }
  }

  async readFileIfExists(relativePath: string): Promise<string | undefined> {
    try {
      return await this.readFile(relativePath);
    } catch (err: unknown) {
      if (err instanceof WorkspacePathError && err.message.startsWith("File not found")) {
        return undefined;
      }
      throw err;
    }
  }

  async writeFileAtomic(relativePath: string, content: string, expectedPrevious?: string): Promise<void> {
    await this.resolveRelativePath(relativePath);

    if (expectedPrevious !== undefined) {
      const current = await this.readFileIfExists(relativePath);
      if (current !== expectedPrevious) {
        throw new WorkspacePathError(
          "File changed while approval was pending. Write rejected to avoid overwriting your edits."
        );
      }
    }

    const abs = this.absolutePathForRelative(relativePath);
    const tmpPath = `${abs}.repobridge.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmpPath, content, "utf8");
      await fs.rename(tmpPath, abs);
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Creates only the listed directories (in order). Rolls back directories created in this call on failure.
   */
  async createDirectoriesAtomic(directoriesToCreate: string[]): Promise<void> {
    const created: string[] = [];
    try {
      for (const relativeDir of directoriesToCreate) {
        const abs = this.absolutePathForRelative(relativeDir);
        await fs.mkdir(abs, { recursive: false });
        created.push(relativeDir);
      }
    } catch (err) {
      await this.rollbackCreatedDirectories(created);
      throw err;
    }
  }

  async createFileOnly(relativePath: string, content: string): Promise<void> {
    if (await this.fileExists(relativePath)) {
      throw new WorkspacePathError("File already exists. Use write_file to modify it.");
    }

    const abs = await this.resolveRelativePath(relativePath);
    const parentAbs = path.dirname(abs);
    try {
      const parentStat = await fs.stat(parentAbs);
      if (!parentStat.isDirectory()) {
        throw new WorkspacePathError(
          "Cannot create file because the parent path is not a directory."
        );
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        throw new WorkspacePathError("Parent directory does not exist.");
      }
      throw err;
    }

    const tmpPath = `${abs}.repobridge.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmpPath, content, { encoding: "utf8", flag: "wx" });
      await fs.rename(tmpPath, abs);
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }

  /** Creates parent dirs (if any) then the file. Rolls back dirs created here if file creation fails. */
  async createFileWithParentsAtomic(
    relativePath: string,
    content: string,
    parentDirsToCreate: string[]
  ): Promise<void> {
    if (await this.fileExists(relativePath)) {
      throw new WorkspacePathError("File already exists. Use write_file to modify it.");
    }

    if (await pathIsDirectory(this, relativePath)) {
      throw new WorkspacePathError(
        "Cannot create file because the target path is an existing directory."
      );
    }

    const createdDirs: string[] = [];
    try {
      for (const dir of parentDirsToCreate) {
        const abs = this.absolutePathForRelative(dir);
        try {
          await fs.mkdir(abs, { recursive: false });
          createdDirs.push(dir);
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException)?.code;
          if (code === "EEXIST") {
            continue;
          }
          throw err;
        }
      }
      await this.createFileOnly(relativePath, content);
    } catch (err) {
      await this.rollbackCreatedDirectories(createdDirs);
      throw err;
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    const abs = await this.resolveRelativePath(relativePath);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        throw new WorkspacePathError(`File not found: ${relativePath}`);
      }
      throw err;
    }

    if (stat.isDirectory()) {
      throw new WorkspacePathError(
        "delete_file cannot delete directories. Use delete_directory."
      );
    }

    await fs.unlink(abs);
  }

  async deleteDirectoryRecursive(relativePath: string): Promise<void> {
    const abs = await this.resolveRelativePath(relativePath);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        throw new WorkspacePathError(`Directory not found: ${relativePath}`);
      }
      throw err;
    }

    if (!stat.isDirectory()) {
      throw new WorkspacePathError("delete_directory only operates on directories. Use delete_file.");
    }

    try {
      await fs.rm(abs, { recursive: true, force: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new WorkspacePathError(`Directory deletion failed or incomplete: ${message}`);
    }
  }

  /** True if `resolved` is under the workspace, walking up through missing parents. */
  private async isResolvedPathInsideWorkspace(resolved: string): Promise<boolean> {
    let current = resolved;
    while (true) {
      if (!isPathInside(this.workspaceRoot, current)) {
        return false;
      }
      if (current === this.workspaceRoot || current === path.dirname(current)) {
        return true;
      }
      try {
        const real = await fs.realpath(current);
        return isPathInside(this.workspaceRootReal, real);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          current = path.dirname(current);
          continue;
        }
        return false;
      }
    }
  }

  private async rollbackCreatedDirectories(createdNewestFirst: string[]): Promise<void> {
    for (const dir of [...createdNewestFirst].reverse()) {
      const abs = this.absolutePathForRelative(dir);
      try {
        await fs.rmdir(abs);
      } catch {
        // Parent not empty or already removed — stop rollback
        break;
      }
    }
  }
}

async function pathIsDirectory(fsApi: WorkspaceFilesystem, relativePath: string): Promise<boolean> {
  try {
    const stat = await fsApi.statRelative(relativePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function workspaceFolderName(root: string): string {
  return path.basename(root);
}
