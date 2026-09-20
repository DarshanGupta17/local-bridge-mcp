import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LocalBridgeError } from "../core/errors.js";
import { toolErrorFromLocalBridge, toolErrorMessage } from "../core/errors.js";
import type { AppServices } from "../core/appServices.js";
import { contentSha256, fileStatFingerprint } from "../filesystem/contentHash.js";
import {
  buildDirectoryDeletePreview,
  directoryExists,
  missingDirectoryChain,
  pathIsExistingFile,
} from "../workspace/directories.js";
import { searchInWorkspace } from "../workspace/search.js";
import {
  isSensitiveDirectoryPath,
  isSensitivePath,
  normalizeRelativePath,
} from "../security/sensitivePathDetector.js";
import { PermissionManager } from "../security/permissionManager.js";
import type { WorkspaceManager } from "../security/workspaceManager.js";
import type { Logger } from "../logger.js";

export interface ToolHandlersContext {
  services: AppServices;
  workspace: WorkspaceManager;
  log: Logger;
  permissions: PermissionManager;
  getClientLabel: () => string;
  onToolCall?: (name: string) => void;
}

export function registerMcpTools(server: McpServer, ctx: ToolHandlersContext): void {
  const security = () => ctx.services.security;

  server.registerTool(
    "read_file",
    {
      description:
        "Read a file from the connected workspace. Normal files are read automatically. Sensitive or database credential files require user approval.",
      inputSchema: { path: z.string().describe("Workspace-relative file path") },
    },
    async ({ path: filePath }) => {
      return runTool(ctx, "read_file", filePath, async () => {
        const resolved = await security().validateRead(filePath);
        const classification = security().classify(resolved.displayPath);
        if (classification.requiresReadPrompt) {
          const decision = await ctx.permissions.requestReadPermission(resolved.displayPath);
          if (decision === "deny") {
            throw new LocalBridgeError("USER_PERMISSION_DENIED", "Access denied by the user.");
          }
        }
        const payload = await security().readTextOrBinaryMetadata(resolved.displayPath);
        if (payload.kind === "binary") {
          return ok(payload.meta);
        }
        return ok(`File: ${resolved.displayPath}\n\n${payload.content}`);
      });
    }
  );

  server.registerTool(
    "search_file",
    {
      description:
        "Search files in the workspace. Sensitive paths are excluded from broad search unless explicitly scoped (with approval).",
      inputSchema: {
        query: z.string().describe("Text to search for"),
        path: z.string().optional().describe("Optional workspace-relative file or directory scope"),
      },
    },
    async ({ query, path: scopePath }) => {
      return runTool(ctx, "search_file", scopePath ?? "(workspace)", async () => {
        let allowSensitive = false;
        if (scopePath) {
          const displayScope = normalizeRelativePath(scopePath);
          await security().resolvePath(displayScope);
          if (isSensitivePath(displayScope) || isSensitiveDirectoryPath(displayScope)) {
            const decision = await ctx.permissions.requestSensitiveSearchPermission(displayScope);
            if (decision === "deny") {
              throw new LocalBridgeError("USER_PERMISSION_DENIED", "Search denied by the user.");
            }
            allowSensitive = true;
          }
        }

        const matches: Awaited<ReturnType<typeof searchInWorkspace>> = [];
        if (scopePath) {
          const picked = ctx.workspace.pickRootForRelative(scopePath);
          const innerScope = picked.relativePath;
          matches.push(
            ...(await searchInWorkspace(picked.fs, query, innerScope, {
              allowSensitiveTargets: allowSensitive,
              maxFileBytes: ctx.services.security.limits.maxSearchFileSize,
            }))
          );
        } else {
          for (const fsApi of ctx.workspace.allFilesystems()) {
            matches.push(
              ...(await searchInWorkspace(fsApi, query, undefined, {
                allowSensitiveTargets: false,
                maxFileBytes: ctx.services.security.limits.maxSearchFileSize,
              }))
            );
          }
        }

        if (matches.length === 0) {
          return ok("No matches found.");
        }
        const lines = matches.map((m) => `${m.file}:${m.line}\n${m.text}`);
        return ok(lines.join("\n\n"));
      });
    }
  );

  server.registerTool(
    "write_file",
    {
      description:
        "Modify an existing file. User approval is required before any change is applied.",
      inputSchema: {
        path: z.string().describe("Workspace-relative file path"),
        content: z.string().describe("Full new file content"),
      },
    },
    async ({ path: filePath, content }) => {
      return runTool(ctx, "write_file", filePath, async () => {
        security().assertWriteSize(content);
        const resolved = await security().resolvePath(filePath);
        const snapshot = await resolved.fs.readFileIfExists(resolved.relativePath);
        if (snapshot === undefined) {
          throw new LocalBridgeError("FILE_NOT_FOUND", "File not found. Use create_file to create new files.");
        }
        const contentHashBefore = contentSha256(snapshot);
        const decision = await ctx.permissions.requestWritePermission(
          resolved.displayPath,
          snapshot,
          content
        );
        if (decision === "deny") {
          throw new LocalBridgeError("USER_PERMISSION_DENIED", "Write denied by the user.");
        }
        await resolved.fs.writeFileAtomic(resolved.relativePath, content, {
          expectedContentHash: contentHashBefore,
        });
        ctx.services.context.recordAutomaticFact(`${resolved.displayPath} modified`);
        return ok(`Successfully wrote ${resolved.displayPath}`);
      });
    }
  );

  server.registerTool(
    "create_file",
    {
      description: "Create a new file. User approval is required before the file is created.",
      inputSchema: {
        path: z.string().describe("Workspace-relative file path"),
        content: z.string().describe("Full file content"),
      },
    },
    async ({ path: filePath, content }) => {
      return runTool(ctx, "create_file", filePath, async () => {
        security().assertWriteSize(content);
        const resolved = await security().resolvePath(filePath);
        if (await resolved.fs.fileExists(resolved.relativePath)) {
          throw new LocalBridgeError("FILE_ALREADY_EXISTS", "File already exists. Use write_file to modify it.");
        }
        if (await directoryExists(resolved.fs, resolved.relativePath)) {
          throw new LocalBridgeError("FILE_IS_DIRECTORY", "Cannot create file because the target path is an existing directory.");
        }
        const decision = await ctx.permissions.requestCreatePermission(resolved.displayPath);
        if (decision === "deny") {
          throw new LocalBridgeError("USER_PERMISSION_DENIED", "Create denied by the user.");
        }
        const parentDir = parentDirectoryOf(resolved.relativePath);
        const parentDirsToCreate =
          parentDir && parentDir !== "." ? await missingDirectoryChain(resolved.fs, parentDir) : [];
        await resolved.fs.createFileWithParentsAtomic(resolved.relativePath, content, parentDirsToCreate);
        ctx.services.context.recordAutomaticFact(`${resolved.displayPath} created`);
        return ok(`Successfully created ${resolved.displayPath}`);
      });
    }
  );

  server.registerTool(
    "delete_file",
    {
      description: "Delete a file. Always requires explicit user approval before deletion.",
      inputSchema: { path: z.string().describe("Workspace-relative file path") },
    },
    async ({ path: filePath }) => {
      return runTool(ctx, "delete_file", filePath, async () => {
        security().assertNotProtected(filePath, "delete");
        const resolved = await security().resolvePath(filePath);
        const stat = await resolved.fs.statRelative(resolved.relativePath);
        if (stat.isDirectory()) {
          throw new LocalBridgeError("FILE_IS_DIRECTORY", "delete_file cannot delete directories. Use delete_directory.");
        }
        const fingerprintBefore = fileStatFingerprint(stat);
        const decision = await ctx.permissions.requestDeletePermission(resolved.displayPath);
        if (decision === "deny") {
          throw new LocalBridgeError("USER_PERMISSION_DENIED", "File deletion was denied by the user.");
        }
        const statAfter = await resolved.fs.statRelative(resolved.relativePath).catch(() => undefined);
        if (!statAfter) {
          throw new LocalBridgeError("FILE_NOT_FOUND", "File no longer exists.");
        }
        if (fileStatFingerprint(statAfter) !== fingerprintBefore) {
          throw new LocalBridgeError(
            "FILE_CHANGED_DURING_APPROVAL",
            "File changed while the operation was awaiting approval. Deletion was not applied."
          );
        }
        await resolved.fs.deleteFile(resolved.relativePath);
        ctx.services.context.recordAutomaticFact(`${resolved.displayPath} deleted`);
        return ok(`Successfully deleted ${resolved.displayPath}`);
      });
    }
  );

  server.registerTool(
    "create_directory",
    {
      description: "Create a directory. User approval is required before any directory is created.",
      inputSchema: { path: z.string().describe("Workspace-relative directory path") },
    },
    async ({ path: dirPath }) => {
      return runTool(ctx, "create_directory", dirPath, async () => {
        const resolved = await security().resolvePath(dirPath);
        if (await pathIsExistingFile(resolved.fs, resolved.relativePath)) {
          throw new LocalBridgeError("PATH_IS_FILE", "Cannot create directory because the target path is an existing file.");
        }
        if (await directoryExists(resolved.fs, resolved.relativePath)) {
          return ok("Directory already exists.");
        }
        const decision = await ctx.permissions.requestCreateDirectoryPermission(resolved.displayPath);
        if (decision === "deny") {
          throw new LocalBridgeError("USER_PERMISSION_DENIED", "Directory creation was denied by the user.");
        }
        const directoriesToCreate = await missingDirectoryChain(resolved.fs, resolved.relativePath);
        if (directoriesToCreate.length === 0) {
          return ok("Directory already exists.");
        }
        await resolved.fs.createDirectoriesAtomic(directoriesToCreate);
        return ok(`Successfully created directory ${resolved.displayPath}`);
      });
    }
  );

  server.registerTool(
    "delete_directory",
    {
      description:
        "Delete a directory and its contents. Always requires explicit high-risk user approval.",
      inputSchema: { path: z.string().describe("Workspace-relative directory path") },
    },
    async ({ path: dirPath }) => {
      return runTool(ctx, "delete_directory", dirPath, async () => {
        security().assertNotProtected(dirPath, "delete_directory");
        const resolved = await security().resolvePath(dirPath);
        const preview = await buildDirectoryDeletePreview(resolved.fs, resolved.relativePath);
        preview.relativePath = resolved.displayPath;
        const decision = await ctx.permissions.requestDeleteDirectoryPermission(preview);
        if (decision === "deny") {
          throw new LocalBridgeError("USER_PERMISSION_DENIED", "Directory deletion was denied by the user.");
        }
        await resolved.fs.deleteDirectoryRecursive(resolved.relativePath);
        return ok(`Successfully deleted directory ${resolved.displayPath}`);
      });
    }
  );

  registerGitTools(server, ctx);
  registerContextTools(server, ctx);
}

function registerGitTools(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "git_status",
    { description: "Read-only git status for the primary workspace root.", inputSchema: {} },
    async () =>
      runTool(ctx, "git_status", undefined, async () => ok(await ctx.services.git.status()))
  );

  server.registerTool(
    "git_branch",
    { description: "Read-only current git branch metadata.", inputSchema: {} },
    async () =>
      runTool(ctx, "git_branch", undefined, async () => ok(await ctx.services.git.branch()))
  );

  server.registerTool(
    "git_diff",
    {
      description: "Read-only bounded git diff. Sensitive paths require read approval.",
      inputSchema: {
        path: z.string().optional().describe("Optional workspace-relative path scope"),
      },
    },
    async ({ path: scope }) => {
      return runTool(ctx, "git_diff", scope, async () => {
        let includeSensitive = false;
        if (scope && isSensitivePath(normalizeRelativePath(scope))) {
          const decision = await ctx.permissions.requestReadPermission(normalizeRelativePath(scope));
          if (decision === "deny") {
            throw new LocalBridgeError("USER_PERMISSION_DENIED", "Diff denied by the user.");
          }
          includeSensitive = true;
        }
        const text = await ctx.services.git.diff(scope, includeSensitive);
        return ok(text);
      });
    }
  );
}

function registerContextTools(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "get_project_context",
    {
      description:
        "Retrieve the shared LocalBridge project context so the agent can continue work performed by another AI coding agent.",
      inputSchema: {},
    },
    async () =>
      runTool(ctx, "get_project_context", undefined, async () => {
        const project = await ctx.services.context.getContext();
        return ok(JSON.stringify(project, null, 2));
      })
  );

  server.registerTool(
    "update_project_context",
    {
      description:
        "Update shared project context so future AI coding agents can continue the work.",
      inputSchema: {
        projectSummary: z.string().optional(),
        currentObjective: z.string().optional(),
        activeTask: z.string().optional(),
        taskStatus: z.enum(["pending", "in_progress", "done"]).optional(),
        knownIssues: z.array(z.string()).optional(),
        todos: z.array(z.string()).optional(),
        architectureNotes: z.string().optional(),
        conventions: z.string().optional(),
      },
    },
    async (patch) =>
      runTool(ctx, "update_project_context", undefined, async () => {
        const updated = await ctx.services.context.updateContext(patch, ctx.getClientLabel());
        return ok(JSON.stringify(updated, null, 2));
      })
  );
}

async function runTool(
  ctx: ToolHandlersContext,
  operation: string,
  pathLabel: string | undefined,
  fn: () => Promise<{ content: { type: "text"; text: string }[] }>
) {
  ctx.onToolCall?.(operation);
  ctx.log.info(`MCP request: ${operation}`);
  const client = ctx.getClientLabel();
  const started = Date.now();
  try {
    const result = await fn();
    await ctx.services.audit.record({
      operation,
      path: pathLabel,
      client,
      result: "ALLOWED",
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err: unknown) {
    const denied =
      err instanceof LocalBridgeError && err.code === "USER_PERMISSION_DENIED" ? "DENIED" : "ERROR";
    await ctx.services.audit.record({
      operation,
      path: pathLabel,
      client,
      result: denied,
      durationMs: Date.now() - started,
      detail: err instanceof LocalBridgeError ? err.code : undefined,
    });
    if (err instanceof LocalBridgeError) {
      return toolErrorFromLocalBridge(err);
    }
    return { content: [{ type: "text" as const, text: toolErrorMessage(err) }], isError: true as const };
  }
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function parentDirectoryOf(relativeFilePath: string): string {
  const normalized = normalizeRelativePath(relativeFilePath);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}
