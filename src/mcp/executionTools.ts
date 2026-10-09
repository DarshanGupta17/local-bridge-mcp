import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as vscode from "vscode";
import { z } from "zod";
import { LocalBridgeError } from "../core/errors.js";
import { runShellCommand } from "../execution/commandRunner.js";
import { authorizeCommand } from "../execution/executionSecurity.js";
import { gatherEnvironmentInfo } from "../execution/environmentInfo.js";
import { httpRequestLocal, validateLocalHttpUrl } from "../execution/httpClient.js";
import { detectProject, resolveTestCommand, runTests } from "../execution/testRunner.js";
import { resolveCommandCwd } from "../execution/workspaceCwd.js";
import { isSensitivePath, normalizeRelativePath } from "../security/sensitivePathDetector.js";
import type { ToolHandlersContext } from "./tools.js";
import { runTool, okJson } from "./tools.js";

export function registerExecutionTools(server: McpServer, ctx: ToolHandlersContext): void {
  registerRunCommand(server, ctx);
  registerProcessTools(server, ctx);
  registerReadTerminal(server, ctx);
  registerDiagnostics(server, ctx);
  registerRunTests(server, ctx);
  registerListLocalServers(server, ctx);
  registerHttpRequest(server, ctx);
  registerGetEnvironment(server, ctx);
  registerGitReadTools(server, ctx);
  registerWorkspaceIntelligence(server, ctx);
}

function registerRunCommand(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "run_command",
    {
      description:
        "Run a finite shell command in the authorized workspace. Returns stdout, stderr, exit code, and duration. " +
        "Destructive or install commands require user approval in VS Code.",
      inputSchema: {
        command: z.string().describe("Shell command to execute"),
        cwd: z.string().optional().describe("Workspace-relative working directory"),
        timeout_ms: z.number().int().positive().optional().describe("Timeout in milliseconds"),
        shell: z.string().optional().describe("Optional shell executable"),
      },
    },
    async ({ command, cwd, timeout_ms, shell }) => {
      return runTool(ctx, "run_command", cwd ?? ".", async () => {
        if (!command?.trim()) {
          throw new LocalBridgeError("INVALID_ARGUMENT", "command is required.");
        }
        await authorizeCommand(ctx.permissions, command, "run_command");
        const absCwd = await resolveCommandCwd(ctx.workspace, cwd);
        const limits = ctx.services.executionLimits;
        const result = await runShellCommand({
          command,
          cwd: absCwd,
          timeoutMs: timeout_ms ?? limits.defaultCommandTimeoutMs,
          shell,
          limits,
        });
        return okJson(result);
      });
    }
  );
}

function registerProcessTools(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "start_process",
    {
      description:
        "Start a long-running shell process managed by LocalBridge. Use read_process_output to stream output.",
      inputSchema: {
        command: z.string(),
        cwd: z.string().optional(),
        shell: z.string().optional(),
      },
    },
    async ({ command, cwd, shell }) => {
      return runTool(ctx, "start_process", cwd ?? ".", async () => {
        if (!command?.trim()) {
          throw new LocalBridgeError("INVALID_ARGUMENT", "command is required.");
        }
        await authorizeCommand(ctx.permissions, command, "start_process");
        const absCwd = await resolveCommandCwd(ctx.workspace, cwd);
        try {
          const started = ctx.services.processes.startProcess(command, absCwd, shell);
          return okJson(started);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Failed to start process.";
          throw new LocalBridgeError("OPERATION_NOT_SUPPORTED", msg);
        }
      });
    }
  );

  server.registerTool(
    "read_process_output",
    {
      description: "Read captured stdout/stderr from a LocalBridge-managed process.",
      inputSchema: {
        processId: z.string(),
        maxLines: z.number().int().positive().optional(),
        maxBytes: z.number().int().positive().optional(),
      },
    },
    async ({ processId, maxLines, maxBytes }) => {
      return runTool(ctx, "read_process_output", processId, async () => {
        try {
          const out = ctx.services.processes.readOutput(processId, maxLines, maxBytes);
          return okJson(out);
        } catch (err: unknown) {
          if (err instanceof Error && err.message === "PROCESS_NOT_FOUND") {
            throw new LocalBridgeError("PROCESS_NOT_FOUND", "The requested process no longer exists.");
          }
          throw err;
        }
      });
    }
  );

  server.registerTool(
    "send_process_input",
    {
      description: "Write stdin to a running LocalBridge-managed process (when stdin is supported).",
      inputSchema: {
        processId: z.string(),
        input: z.string(),
      },
    },
    async ({ processId, input }) => {
      return runTool(ctx, "send_process_input", processId, async () => {
        try {
          ctx.services.processes.sendInput(processId, input);
          return okJson({ processId, accepted: true });
        } catch (err: unknown) {
          if (err instanceof Error && err.message === "PROCESS_NOT_FOUND") {
            throw new LocalBridgeError("PROCESS_NOT_FOUND", "The requested process no longer exists.");
          }
          throw new LocalBridgeError("OPERATION_NOT_SUPPORTED", err instanceof Error ? err.message : "Failed.");
        }
      });
    }
  );

  server.registerTool(
    "stop_process",
    {
      description: "Stop a LocalBridge-managed process. Uses graceful termination first unless force is true.",
      inputSchema: {
        processId: z.string(),
        force: z.boolean().optional(),
      },
    },
    async ({ processId, force }) => {
      return runTool(ctx, "stop_process", processId, async () => {
        try {
          await ctx.services.processes.stopProcess(processId, force ?? false);
          const summary = ctx.services.processes.getSummary(processId);
          return okJson({ processId, status: summary?.status ?? "stopped" });
        } catch (err: unknown) {
          if (err instanceof Error && err.message === "PROCESS_NOT_FOUND") {
            throw new LocalBridgeError("PROCESS_NOT_FOUND", "The requested process no longer exists.");
          }
          throw err;
        }
      });
    }
  );

  server.registerTool(
    "list_processes",
    {
      description: "List processes started and tracked by LocalBridge only.",
      inputSchema: {},
    },
    async () =>
      runTool(ctx, "list_processes", undefined, async () =>
        okJson({ processes: ctx.services.processes.list() })
      )
  );
}

function registerReadTerminal(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "read_terminal",
    {
      description:
        "Return recent output from LocalBridge-managed processes (preferred over scraping VS Code terminal UI).",
      inputSchema: {
        processId: z.string().optional(),
        maxLines: z.number().int().positive().optional(),
      },
    },
    async ({ processId, maxLines }) => {
      return runTool(ctx, "read_terminal", processId, async () => {
        const processes = ctx.services.processes.list();
        const target =
          processId ??
          processes
            .filter((p) => p.status === "running")
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.processId;

        if (!target) {
          return okJson({
            processId: null,
            status: "idle",
            stdout: "",
            stderr: "",
            truncated: false,
          });
        }

        const out = ctx.services.processes.readOutput(target, maxLines ?? 200);
        const summary = ctx.services.processes.getSummary(target);
        return okJson({
          ...out,
          startedAt: summary?.startedAt,
          command: summary?.command,
        });
      });
    }
  );
}

function registerDiagnostics(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "get_diagnostics",
    {
      description: "Return VS Code workspace diagnostics (errors, warnings) from language services.",
      inputSchema: {
        file: z.string().optional().describe("Optional workspace-relative file filter"),
        errorsOnly: z.boolean().optional(),
        warningsOnly: z.boolean().optional(),
      },
    },
    async ({ file, errorsOnly, warningsOnly }) => {
      return runTool(ctx, "get_diagnostics", file, async () => {
        const items: {
          file: string;
          line: number;
          column: number;
          severity: string;
          message: string;
          source?: string;
          code?: string | number;
        }[] = [];

        const roots = ctx.workspace.roots.map((r) => r.path);
        const uriFilter = file
          ? vscode.Uri.file(
              await ctx.workspace.resolveAbsolute(normalizeRelativePath(file)).then((r) => r.absolutePath)
            )
          : undefined;

        for (const [uri, diags] of vscode.languages.getDiagnostics()) {
          if (uri.scheme !== "file") {
            continue;
          }
          const fsPath = uri.fsPath;
          if (!roots.some((root) => fsPath.startsWith(root))) {
            continue;
          }
          if (uriFilter && uri.toString() !== uriFilter.toString()) {
            continue;
          }

          const rel = relativeToWorkspace(fsPath, roots);
          for (const d of diags) {
            const severity = severityLabel(d.severity);
            if (errorsOnly && severity !== "error") {
              continue;
            }
            if (warningsOnly && severity !== "warning") {
              continue;
            }
            items.push({
              file: rel,
              line: d.range.start.line + 1,
              column: d.range.start.character + 1,
              severity,
              message: d.message,
              source: d.source,
              code: typeof d.code === "object" ? String(d.code.value) : d.code,
            });
          }
        }

        return okJson({ diagnostics: items });
      });
    }
  );
}

function registerRunTests(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "run_tests",
    {
      description:
        "Run project tests using detected package manager (npm/pnpm/yarn/bun, pytest, go test, cargo test, Maven/Gradle). " +
        "Does not install dependencies or modify configuration.",
      inputSchema: {
        command: z.string().optional(),
        test: z.string().optional().describe("npm/yarn script name when auto-detecting Node projects"),
        cwd: z.string().optional(),
        timeout_ms: z.number().int().positive().optional(),
      },
    },
    async ({ command, test, cwd, timeout_ms }) => {
      return runTool(ctx, "run_tests", cwd ?? ".", async () => {
        const absCwd = await resolveCommandCwd(ctx.workspace, cwd);
        const cmd = await resolveTestCommand(ctx.workspace.primary.root, command, test);
        await authorizeCommand(ctx.permissions, cmd, "run_tests");
        const limits = ctx.services.executionLimits;
        const result = await runTests({
          workspaceRoot: ctx.workspace.primary.root,
          cwd: absCwd,
          command,
          test,
          timeoutMs: timeout_ms ?? limits.defaultTestTimeoutMs,
          limits,
        });
        return okJson(result);
      });
    }
  );
}

function registerListLocalServers(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "list_local_servers",
    {
      description:
        "List listening ports detected from LocalBridge-managed dev processes (no aggressive port scanning).",
      inputSchema: {},
    },
    async () =>
      runTool(ctx, "list_local_servers", undefined, async () =>
        okJson({ servers: ctx.services.processes.findListeningServers() })
      )
  );
}

function registerHttpRequest(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "http_request",
    {
      description:
        "Send an HTTP request to localhost only (dev servers). Requires user approval. Response size is bounded.",
      inputSchema: {
        method: z.string(),
        url: z.string(),
        headers: z.record(z.string()).optional(),
        body: z.string().nullable().optional(),
        timeout_ms: z.number().int().positive().optional(),
      },
    },
    async ({ method, url, headers, body, timeout_ms }) => {
      return runTool(ctx, "http_request", url, async () => {
        validateLocalHttpUrl(url);
        const decision = await ctx.permissions.requestHttpPermission(url, method);
        if (decision === "deny") {
          throw new LocalBridgeError("USER_PERMISSION_DENIED", "HTTP request denied by the user.");
        }
        const limits = ctx.services.executionLimits;
        const result = await httpRequestLocal(
          {
            method,
            url,
            headers,
            body: body ?? null,
            timeoutMs: timeout_ms ?? limits.httpTimeoutMs,
          },
          limits
        );
        return okJson(result);
      });
    }
  );
}

function registerGetEnvironment(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "get_environment",
    {
      description:
        "Safe development environment metadata (OS, runtimes, workspace). Does not expose environment variable values or secrets.",
      inputSchema: {},
    },
    async () =>
      runTool(ctx, "get_environment", undefined, async () =>
        okJson(await gatherEnvironmentInfo(ctx.workspace))
      )
  );
}

function registerGitReadTools(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "git_log",
    {
      description: "Read-only git log (oneline, bounded).",
      inputSchema: { maxCount: z.number().int().positive().optional() },
    },
    async ({ maxCount }) =>
      runTool(ctx, "git_log", undefined, async () => ok(await ctx.services.git.log(maxCount ?? 20)))
  );

  server.registerTool(
    "git_show",
    {
      description: "Read-only git show for a revision (defaults to HEAD).",
      inputSchema: { revision: z.string().optional() },
    },
    async ({ revision }) =>
      runTool(ctx, "git_show", revision, async () => ok(await ctx.services.git.show(revision ?? "HEAD")))
  );

  server.registerTool(
    "git_staged_diff",
    {
      description: "Read-only diff of staged changes.",
      inputSchema: { path: z.string().optional() },
    },
    async ({ path: scope }) => {
      return runTool(ctx, "git_staged_diff", scope, async () => {
        if (scope && isSensitivePath(normalizeRelativePath(scope))) {
          const decision = await ctx.permissions.requestReadPermission(normalizeRelativePath(scope));
          if (decision === "deny") {
            throw new LocalBridgeError("USER_PERMISSION_DENIED", "Diff denied by the user.");
          }
        }
        return ok(await ctx.services.git.stagedDiff(scope));
      });
    }
  );
}

function registerWorkspaceIntelligence(server: McpServer, ctx: ToolHandlersContext): void {
  server.registerTool(
    "get_workspace_info",
    {
      description: "Workspace metadata: folders, detected project type, git branch summary.",
      inputSchema: {},
    },
    async () =>
      runTool(ctx, "get_workspace_info", undefined, async () => {
        const project = await detectProject(ctx.workspace.primary.root);
        const branch = await ctx.services.git.branch().catch(() => "");
        const status = await ctx.services.git.status().catch(() => "");
        return okJson({
          name: ctx.workspace.roots.map((r) => r.name).join(", "),
          workspaceRoot: ctx.workspace.primary.root,
          workspaceFolders: ctx.workspace.roots,
          projectKind: project.kind,
          packageManager: project.packageManager ?? null,
          gitBranch: branch.split("\n")[0] ?? "",
          gitStatusSummary: status.split("\n").slice(0, 5).join("\n"),
        });
      })
  );

  server.registerTool(
    "get_active_editor",
    {
      description: "Active editor file, language, selection, and cursor position in VS Code.",
      inputSchema: {},
    },
    async () =>
      runTool(ctx, "get_active_editor", undefined, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return okJson({ active: false });
        }
        const doc = editor.document;
        const roots = ctx.workspace.roots.map((r) => r.path);
        if (!roots.some((root) => doc.uri.fsPath.startsWith(root))) {
          return okJson({ active: false, reason: "Editor is outside the authorized workspace." });
        }
        const rel = relativeToWorkspace(doc.uri.fsPath, roots);
        const sel = editor.selection;
        return okJson({
          active: true,
          file: rel,
          language: doc.languageId,
          cursor: {
            line: sel.active.line + 1,
            column: sel.active.character + 1,
          },
          selection:
            sel.isEmpty
              ? null
              : {
                  start: { line: sel.start.line + 1, column: sel.start.character + 1 },
                  end: { line: sel.end.line + 1, column: sel.end.character + 1 },
                },
          visibleRange: {
            start: editor.visibleRanges[0]?.start.line ?? 0,
            end: editor.visibleRanges[0]?.end.line ?? 0,
          },
        });
      })
  );
}

function severityLabel(sev: vscode.DiagnosticSeverity): string {
  switch (sev) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    default:
      return "hint";
  }
}

function relativeToWorkspace(fsPath: string, roots: string[]): string {
  for (const root of roots) {
    if (fsPath.startsWith(root)) {
      const rel = fsPath.slice(root.length).replace(/^[/\\]/, "");
      return rel.replace(/\\/g, "/");
    }
  }
  return fsPath;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
