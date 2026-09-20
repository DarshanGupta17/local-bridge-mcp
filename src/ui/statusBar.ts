import * as vscode from "vscode";

export type ConnectionStatus = "connected" | "local" | "connecting" | "stopped" | "error";

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "localbridge.showConnector";
    this.setStatus("stopped");
  }

  setCommand(command: string): void {
    this.item.command = command;
  }

  setStatus(status: ConnectionStatus, detail?: string): void {
    switch (status) {
      case "connected":
        this.item.text = "$(radio-tower) LocalBridge: Connected";
        this.item.tooltip = detail ?? "LocalBridge is connected. Click to open the connector panel.";
        this.item.backgroundColor = undefined;
        break;
      case "local":
        this.item.text = "$(home) LocalBridge: Local";
        this.item.tooltip =
          detail ??
          "MCP server on localhost (ngrok unavailable). Click for connector URL. Remote clients need ngrok.";
        this.item.backgroundColor = undefined;
        break;
      case "connecting":
        this.item.text = "$(sync~spin) LocalBridge: Connecting…";
        this.item.tooltip = detail ?? "Starting MCP server and ngrok tunnel…";
        this.item.backgroundColor = undefined;
        break;
      case "error":
        this.item.text = "$(error) LocalBridge: Error";
        this.item.tooltip = detail ?? "LocalBridge failed to start. Click for details.";
        this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        break;
      case "stopped":
      default:
        this.item.text = "$(circle-slash) LocalBridge: Stopped";
        this.item.tooltip = detail ?? "LocalBridge is stopped. Click to start.";
        this.item.backgroundColor = undefined;
        break;
    }
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
