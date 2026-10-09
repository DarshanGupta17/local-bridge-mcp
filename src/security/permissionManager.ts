import * as vscode from "vscode";
import { isSensitivePath } from "./sensitivePathDetector.js";
import type { DirectoryDeletePreview } from "../workspace/directories.js";
import { isLargeDirectoryTree } from "../workspace/directories.js";
import type { Logger } from "../logger.js";

export type PermissionDecision = "allow" | "deny";
export type ReadPermissionDecision = "allow-once" | "deny";

export class PermissionManager {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly log: Logger,
    private readonly getClientLabel: () => string
  ) {}

  requestReadPermission(relativePath: string): Promise<ReadPermissionDecision> {
    return this.runExclusively(async () => {
      this.log.info(`Permission requested: operation=read_file path=${relativePath}`);
      const client = this.clientLabel();
      const choice = await vscode.window.showWarningMessage(
        [
          "LocalBridge — Sensitive File Access",
          "",
          `${client} is requesting access to:`,
          "",
          relativePath,
          "",
          "This file may contain:",
          "• API keys",
          "• passwords",
          "• database credentials",
          "• secrets",
        ].join("\n"),
        { modal: true },
        "Allow Once",
        "Deny"
      );
      const decision = choice === "Allow Once" ? "allow-once" : "deny";
      this.logPermissionResult("read_file", relativePath, decision === "allow-once" ? "granted" : "denied");
      return decision;
    });
  }

  requestWritePermission(
    relativePath: string,
    currentContent: string,
    newContent: string
  ): Promise<PermissionDecision> {
    return this.runExclusively(async () => {
      this.log.info(`Permission requested: operation=write_file path=${relativePath}`);
      const client = this.clientLabel();
      const sensitive = isSensitivePath(relativePath);

      if (sensitive) {
        const choice = await vscode.window.showWarningMessage(
          [
            "LocalBridge — HIGH RISK FILE MODIFICATION",
            "",
            `${client} wants to modify:`,
            "",
            relativePath,
            "",
            "This file may contain:",
            "• API keys",
            "• passwords",
            "• database credentials",
            "• secrets",
            "",
            "The file has NOT been modified yet.",
          ].join("\n"),
          { modal: true },
          "Allow",
          "Cancel"
        );
        const decision = choice === "Allow" ? "allow" : "deny";
        this.logPermissionResult("write_file", relativePath, decision === "allow" ? "granted" : "denied");
        return decision;
      }

      await showWriteDiffPreview(relativePath, currentContent, newContent);
      const preview = formatChangePreview(currentContent, newContent);

      const choice = await vscode.window.showWarningMessage(
        [
          "LocalBridge — File Modification",
          "",
          `${client} wants to modify:`,
          "",
          relativePath,
          "",
          "Changes:",
          "",
          preview,
          "",
          "The file has NOT been modified yet.",
        ].join("\n"),
        { modal: true },
        "Allow",
        "Deny"
      );
      const decision = choice === "Allow" ? "allow" : "deny";
      this.logPermissionResult("write_file", relativePath, decision === "allow" ? "granted" : "denied");
      return decision;
    });
  }

  requestDeleteDirectoryPermission(preview: DirectoryDeletePreview): Promise<PermissionDecision> {
    return this.runExclusively(async () => {
      this.log.info(`Permission requested: operation=delete_directory path=${preview.relativePath}`);
      const client = this.clientLabel();
      const body = formatDeleteDirectoryBody(preview, client);

      const approveLabel = preview.isEmpty ? "Delete Folder" : "DELETE EVERYTHING";
      const choice = await vscode.window.showWarningMessage(body, { modal: true }, approveLabel, "Cancel");
      const decision = choice === approveLabel ? "allow" : "deny";
      this.logPermissionResult(
        "delete_directory",
        preview.relativePath,
        decision === "allow" ? "granted" : "denied"
      );
      return decision;
    });
  }

  requestCreatePermission(relativePath: string): Promise<PermissionDecision> {
    return this.runExclusively(async () => {
      this.log.info(`Permission requested: operation=create_file path=${relativePath}`);
      const client = this.clientLabel();
      const sensitive = isSensitivePath(relativePath);
      const lines = sensitive
        ? [
            "LocalBridge — HIGH RISK CREATE FILE",
            "",
            `${client} wants to create:`,
            "",
            relativePath,
            "",
            "This path may hold secrets or credentials.",
            "",
            "The file has NOT been created yet.",
          ]
        : [
            "LocalBridge — Create File",
            "",
            `${client} wants to create:`,
            "",
            relativePath,
            "",
            "The file has NOT been created yet.",
          ];
      const choice = await vscode.window.showWarningMessage(lines.join("\n"), { modal: true }, "Allow", "Deny");
      const decision = choice === "Allow" ? "allow" : "deny";
      this.logPermissionResult("create_file", relativePath, decision === "allow" ? "granted" : "denied");
      return decision;
    });
  }

  requestCreateDirectoryPermission(relativePath: string): Promise<PermissionDecision> {
    return this.runExclusively(async () => {
      this.log.info(`Permission requested: operation=create_directory path=${relativePath}`);
      const client = this.clientLabel();
      const sensitive = isSensitivePath(relativePath);
      const lines = sensitive
        ? [
            "LocalBridge — HIGH RISK CREATE DIRECTORY",
            "",
            `${client} wants to create directory:`,
            "",
            relativePath,
            "",
            "The directory has NOT been created yet.",
          ]
        : [
            "LocalBridge — Create Directory",
            "",
            `${client} wants to create directory:`,
            "",
            relativePath,
            "",
            "The directory has NOT been created yet.",
          ];
      const choice = await vscode.window.showWarningMessage(lines.join("\n"), { modal: true }, "Allow", "Deny");
      const decision = choice === "Allow" ? "allow" : "deny";
      this.logPermissionResult("create_directory", relativePath, decision === "allow" ? "granted" : "denied");
      return decision;
    });
  }

  requestSensitiveSearchPermission(relativePath: string): Promise<ReadPermissionDecision> {
    return this.runExclusively(async () => {
      this.log.info(`Permission requested: operation=search_file path=${relativePath}`);
      const client = this.clientLabel();
      const choice = await vscode.window.showWarningMessage(
        [
          "LocalBridge — Sensitive Search",
          "",
          `${client} is requesting to search a sensitive path:`,
          "",
          relativePath,
          "",
          "Allow Once",
          "Deny",
        ].join("\n"),
        { modal: true },
        "Allow Once",
        "Deny"
      );
      const decision = choice === "Allow Once" ? "allow-once" : "deny";
      this.logPermissionResult("search_file", relativePath, decision === "allow-once" ? "granted" : "denied");
      return decision;
    });
  }

  requestCommandPermission(
    command: string,
    toolName: string,
    reason?: string
  ): Promise<PermissionDecision> {
    return this.runExclusively(async () => {
      this.log.info(`Permission requested: operation=${toolName} command=${command.slice(0, 120)}`);
      const client = this.clientLabel();
      const preview =
        command.length > 400 ? `${command.slice(0, 400)}…` : command;
      const choice = await vscode.window.showWarningMessage(
        [
          "LocalBridge — Shell Command",
          "",
          `${client} wants to run (${toolName}):`,
          "",
          preview,
          "",
          reason ? `Reason: ${reason}` : "",
          "",
          "This executes on your machine inside the workspace.",
        ]
          .filter(Boolean)
          .join("\n"),
        { modal: true },
        "Allow",
        "Deny"
      );
      const decision = choice === "Allow" ? "allow" : "deny";
      this.logPermissionResult(toolName, preview, decision === "allow" ? "granted" : "denied");
      return decision;
    });
  }

  requestHttpPermission(url: string, method: string): Promise<PermissionDecision> {
    return this.runExclusively(async () => {
      this.log.info(`Permission requested: operation=http_request url=${url}`);
      const client = this.clientLabel();
      const choice = await vscode.window.showWarningMessage(
        [
          "LocalBridge — Local HTTP Request",
          "",
          `${client} wants to send:`,
          "",
          `${method} ${url}`,
          "",
          "Only localhost targets are allowed.",
        ].join("\n"),
        { modal: true },
        "Allow",
        "Deny"
      );
      const decision = choice === "Allow" ? "allow" : "deny";
      this.logPermissionResult("http_request", url, decision === "allow" ? "granted" : "denied");
      return decision;
    });
  }

  requestDeletePermission(relativePath: string): Promise<PermissionDecision> {
    return this.runExclusively(async () => {
      this.log.info(`Permission requested: operation=delete_file path=${relativePath}`);
      const client = this.clientLabel();
      const sensitive = isSensitivePath(relativePath);

      const lines = sensitive
        ? [
            "LocalBridge — HIGH RISK DELETE FILE",
            "",
            `${client} wants to permanently delete:`,
            "",
            relativePath,
            "",
            "This file may contain secrets.",
            "",
            "This operation cannot be automatically approved.",
            "",
            "The file has NOT been deleted yet.",
          ]
        : [
            "LocalBridge — DELETE FILE",
            "",
            `${client} wants to permanently delete:`,
            "",
            relativePath,
            "",
            "This operation cannot be automatically approved.",
            "",
            "The file will be removed from the workspace.",
            "",
            "The file has NOT been deleted yet.",
          ];

      const choice = await vscode.window.showWarningMessage(
        lines.join("\n"),
        { modal: true },
        "DELETE FILE",
        "Cancel"
      );
      const decision = choice === "DELETE FILE" ? "allow" : "deny";
      this.logPermissionResult("delete_file", relativePath, decision === "allow" ? "granted" : "denied");
      return decision;
    });
  }

  private clientLabel(): string {
    return this.getClientLabel();
  }

  private logPermissionResult(operation: string, relativePath: string, result: "granted" | "denied"): void {
    this.log.info(`Permission ${result}: operation=${operation} path=${relativePath}`);
  }

  private runExclusively<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

const diffContent = new Map<string, string>();

export function registerDiffContentProvider(context: vscode.ExtensionContext): void {
  const provider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return diffContent.get(uri.toString()) ?? "";
    },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("localbridge-diff", provider)
  );
}

async function showWriteDiffPreview(
  relativePath: string,
  currentContent: string,
  newContent: string
): Promise<void> {
  const originalUri = vscode.Uri.parse(`localbridge-diff:original/${encodeURIComponent(relativePath)}`);
  const modifiedUri = vscode.Uri.parse(`localbridge-diff:modified/${encodeURIComponent(relativePath)}`);

  diffContent.set(originalUri.toString(), currentContent);
  diffContent.set(modifiedUri.toString(), newContent);

  try {
    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri,
      modifiedUri,
      `LocalBridge: ${relativePath}`
    );
  } catch {
    // Best-effort diff editor
  }
}

export function formatChangePreview(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines: string[] = [];
  let added = 0;
  let removed = 0;
  let shown = 0;
  const maxShow = 10;

  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) {
      continue;
    }
    if (b !== undefined) {
      removed++;
      if (shown < maxShow) {
        lines.push(`- ${b}`);
        shown++;
      }
    }
    if (a !== undefined) {
      added++;
      if (shown < maxShow) {
        lines.push(`+ ${a}`);
        shown++;
      }
    }
  }

  if (lines.length === 0) {
    return "(No line changes detected.)";
  }

  const summary = `(${removed} line(s) removed, ${added} line(s) added)`;
  if (shown >= maxShow) {
    lines.push("…");
  }
  return `${summary}\n${lines.join("\n")}`;
}

function formatDeleteDirectoryBody(preview: DirectoryDeletePreview, clientLabel: string): string {
  const header = preview.isEmpty
    ? "LocalBridge — Delete Folder"
    : "LocalBridge — HIGH RISK: DELETE FOLDER";

  if (preview.isEmpty) {
    return [
      header,
      "",
      `${clientLabel} wants to delete:`,
      "",
      preview.relativePath,
      "",
      "The folder is empty.",
      "",
      "The folder has NOT been deleted yet.",
    ].join("\n");
  }

  if (isLargeDirectoryTree(preview)) {
    return [
      header,
      "",
      "Folder:",
      "",
      preview.relativePath,
      "",
      "Contents:",
      "",
      `${preview.fileCount} files`,
      `${preview.directoryCount} directories`,
      "",
      `Estimated deletion: ${preview.totalEntries} filesystem entries`,
      "",
      "Deleting this folder will remove all of its contents.",
      "",
      "This operation cannot be undone by LocalBridge.",
      "",
      "The folder has NOT been deleted yet.",
    ].join("\n");
  }

  const listing = preview.samplePaths.map((p) => p).join("\n");
  const more =
    preview.totalEntries > preview.samplePaths.length
      ? `\n… and ${preview.totalEntries - preview.samplePaths.length} more`
      : "";

  return [
    header,
    "",
    `${clientLabel} wants to delete:`,
    "",
    preview.relativePath,
    "",
    "This folder contains:",
    "",
    listing + more,
    "",
    "Total:",
    `${preview.fileCount} files`,
    `${preview.directoryCount} directories`,
    "",
    "Deleting this folder will remove all of its contents.",
    "",
    "This operation cannot be undone by LocalBridge.",
    "",
    "The folder has NOT been deleted yet.",
  ].join("\n");
}
