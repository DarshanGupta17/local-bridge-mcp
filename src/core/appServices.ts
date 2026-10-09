import * as vscode from "vscode";
import { AuthenticationManager } from "../auth/authenticationManager.js";
import { AuditEngine } from "../audit/auditEngine.js";
import { ContextEngine } from "../context/contextEngine.js";
import { loadLocalBridgeLimits } from "../config/limits.js";
import { loadExecutionLimits, type ExecutionLimits } from "../config/executionLimits.js";
import { ProcessManager } from "../execution/processManager.js";
import { SecurityEngine } from "../security/securityEngine.js";
import { WorkspaceManager } from "../security/workspaceManager.js";
import { gitProviderForRoot } from "../git/gitContextProvider.js";
import type { GitContextProvider } from "../git/gitContextProvider.js";

export class AppServices {
  readonly auth: AuthenticationManager;
  readonly audit: AuditEngine;
  readonly context: ContextEngine;
  workspace!: WorkspaceManager;
  security!: SecurityEngine;
  git!: GitContextProvider;
  executionLimits!: ExecutionLimits;
  processes!: ProcessManager;

  private constructor(
    readonly vscodeContext: vscode.ExtensionContext,
    auditEnabled: boolean,
    contextEnabled: boolean
  ) {
    this.auth = new AuthenticationManager(vscodeContext.secrets);
    this.audit = new AuditEngine(vscodeContext.globalStorageUri, auditEnabled);
    this.context = new ContextEngine(
      vscodeContext.globalStorageUri,
      contextEnabled,
      () => this.workspace?.roots.map((r) => r.path) ?? []
    );
  }

  static create(vscodeContext: vscode.ExtensionContext): AppServices {
    const config = vscode.workspace.getConfiguration("localbridge");
    return new AppServices(
      vscodeContext,
      config.get<boolean>("auditLogEnabled", true),
      config.get<boolean>("contextEnabled", true)
    );
  }

  async bindWorkspace(folders: readonly vscode.WorkspaceFolder[]): Promise<void> {
    this.workspace = await WorkspaceManager.create(folders);
    this.security = new SecurityEngine(this.workspace, loadLocalBridgeLimits());
    this.executionLimits = loadExecutionLimits();
    this.processes?.disposeAll();
    this.processes = new ProcessManager(this.executionLimits);
    this.git = gitProviderForRoot(this.workspace.primary.root);
  }

  refreshConfig(): void {
    const config = vscode.workspace.getConfiguration("localbridge");
    this.audit.setEnabled(config.get<boolean>("auditLogEnabled", true));
    this.context.setEnabled(config.get<boolean>("contextEnabled", true));
    if (this.workspace) {
      this.security = new SecurityEngine(this.workspace, loadLocalBridgeLimits());
      this.executionLimits = loadExecutionLimits();
    }
  }

  disposeExecution(): void {
    this.processes?.disposeAll();
  }
}
