import * as vscode from "vscode";
import type { ConnectionService } from "../connectionService.js";

interface StatusQuickPickItem extends vscode.QuickPickItem {
  action?: () => void | Promise<void> | Thenable<void>;
}

export async function showStatusMenu(connectionService: ConnectionService): Promise<void> {
  const state = connectionService.getPanelState();
  const isRunning = state.mcpRunning;
  const isPublic = state.connectionMode === "public";
  const providerLabel =
    state.publicProvider === "cloudflare"
      ? "Cloudflare"
      : state.publicProvider === "ngrok"
        ? "ngrok"
        : undefined;
  const endpoint = state.publicUrl;

  const items: StatusQuickPickItem[] = [];

  // Status indicator item
  if (isRunning) {
    items.push({
      label: `$(pass-filled) LocalBridge: Running`,
      description: isPublic
        ? providerLabel
          ? `Public (${providerLabel})`
          : "Public"
        : "Localhost",
      detail: endpoint ? `Endpoint: ${endpoint}` : undefined,
      action: async () => {
        if (endpoint) {
          await connectionService.copyConnectorUrl();
        }
      },
    });
  } else if (state.error) {
    items.push({
      label: `$(error) LocalBridge: Error`,
      description: "Failed to start",
      detail: state.error,
      action: () => connectionService.showConnectorPanel(),
    });
  } else {
    items.push({
      label: `$(circle-slash) LocalBridge: Stopped`,
      detail: "LocalBridge is not currently running",
      action: () => connectionService.start(),
    });
  }

  // Separator
  items.push({
    label: "",
    kind: vscode.QuickPickItemKind.Separator,
  });

  // Action: Copy MCP Endpoint
  if (isRunning && endpoint) {
    items.push({
      label: "$(copy) Copy MCP Endpoint",
      detail: endpoint,
      action: () => connectionService.copyConnectorUrl(),
    });
    items.push({
      label: "$(key) Copy MCP Endpoint (with token, for Claude)",
      detail: "Copies URL with access_token query parameter for URL-only clients",
      action: () => connectionService.copyAuthenticatedConnectorUrl(),
    });
  }

  // Action: Open LocalBridge panel
  items.push({
    label: "$(layout-sidebar-left) Open LocalBridge",
    detail: "View connection status and configuration",
    action: () => connectionService.showConnectorPanel(),
  });

  // Action: Open Settings
  items.push({
    label: "$(gear) Open Settings",
    detail: "Open LocalBridge configuration in VS Code Settings",
    action: () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Darshangupta.localbridge"),
  });

  // Action: Restart / Stop / Start
  if (isRunning) {
    items.push({
      label: "$(debug-restart) Restart LocalBridge",
      action: () => connectionService.restart(),
    });
    items.push({
      label: "$(primitive-square) Stop LocalBridge",
      action: () => connectionService.stop(),
    });
  } else {
    items.push({
      label: "$(play) Start LocalBridge",
      action: () => connectionService.start(),
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: isRunning
      ? `LocalBridge is running (${isPublic ? "Public" : "Localhost"})`
      : "LocalBridge is stopped",
    matchOnDetail: true,
  });

  if (selected?.action) {
    await selected.action();
  }
}
