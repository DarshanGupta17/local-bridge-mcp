import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type * as vscode from "vscode";
import {
  emptyProjectContext,
  type ContextHistoryEntry,
  type ProjectContext,
  type ProjectDecision,
} from "./projectContext.js";

const MAX_HISTORY = 200;

export class ContextEngine {
  private readonly storeDir: string;
  private enabled: boolean;

  constructor(
    globalStorageUri: vscode.Uri,
    enabled: boolean,
    private readonly workspaceRoots: () => string[]
  ) {
    this.storeDir = path.join(globalStorageUri.fsPath, "context");
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  projectId(): string {
    const roots = this.workspaceRoots().sort().join("|");
    return crypto.createHash("sha256").update(roots).digest("hex").slice(0, 16);
  }

  async getContext(): Promise<ProjectContext> {
    if (!this.enabled) {
      return emptyProjectContext(this.projectId(), this.workspaceRoots());
    }
    const file = this.contextFile();
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as ProjectContext;
      parsed.workspaceRoots = this.workspaceRoots();
      return parsed;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return emptyProjectContext(this.projectId(), this.workspaceRoots());
      }
      throw err;
    }
  }

  async updateContext(
    patch: Partial<ProjectContext> & { updatedBy?: string },
    agentLabel?: string
  ): Promise<ProjectContext> {
    if (!this.enabled) {
      throw new Error("Project context is disabled in settings.");
    }
    const current = await this.getContext();
    const updatedBy = patch.updatedBy ?? agentLabel;
    const next: ProjectContext = {
      ...current,
      ...patch,
      projectId: current.projectId,
      workspaceRoots: this.workspaceRoots(),
      decisions: patch.decisions ?? current.decisions,
      importantFiles: patch.importantFiles ?? current.importantFiles,
      knownIssues: patch.knownIssues ?? current.knownIssues,
      todos: patch.todos ?? current.todos,
      history: [...current.history],
      lastUpdated: new Date().toISOString(),
      updatedBy,
    };

    const historyEntries: ContextHistoryEntry[] = [];
    for (const field of [
      "projectSummary",
      "currentObjective",
      "activeTask",
      "taskStatus",
      "architectureNotes",
      "conventions",
    ] as const) {
      if (patch[field] !== undefined && patch[field] !== current[field]) {
        historyEntries.push({
          timestamp: next.lastUpdated,
          updatedBy,
          field,
          summary: String(patch[field]).slice(0, 500),
        });
      }
    }
    next.history = [...next.history, ...historyEntries].slice(-MAX_HISTORY);

    await fs.mkdir(this.storeDir, { recursive: true });
    await fs.writeFile(this.contextFile(), JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  async addDecision(decision: Omit<ProjectDecision, "id"> & { id?: string }, agentLabel?: string): Promise<ProjectContext> {
    const ctx = await this.getContext();
    const entry: ProjectDecision = {
      id: decision.id ?? crypto.randomUUID(),
      title: decision.title,
      reason: decision.reason,
      date: decision.date ?? new Date().toISOString().slice(0, 10),
      updatedBy: decision.updatedBy ?? agentLabel,
    };
    return this.updateContext(
      {
        decisions: [...ctx.decisions, entry],
        history: [
          ...ctx.history,
          {
            timestamp: new Date().toISOString(),
            updatedBy: agentLabel,
            field: "decision",
            summary: entry.title,
          },
        ],
      },
      agentLabel
    );
  }

  recordAutomaticFact(summary: string): void {
    if (!this.enabled) {
      return;
    }
    void this.getContext().then((ctx) =>
      this.updateContext({
        history: [
          ...ctx.history,
          {
            timestamp: new Date().toISOString(),
            field: "activity",
            summary: summary.slice(0, 500),
          },
        ],
      })
    );
  }

  private contextFile(): string {
    return path.join(this.storeDir, `${this.projectId()}.json`);
  }
}
