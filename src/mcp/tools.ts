import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkspaceFilesystem } from "../workspace/filesystem.js";
import { WorkspacePathError } from "../workspace/filesystem.js";
import {
  buildDirectoryDeletePreview,
  directoryExists,
  missingDirectoryChain,
  pathIsExistingFile,
} from "../workspace/directories.js";
import { searchInWorkspace } from "../workspace/search.js";
import {
  isDeleteDirectoryBlocked,
  isSensitiveDirectoryPath,
  isSensitivePath,
  normalizeRelativePath,
  requiresReadPermission,
  validateWorkspacePath,
} from "../workspace/security.js";
import { PermissionManager } from "../security/permissionManager.js";
import type { Logger } from "../logger.js";

export interface ToolHandlersContext {
  fs: WorkspaceFilesystem;
  log: Logger;
  permissions: PermissionManager;
  onToolCall?: (name: string) => void;
}

export function registerMcpTools(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "read_file",
    {
      description:
        "Read a file from the connected workspace. Normal files are read automatically. Sensitive or database credential files require user approval.",
      inputSchema: {
        path: z.string().describe("Workspace-relative file path"),
      },
    },
    async ({ path: filePath }) => {
      ctx.onToolCall?.("read_file");
      ctx.log.info("MCP request: read_file");

      try {
        const displayPath = normalizeRelativePath(filePath);
        await validateWorkspacePath(ctx.fs, displayPath);

        if (requiresReadPermission(displayPath)) {
          const decision = await ctx.permissions.requestReadPermission(displayPath);
          if (decision === "deny") {
            return toolError("Access denied by the user.");
          }
        }

        const content = await ctx.fs.readFile(displayPath);
        return {
          content: [{ type: "text" as const, text: `File: ${displayPath}\n\n${content}` }],
        };
      } catch (err: unknown) {
        return toolError(formatToolError(err));
      }
    }
  );

  server.registerTool(
    "search_file",
    {
      description:
        "Search files in the connected workspace without permission prompts. Sensitive paths are excluded from results.",
      inputSchema: {
        query: z.string().describe("Text to search for"),
        path: z
          .string()
          .optional()
          .describe("Optional workspace-relative file or directory scope"),
      },
    },
    async ({ query, path: scopePath }) => {
      ctx.onToolCall?.("search_file");
      ctx.log.info("MCP request: search_file");

      try {
        if (scopePath) {
          const displayScope = normalizeRelativePath(scopePath);
          await validateWorkspacePath(ctx.fs, displayScope);

          if (isSensitivePath(displayScope) || isSensitiveDirectoryPath(displayScope)) {
            return toolError(
              "Sensitive paths cannot be searched. Use read_file for sensitive or database credential files."
            );
          }
        }

        const matches = await searchInWorkspace(ctx.fs, query, scopePath, {
          allowSensitiveTargets: false,
        });

        if (matches.length === 0) {
          return { content: [{ type: "text" as const, text: "No matches found." }] };
        }

        const lines = matches.map((m) => `${m.file}:${m.line}\n${m.text}`);
        return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
      } catch (err: unknown) {
        return toolError(formatToolError(err));
      }
    }
  );

  server.registerTool(
    "write_file",
    {
      description:
        "Modify an existing file in the connected workspace. User approval is required before the file is changed.",
      inputSchema: {
        path: z.string().describe("Workspace-relative file path"),
        content: z.string().describe("Full new file content"),
      },
    },
    async ({ path: filePath, content }) => {
      ctx.onToolCall?.("write_file");
      ctx.log.info("MCP request: write_file");

      try {
        const displayPath = normalizeRelativePath(filePath);
        await validateWorkspacePath(ctx.fs, displayPath);

        const snapshot = await ctx.fs.readFileIfExists(displayPath);
        if (snapshot === undefined) {
          return toolError("File not found. Use create_file to create new files.");
        }

        const decision = await ctx.permissions.requestWritePermission(displayPath, snapshot, content);
        if (decision === "deny") {
          return toolError("Write denied by the user.");
        }

        await ctx.fs.writeFileAtomic(displayPath, content, snapshot);
        ctx.log.info(`File written: ${displayPath}`);
        return {
          content: [{ type: "text" as const, text: `Successfully wrote ${displayPath}` }],
        };
      } catch (err: unknown) {
        return toolError(formatToolError(err));
      }
    }
  );

  server.registerTool(
    "create_file",
    {
      description:
        "Creates a new file. Missing parent directories are created automatically. No permission prompt.",
      inputSchema: {
        path: z.string().describe("Workspace-relative file path"),
        content: z.string().describe("Full file content"),
      },
    },
    async ({ path: filePath, content }) => {
      ctx.onToolCall?.("create_file");
      ctx.log.info("MCP request: create_file");

      try {
        const displayPath = normalizeRelativePath(filePath);
        await validateWorkspacePath(ctx.fs, displayPath);

        if (await ctx.fs.fileExists(displayPath)) {
          return toolError("File already exists. Use write_file to modify it.");
        }

        if (await directoryExists(ctx.fs, displayPath)) {
          return toolError("Cannot create file because the target path is an existing directory.");
        }

        const parentDir = parentDirectoryOf(displayPath);
        const parentDirsToCreate =
          parentDir && parentDir !== "."
            ? await missingDirectoryChain(ctx.fs, parentDir)
            : [];

        await ctx.fs.createFileWithParentsAtomic(displayPath, content, parentDirsToCreate);
        ctx.log.info(`File created: ${displayPath}`);
        return {
          content: [{ type: "text" as const, text: `Successfully created ${displayPath}` }],
        };
      } catch (err: unknown) {
        return toolError(formatToolError(err));
      }
    }
  );

  server.registerTool(
    "delete_file",
    {
      description:
        "Deletes a file. Always requires explicit user approval.",
      inputSchema: {
        path: z.string().describe("Workspace-relative file path"),
      },
    },
    async ({ path: filePath }) => {
      ctx.onToolCall?.("delete_file");
      ctx.log.info("MCP request: delete_file");

      try {
        const displayPath = normalizeRelativePath(filePath);
        await validateWorkspacePath(ctx.fs, displayPath);

        const stat = await ctx.fs.statRelative(displayPath);
        if (stat.isDirectory()) {
          return toolError("delete_file cannot delete directories. Use delete_directory.");
        }

        const decision = await ctx.permissions.requestDeletePermission(displayPath);
        if (decision === "deny") {
          return toolError("File deletion was denied by the user.");
        }

        await ctx.fs.deleteFile(displayPath);
        ctx.log.info(`File deleted: ${displayPath}`);
        return {
          content: [{ type: "text" as const, text: `Successfully deleted ${displayPath}` }],
        };
      } catch (err: unknown) {
        return toolError(formatToolError(err));
      }
    }
  );

  server.registerTool(
    "create_directory",
    {
      description:
        "Creates a directory and any missing parent directories. No permission prompt.",
      inputSchema: {
        path: z.string().describe("Workspace-relative directory path"),
      },
    },
    async ({ path: dirPath }) => {
      ctx.onToolCall?.("create_directory");
      ctx.log.info("MCP request: create_directory");

      try {
        const displayPath = normalizeRelativePath(dirPath);
        await validateWorkspacePath(ctx.fs, displayPath);

        if (await pathIsExistingFile(ctx.fs, displayPath)) {
          return toolError("Cannot create directory because the target path is an existing file.");
        }

        if (await directoryExists(ctx.fs, displayPath)) {
          return {
            content: [{ type: "text" as const, text: "Directory already exists." }],
          };
        }

        const directoriesToCreate = await missingDirectoryChain(ctx.fs, displayPath);
        if (directoriesToCreate.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Directory already exists." }],
          };
        }

        await ctx.fs.createDirectoriesAtomic(directoriesToCreate);
        ctx.log.info(`Directories created: ${directoriesToCreate.join(", ")}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully created directory ${displayPath}`,
            },
          ],
        };
      } catch (err: unknown) {
        return toolError(formatToolError(err));
      }
    }
  );

  server.registerTool(
    "delete_directory",
    {
      description:
        "Deletes a directory and, if non-empty, its contents. Always requires explicit high-risk user approval.",
      inputSchema: {
        path: z.string().describe("Workspace-relative directory path"),
      },
    },
    async ({ path: dirPath }) => {
      ctx.onToolCall?.("delete_directory");
      ctx.log.info("MCP request: delete_directory");

      try {
        const displayPath = normalizeRelativePath(dirPath);
        await validateWorkspacePath(ctx.fs, displayPath);

        if (isDeleteDirectoryBlocked(displayPath)) {
          if (displayPath === ".git" || displayPath.startsWith(".git/")) {
            return toolError("Deletion of the .git directory is disabled in RepoBridge.");
          }
          return toolError("Deletion of this directory is disabled in RepoBridge.");
        }

        const preview = await buildDirectoryDeletePreview(ctx.fs, displayPath);

        const decision = await ctx.permissions.requestDeleteDirectoryPermission(preview);
        if (decision === "deny") {
          return toolError("Directory deletion was denied by the user.");
        }

        await ctx.fs.deleteDirectoryRecursive(displayPath);
        ctx.log.info(`Directory deleted: ${displayPath}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully deleted directory ${displayPath}`,
            },
          ],
        };
      } catch (err: unknown) {
        return toolError(formatToolError(err));
      }
    }
  );
}

function parentDirectoryOf(relativeFilePath: string): string {
  const normalized = normalizeRelativePath(relativeFilePath);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function formatToolError(err: unknown): string {
  if (err instanceof WorkspacePathError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
}
