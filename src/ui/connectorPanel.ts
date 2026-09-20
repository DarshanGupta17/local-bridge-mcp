import * as vscode from "vscode";

export interface ConnectorPanelState {
  workspaceName: string;
  mcpRunning: boolean;
  publicUrl?: string;
  localPort?: number;
  connectionMode?: "public" | "local";
  warning?: string;
  error?: string;
}

export class ConnectorPanel {
  private panel: vscode.WebviewPanel | undefined;

  show(context: vscode.ExtensionContext, state: ConnectorPanelState): void {
    if (this.panel) {
      this.panel.reveal();
      this.update(state);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "localbridgeConnector",
      "LocalBridge",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage((message: { command: string }) => {
      switch (message.command) {
        case "copy":
          void vscode.commands.executeCommand("localbridge.copyConnectorUrl");
          break;
        case "restart":
          void vscode.commands.executeCommand("localbridge.restart");
          break;
        case "stop":
          void vscode.commands.executeCommand("localbridge.stop");
          break;
        case "open":
          void vscode.commands.executeCommand("localbridge.openLocalConnector");
          break;
      }
    });

    context.subscriptions.push(this.panel);
    this.update(state);
  }

  update(state: ConnectorPanelState): void {
    if (!this.panel) {
      return;
    }

    const url = state.publicUrl ?? "(not available)";
    const mcp = state.mcpRunning ? "Running" : "Stopped";
    const mode =
      state.connectionMode === "public"
        ? "Public (ngrok)"
        : state.connectionMode === "local"
          ? "Localhost only"
          : "—";
    const err = state.error
      ? `<p class="error">${escapeHtml(state.error)}</p>`
      : "";
    const warn = state.warning
      ? `<p class="warn">${escapeHtml(state.warning)}</p>`
      : "";

    this.panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); }
    h1 { font-size: 1.25rem; margin-top: 0; }
    .label { opacity: 0.8; margin-top: 12px; }
    .value { font-family: var(--vscode-editor-font-family); word-break: break-all; }
    .actions { margin-top: 20px; display: flex; gap: 8px; flex-wrap: wrap; }
    button { padding: 6px 12px; cursor: pointer; }
    .error { color: var(--vscode-errorForeground); }
    .warn { color: var(--vscode-editorWarning-foreground); }
  </style>
</head>
<body>
  <h1>LocalBridge</h1>
  ${err}
  ${warn}
  <div class="label">Workspace</div>
  <div class="value">${escapeHtml(state.workspaceName)}</div>
  <div class="label">MCP Server</div>
  <div class="value">${mcp}${state.localPort ? ` (localhost:${state.localPort})` : ""}</div>
  <div class="label">Connection</div>
  <div class="value">${escapeHtml(mode)}</div>
  <div class="label">MCP Connector URL</div>
  <div class="value">${escapeHtml(url)}</div>
  <div class="actions">
    <button onclick="post('open')">Open in browser</button>
    <button onclick="post('copy')">Copy Connector URL</button>
    <button onclick="post('restart')">Restart Connection</button>
    <button onclick="post('stop')">Stop Connection</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function post(command) { vscode.postMessage({ command }); }
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
