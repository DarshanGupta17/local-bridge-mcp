import * as vscode from "vscode";
import { Logger } from "./logger.js";
import { startMcpHttpServer, type McpHttpServerHandle } from "./mcp/server.js";
import {
  authtokenSource,
  resolveNgrokAuthtoken,
  resolveNgrokStaticDomain,
  staticDomainSource,
} from "./ngrok/config.js";
import { startNgrokTunnel, type NgrokTunnelHandle } from "./ngrok/tunnel.js";
import { WorkspaceFilesystem, workspaceFolderName } from "./workspace/filesystem.js";
import { StatusBarController } from "./ui/statusBar.js";
import { ConnectorPanel, type ConnectorPanelState } from "./ui/connectorPanel.js";

const SETUP_DOCS_URL =
  "https://ngrok.com/docs/guides/other-guides/using-ngrok-with-vs-code/#install-ngrok";

export type ConnectionMode = "public" | "local";

export class ConnectionService {
  private readonly log: Logger;
  private readonly statusBar: StatusBarController;
  private readonly panel: ConnectorPanel;
  private readonly context: vscode.ExtensionContext;

  private mcp: McpHttpServerHandle | undefined;
  private tunnel: NgrokTunnelHandle | undefined;
  private fsApi: WorkspaceFilesystem | undefined;
  private connectorUrl: string | undefined;
  private localConnectorUrl: string | undefined;
  private connectionMode: ConnectionMode | undefined;
  private lastError: string | undefined;
  private lastWarning: string | undefined;
  private starting = false;

  constructor(context: vscode.ExtensionContext, statusBar: StatusBarController, panel: ConnectorPanel) {
    this.context = context;
    this.log = new Logger("RepoBridge");
    this.statusBar = statusBar;
    this.panel = panel;
    context.subscriptions.push(this.log);
  }

  getPublicConnectorUrl(): string | undefined {
    return this.connectorUrl;
  }

  getLocalConnectorUrl(): string | undefined {
    return this.localConnectorUrl;
  }

  getPanelState(): ConnectorPanelState {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return {
      workspaceName: folder ? workspaceFolderName(folder.uri.fsPath) : "(no workspace)",
      mcpRunning: Boolean(this.mcp),
      publicUrl: this.connectorUrl,
      localPort: this.mcp?.port,
      connectionMode: this.connectionMode,
      warning: this.lastWarning,
      error: this.lastError,
    };
  }

  showConnectorPanel(): void {
    this.panel.show(this.context, this.getPanelState());
  }

  async openLocalConnector(): Promise<void> {
    const url = this.localConnectorUrl ?? this.connectorUrl;
    if (!url) {
      vscode.window.showWarningMessage("RepoBridge is not running. Start RepoBridge first.");
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async start(): Promise<void> {
    if (this.starting) {
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.lastError = "RepoBridge requires an opened folder/workspace.";
      vscode.window.showErrorMessage(this.lastError);
      this.statusBar.setStatus("error", this.lastError);
      return;
    }

    this.starting = true;
    this.lastError = undefined;
    this.lastWarning = undefined;
    this.statusBar.setStatus("connecting");
    this.log.show(true);

    try {
      await this.stopInternal();

      const config = vscode.workspace.getConfiguration("repobridge");
      const ngrokEnabled = config.get<boolean>("ngrok.enabled", true);
      const authtoken = resolveNgrokAuthtoken(config.get<string>("ngrok.authtoken", ""));

      this.log.info("RepoBridge starting…");
      if (authtoken) {
        this.log.info(`Authtoken: configured (${authtokenSource(config)})`);
      } else {
        this.log.info("Authtoken: not set — will use localhost MCP URL only");
      }

      this.fsApi = await WorkspaceFilesystem.create(folder.uri.fsPath);
      const preferredPort = config.get<number>("mcp.port", 0);

      this.mcp = await startMcpHttpServer(this.fsApi, this.log, preferredPort);
      this.localConnectorUrl = `http://127.0.0.1:${this.mcp.port}/mcp`;
      this.log.info(`Local MCP connector: ${this.localConnectorUrl}`);

      let usedNgrok = false;
      if (ngrokEnabled && authtoken) {
        const staticDomain = resolveNgrokStaticDomain(config.get<string>("ngrok.domain", ""));
        if (staticDomain) {
          this.log.info(`Static domain: configured (${staticDomainSource(config)}) → ${staticDomain}`);
        }

        try {
          this.tunnel = await startNgrokTunnel(
            this.mcp.port,
            { authtoken, staticDomain },
            this.log
          );
          this.connectorUrl = this.tunnel.connectorUrl;
          this.connectionMode = "public";
          usedNgrok = true;

          if (staticDomain && this.tunnel.domainMode === "ephemeral") {
            this.lastWarning =
              `Could not bind ngrok static domain "${staticDomain}". Using ephemeral URL instead.`;
            this.log.info(this.lastWarning);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.lastWarning = `ngrok failed: ${message}. Using localhost MCP URL.`;
          this.log.error(this.lastWarning);
        }
      } else if (ngrokEnabled && !authtoken) {
        this.lastWarning =
          "ngrok authtoken not found. MCP is available on localhost only. " +
          "Set repobridge.ngrok.authtoken, NGROK_AUTHTOKEN, or .vscode/.env in the extension folder.";
        this.log.info(this.lastWarning);
      }

      if (!usedNgrok) {
        this.connectorUrl = this.localConnectorUrl;
        this.connectionMode = "local";
      }

      this.applyConnectedUi(usedNgrok);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      this.log.error(message);
      await this.stopInternal();
      this.statusBar.setStatus("error", message);
      vscode.window.showErrorMessage(`RepoBridge failed to start: ${message}`);
    } finally {
      this.starting = false;
    }
  }

  private applyConnectedUi(publicNgrok: boolean): void {
    const url = this.connectorUrl!;
    if (publicNgrok) {
      this.statusBar.setStatus("connected", url);
    } else {
      this.statusBar.setStatus("local", url);
    }
    this.panel.update(this.getPanelState());

    const headline = publicNgrok
      ? `RepoBridge connected (public): ${url}`
      : `RepoBridge running locally: ${url}`;

    const actions = publicNgrok
      ? ["Copy URL", "Show panel", "Open local URL"]
      : ["Copy URL", "Show panel", "Open in browser", "ngrok setup"];

    vscode.window.showInformationMessage(headline, ...actions).then((choice) => {
      if (choice === "Copy URL") {
        void this.copyConnectorUrl();
      } else if (choice === "Show panel") {
        this.showConnectorPanel();
      } else if (choice === "Open in browser" || choice === "Open local URL") {
        void this.openLocalConnector();
      } else if (choice === "ngrok setup") {
        void vscode.env.openExternal(vscode.Uri.parse(SETUP_DOCS_URL));
      }
    });

    if (this.lastWarning) {
      vscode.window.showWarningMessage(this.lastWarning, "Open ngrok docs").then((c) => {
        if (c === "Open ngrok docs") {
          void vscode.env.openExternal(vscode.Uri.parse(SETUP_DOCS_URL));
        }
      });
    }
  }

  async stop(): Promise<void> {
    await this.stopInternal();
    this.connectorUrl = undefined;
    this.localConnectorUrl = undefined;
    this.connectionMode = undefined;
    this.lastError = undefined;
    this.lastWarning = undefined;
    this.statusBar.setStatus("stopped");
    this.panel.update(this.getPanelState());
    this.log.info("RepoBridge stopped by user");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async copyConnectorUrl(): Promise<void> {
    if (!this.connectorUrl) {
      vscode.window.showWarningMessage("RepoBridge is not connected. Start RepoBridge first.");
      return;
    }
    await vscode.env.clipboard.writeText(this.connectorUrl);
    vscode.window.showInformationMessage("RepoBridge connector URL copied to clipboard.");
  }

  async dispose(): Promise<void> {
    await this.stopInternal();
  }

  private async stopInternal(): Promise<void> {
    if (this.tunnel) {
      await this.tunnel.stop();
      this.tunnel = undefined;
    }
    if (this.mcp) {
      await this.mcp.stop();
      this.mcp = undefined;
    }
    this.fsApi = undefined;
  }
}
