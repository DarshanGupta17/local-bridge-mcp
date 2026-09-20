import * as vscode from "vscode";

export type ConnectionStatus = "connected" | "local" | "connecting" | "stopped" | "error";

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "repobridge.showConnector";
    this.setStatus("stopped");
  }

  setStatus(status: ConnectionStatus, detail?: string): void {
    switch (status) {
      case "connected":
        this.item.text = "$(radio-tower) RepoBridge: Connected";
        this.item.tooltip = detail ?? "RepoBridge is connected. Click to open the connector panel.";
        this.item.backgroundColor = undefined;
        break;
      case "local":
        this.item.text = "$(home) RepoBridge: Local";
        this.item.tooltip =
          detail ??
          "MCP server on localhost (ngrok unavailable). Click for connector URL. Remote clients need ngrok.";
        this.item.backgroundColor = undefined;
        break;
      case "connecting":
        this.item.text = "$(sync~spin) RepoBridge: Connecting…";
        this.item.tooltip = detail ?? "Starting MCP server and ngrok tunnel…";
        this.item.backgroundColor = undefined;
        break;
      case "error":
        this.item.text = "$(error) RepoBridge: Error";
        this.item.tooltip = detail ?? "RepoBridge failed to start. Click for details.";
        this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        break;
      case "stopped":
      default:
        this.item.text = "$(circle-slash) RepoBridge: Stopped";
        this.item.tooltip = detail ?? "RepoBridge is stopped. Click to start.";
        this.item.backgroundColor = undefined;
        break;
    }
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
