import * as fs from "node:fs/promises";
import * as path from "node:path";
import type * as vscode from "vscode";

export type AuditResult = "ALLOWED" | "DENIED" | "APPROVED" | "ERROR";

export interface AuditRecord {
  timestamp: string;
  operation: string;
  path?: string;
  client?: string;
  permission?: string;
  result: AuditResult;
  durationMs?: number;
  detail?: string;
}

const MAX_RECORDS = 5000;

export class AuditEngine {
  private readonly logPath: string;
  private enabled: boolean;

  constructor(
    private readonly globalStorageUri: vscode.Uri,
    enabled: boolean
  ) {
    this.logPath = path.join(globalStorageUri.fsPath, "audit.jsonl");
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async record(entry: Omit<AuditRecord, "timestamp">): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const line: AuditRecord = { timestamp: new Date().toISOString(), ...entry };
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    await fs.appendFile(this.logPath, `${JSON.stringify(line)}\n`, "utf8");
    await this.rotateIfNeeded();
  }

  async readRecent(limit = 100): Promise<AuditRecord[]> {
    try {
      const raw = await fs.readFile(this.logPath, "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l) as AuditRecord);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  async clear(): Promise<void> {
    await fs.unlink(this.logPath).catch(() => undefined);
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const raw = await fs.readFile(this.logPath, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      if (lines.length <= MAX_RECORDS) {
        return;
      }
      const trimmed = lines.slice(-MAX_RECORDS).join("\n") + "\n";
      await fs.writeFile(this.logPath, trimmed, "utf8");
    } catch {
      // ignore rotation errors
    }
  }
}
