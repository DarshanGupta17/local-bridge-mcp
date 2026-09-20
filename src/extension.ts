import * as vscode from "vscode";
import { loadExtensionDevEnv } from "./config/envFile.js";
import { ConnectionService } from "./connectionService.js";
import { StatusBarController } from "./ui/statusBar.js";
import { ConnectorPanel } from "./ui/connectorPanel.js";
import { registerDiffContentProvider } from "./security/permissionManager.js";
import { AppServices } from "./core/appServices.js";
import { storeNgrokAuthtoken } from "./ngrok/secrets.js";

let connectionService: ConnectionService | undefined;
let appServices: AppServices | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  loadExtensionDevEnv(context.extensionPath, (msg) => {
    console.log(`[LocalBridge] ${msg}`);
  });

  registerDiffContentProvider(context);

  appServices = AppServices.create(context);
  await appServices.auth.ensureToken();

  const statusBar = new StatusBarController();
  const panel = new ConnectorPanel();
  connectionService = new ConnectionService(context, appServices, statusBar, panel);

  context.subscriptions.push(statusBar, panel);

  context.subscriptions.push(
    vscode.commands.registerCommand("localbridge.start", () => connectionService?.start()),
    vscode.commands.registerCommand("localbridge.stop", () => connectionService?.stop()),
    vscode.commands.registerCommand("localbridge.restart", () => connectionService?.restart()),
    vscode.commands.registerCommand("localbridge.copyConnectorUrl", () =>
      connectionService?.copyConnectorUrl()
    ),
    vscode.commands.registerCommand("localbridge.copyAuthenticatedConnectorUrl", () =>
      connectionService?.copyAuthenticatedConnectorUrl()
    ),
    vscode.commands.registerCommand("localbridge.showConnector", () => {
      connectionService?.showConnectorPanel();
    }),
    vscode.commands.registerCommand("localbridge.openLocalConnector", () =>
      connectionService?.openLocalConnector()
    ),
    vscode.commands.registerCommand("localbridge.copyAuthToken", async () => {
      const token = await appServices!.auth.getToken();
      if (!token) {
        vscode.window.showWarningMessage("LocalBridge authentication token is not available.");
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        "The LocalBridge authentication token grants access to your local MCP server. Treat it like a password. Copy to clipboard?",
        { modal: true },
        "Copy"
      );
      if (confirm === "Copy") {
        await vscode.env.clipboard.writeText(token);
        vscode.window.showInformationMessage(
          "LocalBridge MCP authentication token copied. Configure your MCP client with Authorization: Bearer <token>."
        );
      }
    }),
    vscode.commands.registerCommand("localbridge.regenerateAuthToken", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Regenerating invalidates the current token. All MCP clients must be updated. Continue?",
        { modal: true },
        "Regenerate"
      );
      if (confirm !== "Regenerate") {
        return;
      }
      await appServices!.auth.rotateToken();
      vscode.window.showInformationMessage(
        "Authentication token regenerated. Use LocalBridge: Copy MCP Authentication Token to configure clients."
      );
      await connectionService?.restart();
    }),
    vscode.commands.registerCommand("localbridge.configureNgrok", async () => {
      const token = await vscode.window.showInputBox({
        title: "LocalBridge ngrok authtoken",
        password: true,
        prompt: "Enter your ngrok authtoken (stored in VS Code SecretStorage, separate from LocalBridge MCP auth).",
        ignoreFocusOut: true,
      });
      if (token?.trim()) {
        await storeNgrokAuthtoken(context, token);
        vscode.window.showInformationMessage("ngrok authtoken saved securely. Restart LocalBridge to apply.");
      }
    }),
    vscode.commands.registerCommand("localbridge.viewAuditLog", async () => {
      const records = await appServices!.audit.readRecent(50);
      const doc = await vscode.workspace.openTextDocument({
        content: records.length
          ? records.map((r) => JSON.stringify(r)).join("\n")
          : "No audit records yet.",
        language: "json",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand("localbridge.clearAuditLog", async () => {
      const confirm = await vscode.window.showWarningMessage("Clear LocalBridge audit log?", "Clear");
      if (confirm === "Clear") {
        await appServices!.audit.clear();
      }
    })
  );

  statusBar.setCommand("localbridge.showConnector");

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void handleWorkspaceChange();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("localbridge")) {
        appServices?.refreshConfig();
      }
    })
  );

  const autoStart = vscode.workspace.getConfiguration("localbridge").get<boolean>("autoStart", true);
  if (!autoStart) {
    statusBar.setStatus("stopped");
    return;
  }

  const started = await tryAutoStart(connectionService, statusBar);
  if (!started) {
    const sub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void tryAutoStart(connectionService!, statusBar).then((ok) => {
        if (ok) {
          sub.dispose();
        }
      });
    });
    context.subscriptions.push(sub);
  }
}

async function tryAutoStart(
  service: ConnectionService,
  statusBar: StatusBarController
): Promise<boolean> {
  const folder = await waitForWorkspaceFolder(8000);
  if (!folder) {
    statusBar.setStatus("error", "Open a workspace folder to use LocalBridge.");
    vscode.window.showErrorMessage(
      "LocalBridge requires an opened folder/workspace. Open a folder and run LocalBridge: Start."
    );
    return false;
  }
  await service.start();
  return true;
}

function waitForWorkspaceFolder(timeoutMs: number): Promise<vscode.WorkspaceFolder | undefined> {
  const existing = vscode.workspace.workspaceFolders?.[0];
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(vscode.workspace.workspaceFolders?.[0]);
    }, timeoutMs);

    const sub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        clearTimeout(timer);
        sub.dispose();
        resolve(folder);
      }
    });
  });
}

export async function deactivate(): Promise<void> {
  await connectionService?.dispose();
  connectionService = undefined;
  appServices = undefined;
}

async function handleWorkspaceChange(): Promise<void> {
  if (!connectionService) {
    return;
  }
  await connectionService.stop();
  const autoStart = vscode.workspace.getConfiguration("localbridge").get<boolean>("autoStart", true);
  if (autoStart && vscode.workspace.workspaceFolders?.length) {
    await connectionService.start();
  }
}
