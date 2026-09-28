import * as vscode from "vscode";
import { loadExtensionDevEnv } from "./config/envFile.js";
import { StatusBarController } from "./ui/statusBar.js";
import { ConnectorPanel } from "./ui/connectorPanel.js";
import type { ConnectionService } from "./connectionService.js";
import type { AppServices } from "./core/appServices.js";

let connectionService: ConnectionService | undefined;
let appServices: AppServices | undefined;
let bootPromise: Promise<void> | undefined;
let workspaceListenersRegistered = false;

const statusBar = new StatusBarController();
const panel = new ConnectorPanel();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  loadExtensionDevEnv(context.extensionPath, (msg) => {
    console.log(`[LocalBridge] ${msg}`);
  });

  statusBar.setCommand("localbridge.statusMenu");
  statusBar.setStatus("stopped");

  panel.setLifecycleHandlers({
    ensureBoot: () => ensureBoot(context),
    onSidebarOpen: () => bootstrapAfterSidebarOpen(context),
  });

  context.subscriptions.push(
    statusBar,
    panel,
    vscode.window.registerWebviewViewProvider("localbridge.sidebar", panel)
  );

  registerCommands(context);
}

function registerCommands(context: vscode.ExtensionContext): void {
  const withBoot =
    <T extends unknown[]>(fn: () => void | Promise<void>) =>
    async (..._args: T) => {
      await ensureBoot(context);
      await fn();
    };

  context.subscriptions.push(
    vscode.commands.registerCommand("localbridge.open", withBoot(() => connectionService?.showConnectorPanel())),
    vscode.commands.registerCommand(
      "localbridge.openInEditor",
      withBoot(() => connectionService?.showConnectorPanel())
    ),
    vscode.commands.registerCommand("localbridge.focusSidebar", () =>
      vscode.commands.executeCommand("workbench.view.extension.localbridge")
    ),
    vscode.commands.registerCommand(
      "localbridge.showWelcome",
      withBoot(() => connectionService?.showConnectorPanel("welcome"))
    ),
    vscode.commands.registerCommand(
      "localbridge.resetOnboarding",
      withBoot(async () => {
        const { clearPersistedExtensionData } = await import("./lifecycle/runtimeCleanup.js");
        await clearPersistedExtensionData(context);
        panel.showWelcomeInSidebar(context);
        connectionService?.showConnectorPanel("welcome");
        vscode.window.showInformationMessage(
          "LocalBridge data was reset. Use Get Started in the sidebar to connect again."
        );
      })
    ),
    vscode.commands.registerCommand("localbridge.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:localbridge.localbridge")
    ),
    vscode.commands.registerCommand(
      "localbridge.statusMenu",
      withBoot(async () => {
        if (connectionService) {
          const { showStatusMenu } = await import("./ui/statusMenu.js");
          await showStatusMenu(connectionService);
        }
      })
    ),
    vscode.commands.registerCommand(
      "localbridge.start",
      withBoot(() => connectionService?.start())
    ),
    vscode.commands.registerCommand(
      "localbridge.stop",
      withBoot(() => connectionService?.stop())
    ),
    vscode.commands.registerCommand(
      "localbridge.restart",
      withBoot(() => connectionService?.restart())
    ),
    vscode.commands.registerCommand(
      "localbridge.copyConnectorUrl",
      withBoot(() => connectionService?.copyConnectorUrl())
    ),
    vscode.commands.registerCommand(
      "localbridge.copyAuthenticatedConnectorUrl",
      withBoot(() => connectionService?.copyAuthenticatedConnectorUrl())
    ),
    vscode.commands.registerCommand(
      "localbridge.showConnector",
      withBoot(() => connectionService?.showConnectorPanel())
    ),
    vscode.commands.registerCommand(
      "localbridge.openLocalConnector",
      withBoot(() => connectionService?.openLocalConnector())
    ),
    vscode.commands.registerCommand(
      "localbridge.copyAuthToken",
      withBoot(async () => {
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
      })
    ),
    vscode.commands.registerCommand(
      "localbridge.regenerateAuthToken",
      withBoot(async () => {
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
      })
    ),
    vscode.commands.registerCommand(
      "localbridge.configureNgrok",
      withBoot(async () => {
        const { storeNgrokAuthtoken } = await import("./ngrok/secrets.js");
        const token = await vscode.window.showInputBox({
          title: "LocalBridge ngrok authtoken",
          password: true,
          prompt:
            "Enter your ngrok authtoken (stored in VS Code SecretStorage, separate from LocalBridge MCP auth).",
          ignoreFocusOut: true,
        });
        if (token?.trim()) {
          await storeNgrokAuthtoken(context, token);
          vscode.window.showInformationMessage("ngrok authtoken saved securely. Restart LocalBridge to apply.");
        }
      })
    ),
    vscode.commands.registerCommand(
      "localbridge.viewAuditLog",
      withBoot(async () => {
        const records = await appServices!.audit.readRecent(50);
        const doc = await vscode.workspace.openTextDocument({
          content: records.length
            ? records.map((r) => JSON.stringify(r)).join("\n")
            : "No audit records yet.",
          language: "json",
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      })
    ),
    vscode.commands.registerCommand(
      "localbridge.clearAuditLog",
      withBoot(async () => {
        const confirm = await vscode.window.showWarningMessage("Clear LocalBridge audit log?", "Clear");
        if (confirm === "Clear") {
          await appServices!.audit.clear();
        }
      })
    )
  );
}

async function ensureBoot(context: vscode.ExtensionContext): Promise<void> {
  if (bootPromise) {
    return bootPromise;
  }

  bootPromise = (async () => {
    const [{ registerDiffContentProvider }, { AppServices }, { ConnectionService }] = await Promise.all([
      import("./security/permissionManager.js"),
      import("./core/appServices.js"),
      import("./connectionService.js"),
    ]);

    registerDiffContentProvider(context);

    appServices = AppServices.create(context);
    connectionService = new ConnectionService(context, appServices, statusBar, panel);
    panel.bindContext(context, connectionService);

    if (!workspaceListenersRegistered) {
      workspaceListenersRegistered = true;
      context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
          void handleWorkspaceChange();
        }),
        vscode.workspace.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration("localbridge")) {
            appServices?.refreshConfig();
          }
          if (e.affectsConfiguration("localbridge.ngrok.authtoken")) {
            void (async () => {
              const config = vscode.workspace.getConfiguration("localbridge");
              const fromSetting = config.get<string>("ngrok.authtoken", "").trim();
              if (!fromSetting) {
                return;
              }
              const { storeNgrokAuthtoken } = await import("./ngrok/secrets.js");
              await storeNgrokAuthtoken(context, fromSetting);
            })();
          }
        })
      );
    }
  })();

  return bootPromise;
}

async function bootstrapAfterSidebarOpen(context: vscode.ExtensionContext): Promise<void> {
  if (!connectionService) {
    return;
  }

  panel.syncSidebarViewStep(context);
  statusBar.setStatus("stopped");
  panel.update();
}

export async function deactivate(): Promise<void> {
  await connectionService?.dispose();
  connectionService = undefined;
  appServices = undefined;
  bootPromise = undefined;
}

async function handleWorkspaceChange(): Promise<void> {
  if (!connectionService) {
    return;
  }
  await connectionService.stop();
  statusBar.setStatus("stopped");
  panel.update();
}
