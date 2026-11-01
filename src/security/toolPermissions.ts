import * as vscode from "vscode";

export type ToolPermissionLevel = "always_allow" | "needs_approval" | "blocked";

export interface McpToolDefinition {
  name: string;
  title: string;
  category: string;
  description: string;
}

/** Canonical MCP tool list — keep in sync with registerMcpTools / registerExecutionTools. */
export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "read_file",
    title: "Read file",
    category: "Workspace",
    description: "Read workspace files (sensitive paths prompt when approval is required).",
  },
  {
    name: "search_file",
    title: "Search files",
    category: "Workspace",
    description: "Search the workspace (sensitive scoped search may prompt).",
  },
  {
    name: "write_file",
    title: "Write file",
    category: "Workspace",
    description: "Modify existing files.",
  },
  {
    name: "create_file",
    title: "Create file",
    category: "Workspace",
    description: "Create new files.",
  },
  {
    name: "delete_file",
    title: "Delete file",
    category: "Workspace",
    description: "Delete files.",
  },
  {
    name: "create_directory",
    title: "Create directory",
    category: "Workspace",
    description: "Create folders.",
  },
  {
    name: "delete_directory",
    title: "Delete directory",
    category: "Workspace",
    description: "Delete folders and contents.",
  },
  {
    name: "git_status",
    title: "Git status",
    category: "Git",
    description: "Read git status.",
  },
  {
    name: "git_branch",
    title: "Git branch",
    category: "Git",
    description: "List or describe branches.",
  },
  {
    name: "git_diff",
    title: "Git diff",
    category: "Git",
    description: "Read git diffs (sensitive paths may prompt).",
  },
  {
    name: "git_log",
    title: "Git log",
    category: "Git",
    description: "Read commit history.",
  },
  {
    name: "git_show",
    title: "Git show",
    category: "Git",
    description: "Show a commit.",
  },
  {
    name: "git_staged_diff",
    title: "Git staged diff",
    category: "Git",
    description: "Diff staged changes (sensitive paths may prompt).",
  },
  {
    name: "run_command",
    title: "Run command",
    category: "Execution",
    description: "Run a shell command in the workspace.",
  },
  {
    name: "start_process",
    title: "Start process",
    category: "Execution",
    description: "Start a long-running process.",
  },
  {
    name: "read_process_output",
    title: "Read process output",
    category: "Execution",
    description: "Read output from a managed process.",
  },
  {
    name: "send_process_input",
    title: "Send process input",
    category: "Execution",
    description: "Send stdin to a managed process.",
  },
  {
    name: "stop_process",
    title: "Stop process",
    category: "Execution",
    description: "Stop a managed process.",
  },
  {
    name: "list_processes",
    title: "List processes",
    category: "Execution",
    description: "List managed processes.",
  },
  {
    name: "read_terminal",
    title: "Read terminal",
    category: "Execution",
    description: "Read integrated terminal output.",
  },
  {
    name: "get_diagnostics",
    title: "Get diagnostics",
    category: "Execution",
    description: "Read VS Code problems/diagnostics.",
  },
  {
    name: "run_tests",
    title: "Run tests",
    category: "Execution",
    description: "Run project tests via detected test command.",
  },
  {
    name: "list_local_servers",
    title: "List local servers",
    category: "Execution",
    description: "Detect local dev servers.",
  },
  {
    name: "http_request",
    title: "HTTP request (localhost)",
    category: "Execution",
    description: "HTTP requests to localhost only.",
  },
  {
    name: "get_environment",
    title: "Get environment",
    category: "Execution",
    description: "Environment and tooling info.",
  },
  {
    name: "get_project_context",
    title: "Get project context",
    category: "Context",
    description: "Read shared project context.",
  },
  {
    name: "update_project_context",
    title: "Update project context",
    category: "Context",
    description: "Update shared project context.",
  },
  {
    name: "get_workspace_info",
    title: "Get workspace info",
    category: "Workspace",
    description: "Workspace roots and layout.",
  },
  {
    name: "get_active_editor",
    title: "Get active editor",
    category: "Workspace",
    description: "Active editor file and selection.",
  },
];

const STORAGE_KEY = "localbridge.toolPermissions.v1";
const DEFAULT_LEVEL: ToolPermissionLevel = "needs_approval";

export class ToolPermissionStore {
  private readonly onChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onChangeEmitter.event;

  private overrides = new Map<string, ToolPermissionLevel>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.load();
  }

  getLevel(toolName: string): ToolPermissionLevel {
    return this.overrides.get(toolName) ?? DEFAULT_LEVEL;
  }

  setLevel(toolName: string, level: ToolPermissionLevel): void {
    if (!MCP_TOOL_DEFINITIONS.some((t) => t.name === toolName)) {
      return;
    }
    if (level === DEFAULT_LEVEL) {
      this.overrides.delete(toolName);
    } else {
      this.overrides.set(toolName, level);
    }
    void this.persist();
    this.onChangeEmitter.fire();
  }

  resetAll(): void {
    this.overrides.clear();
    void this.persist();
    this.onChangeEmitter.fire();
  }

  snapshot(): Record<string, ToolPermissionLevel> {
    const out: Record<string, ToolPermissionLevel> = {};
    for (const tool of MCP_TOOL_DEFINITIONS) {
      out[tool.name] = this.getLevel(tool.name);
    }
    return out;
  }

  isBlocked(toolName: string): boolean {
    return this.getLevel(toolName) === "blocked";
  }

  isAlwaysAllow(toolName: string): boolean {
    return this.getLevel(toolName) === "always_allow";
  }

  private load(): void {
    const raw = this.context.globalState.get<Record<string, ToolPermissionLevel>>(STORAGE_KEY);
    this.overrides = new Map();
    if (!raw || typeof raw !== "object") {
      return;
    }
    for (const [name, level] of Object.entries(raw)) {
      if (
        MCP_TOOL_DEFINITIONS.some((t) => t.name === name) &&
        (level === "always_allow" || level === "needs_approval" || level === "blocked")
      ) {
        this.overrides.set(name, level);
      }
    }
  }

  private async persist(): Promise<void> {
    const obj: Record<string, ToolPermissionLevel> = {};
    for (const [name, level] of this.overrides) {
      obj[name] = level;
    }
    await this.context.globalState.update(STORAGE_KEY, obj);
  }
}
