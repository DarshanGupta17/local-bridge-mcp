import * as vscode from "vscode";
import { loadExtensionDevEnv } from "./config/envFile.js";
import { ConnectionService } from "./connectionService.js";
import { StatusBarController } from "./ui/statusBar.js";
import { ConnectorPanel } from "./ui/connectorPanel.js";
import { registerDiffContentProvider } from "./security/permissionManager.js";

let connectionService: ConnectionService | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  loadExtensionDevEnv(context.extensionPath, (msg) => {
    // Logger not ready yet; Output channel is created with ConnectionService.
    console.log(`[RepoBridge] ${msg}`);
  });

  registerDiffContentProvider(context);

  const statusBar = new StatusBarController();
  const panel = new ConnectorPanel();
  connectionService = new ConnectionService(context, statusBar, panel);

  context.subscriptions.push(statusBar, panel);

  context.subscriptions.push(
    vscode.commands.registerCommand("repobridge.start", () => connectionService?.start()),
    vscode.commands.registerCommand("repobridge.stop", () => connectionService?.stop()),
    vscode.commands.registerCommand("repobridge.restart", () => connectionService?.restart()),
    vscode.commands.registerCommand("repobridge.copyConnectorUrl", () =>
      connectionService?.copyConnectorUrl()
    ),
    vscode.commands.registerCommand("repobridge.showConnector", () => {
      connectionService?.showConnectorPanel();
    }),
    vscode.commands.registerCommand("repobridge.openLocalConnector", () =>
      connectionService?.openLocalConnector()
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void handleWorkspaceChange();
    })
  );

  const autoStart = vscode.workspace.getConfiguration("repobridge").get<boolean>("autoStart", true);
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
    statusBar.setStatus("error", "Open a workspace folder to use RepoBridge.");
    vscode.window.showErrorMessage(
      "RepoBridge requires an opened folder/workspace. Open a folder and run RepoBridge: Start."
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
}

async function handleWorkspaceChange(): Promise<void> {
  if (!connectionService) {
    return;
  }
  await connectionService.stop();
  const autoStart = vscode.workspace.getConfiguration("repobridge").get<boolean>("autoStart", true);
  if (autoStart && vscode.workspace.workspaceFolders?.length) {
    await connectionService.start();
  }
}
