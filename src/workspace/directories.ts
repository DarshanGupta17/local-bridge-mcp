import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WorkspaceFilesystem, WorkspacePathError } from "./filesystem.js";
import { normalizeRelativePath } from "./security.js";

/** Ordered list of workspace-relative directories that do not exist yet (parents first). */
export async function missingDirectoryChain(
  fsApi: WorkspaceFilesystem,
  relativeDirPath: string
): Promise<string[]> {
  const target = normalizeRelativePath(relativeDirPath);
  if (!target) {
    throw new WorkspacePathError("Directory path is required.");
  }

  await fsApi.resolveRelativePath(target);

  const segments = target.split("/").filter(Boolean);
  const missing: string[] = [];

  for (let i = 1; i <= segments.length; i++) {
    const partial = segments.slice(0, i).join("/");
    const abs = fsApi.absolutePathForRelative(partial);

    try {
      const stat = await fs.stat(abs);
      if (stat.isFile()) {
        throw new WorkspacePathError(
          `Cannot create directory because the target path is an existing file: ${partial}`
        );
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (err instanceof WorkspacePathError) {
        throw err;
      }
      if (code === "ENOENT") {
        missing.push(partial);
        continue;
      }
      throw err;
    }
  }

  return missing;
}

export async function directoryExists(
  fsApi: WorkspaceFilesystem,
  relativeDirPath: string
): Promise<boolean> {
  try {
    const stat = await fsApi.statRelative(relativeDirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function pathIsExistingFile(
  fsApi: WorkspaceFilesystem,
  relativePath: string
): Promise<boolean> {
  try {
    const stat = await fsApi.statRelative(relativePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export interface DirectoryDeletePreview {
  relativePath: string;
  fileCount: number;
  directoryCount: number;
  isEmpty: boolean;
  samplePaths: string[];
  totalEntries: number;
}

const MAX_SAMPLE_PATHS = 20;
const LARGE_TREE_FILE_THRESHOLD = 50;

export async function buildDirectoryDeletePreview(
  fsApi: WorkspaceFilesystem,
  relativeDirPath: string
): Promise<DirectoryDeletePreview> {
  const normalized = normalizeRelativePath(relativeDirPath);
  const abs = await fsApi.resolveRelativePath(normalized);
  let rootStat;
  try {
    rootStat = await fs.stat(abs);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new WorkspacePathError(`Directory not found: ${normalized}`);
    }
    throw err;
  }

  if (!rootStat.isDirectory()) {
    throw new WorkspacePathError("delete_directory only operates on directories. Use delete_file.");
  }

  const preview: DirectoryDeletePreview = {
    relativePath: normalized,
    fileCount: 0,
    directoryCount: 0,
    isEmpty: true,
    samplePaths: [],
    totalEntries: 0,
  };

  await walkForPreview(fsApi.root, abs, normalized, preview);
  preview.isEmpty = preview.fileCount === 0 && preview.directoryCount === 0;
  preview.totalEntries = preview.fileCount + preview.directoryCount;
  return preview;
}

async function walkForPreview(
  workspaceRoot: string,
  absDir: string,
  relativeDir: string,
  preview: DirectoryDeletePreview
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const rel = `${relativeDir}/${entry.name}`.replace(/\/+/g, "/");
    if (entry.isDirectory()) {
      preview.directoryCount += 1;
      preview.isEmpty = false;
      if (preview.samplePaths.length < MAX_SAMPLE_PATHS) {
        preview.samplePaths.push(`${rel}/`);
      }
      await walkForPreview(workspaceRoot, path.join(absDir, entry.name), rel, preview);
    } else if (entry.isFile()) {
      preview.fileCount += 1;
      preview.isEmpty = false;
      if (preview.samplePaths.length < MAX_SAMPLE_PATHS) {
        preview.samplePaths.push(rel);
      }
    }
  }
}

export function isLargeDirectoryTree(preview: DirectoryDeletePreview): boolean {
  return preview.totalEntries >= LARGE_TREE_FILE_THRESHOLD;
}
