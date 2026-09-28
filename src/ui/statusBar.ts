import * as vscode from "vscode";

export type ConnectionStatus = "connected" | "local" | "connecting" | "stopped" | "error";

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "localbridge.statusMenu";
    this.setStatus("stopped");
  }

  setCommand(command: string): void {
    this.item.command = command;
  }

  setStatus(status: ConnectionStatus, detail?: string): void {
    switch (status) {
      case "connected":
        this.item.text = "$(plug) LocalBridge: Public";
        this.item.tooltip = detail
          ? `LocalBridge: Public (${detail})\nClick for options`
          : "LocalBridge is running (Public via ngrok)\nClick for options";
        this.item.backgroundColor = undefined;
        break;
      case "local":
        this.item.text = "$(plug) LocalBridge: Local";
        this.item.tooltip = detail
          ? `LocalBridge: Localhost (${detail})\nClick for options`
          : "LocalBridge is running (Localhost)\nClick for options";
        this.item.backgroundColor = undefined;
        break;
      case "connecting":
        this.item.text = "$(sync~spin) LocalBridge: Connecting…";
        this.item.tooltip = detail ?? "LocalBridge is starting…";
        this.item.backgroundColor = undefined;
        break;
      case "error":
        this.item.text = "$(error) LocalBridge: Error";
        this.item.tooltip = detail
          ? `LocalBridge: ${detail}\nClick for options`
          : "LocalBridge error\nClick for options";
        this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        break;
      case "stopped":
      default:
        this.item.text = "$(circle-slash) LocalBridge: Stopped";
        this.item.tooltip = "LocalBridge is stopped\nClick to start";
        this.item.backgroundColor = undefined;
        break;
    }
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
