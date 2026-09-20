import * as vscode from "vscode";
import { Logger } from "./logger.js";
import { startMcpHttpServer, type McpHttpServerHandle } from "./mcp/server.js";
import { resolveNgrokStaticDomain, staticDomainSource } from "./ngrok/config.js";
import { ngrokAuthtokenSource, resolveNgrokAuthtokenSecure } from "./ngrok/secrets.js";
import { startNgrokTunnel, type NgrokTunnelHandle } from "./ngrok/tunnel.js";
import { workspaceFolderName } from "./workspace/filesystem.js";
import { StatusBarController } from "./ui/statusBar.js";
import { ConnectorPanel, type ConnectorPanelState } from "./ui/connectorPanel.js";
import type { AppServices } from "./core/appServices.js";
import { appendTokenToMcpUrl } from "./auth/authenticationManager.js";

const SETUP_DOCS_URL =
  "https://ngrok.com/docs/guides/other-guides/using-ngrok-with-vs-code/#install-ngrok";

export type ConnectionMode = "public" | "local";

export class ConnectionService {
  private readonly log: Logger;
  private readonly statusBar: StatusBarController;
  private readonly panel: ConnectorPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly services: AppServices;

  private mcp: McpHttpServerHandle | undefined;
  private tunnel: NgrokTunnelHandle | undefined;
  private connectorUrl: string | undefined;
  private localConnectorUrl: string | undefined;
  private connectionMode: ConnectionMode | undefined;
  private lastError: string | undefined;
  private lastWarning: string | undefined;
  private starting = false;

  constructor(
    context: vscode.ExtensionContext,
    services: AppServices,
    statusBar: StatusBarController,
    panel: ConnectorPanel
  ) {
    this.context = context;
    this.services = services;
    this.log = new Logger("LocalBridge");
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
    const folders = vscode.workspace.workspaceFolders ?? [];
    const workspaceName =
      folders.length === 0
        ? "(no workspace)"
        : folders.map((f) => workspaceFolderName(f.uri.fsPath)).join(", ");
    return {
      workspaceName,
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
      vscode.window.showWarningMessage("LocalBridge is not running. Start LocalBridge first.");
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async start(): Promise<void> {
    if (this.starting) {
      return;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      this.lastError = "LocalBridge requires an opened folder/workspace.";
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
      this.services.refreshConfig();
      await this.services.auth.ensureToken();
      await this.services.bindWorkspace(folders);

      const config = vscode.workspace.getConfiguration("localbridge");
      const ngrokEnabled = config.get<boolean>("ngrok.enabled", true);
      const authtoken = await resolveNgrokAuthtokenSecure(
        this.context,
        config.get<string>("ngrok.authtoken", "")
      );

      this.log.info("LocalBridge starting…");
      if (authtoken) {
        this.log.info(`ngrok authtoken: configured (${ngrokAuthtokenSource(this.context, config)})`);
      } else {
        this.log.info("ngrok authtoken: not set — will use localhost MCP URL only");
      }

      const preferredPort = config.get<number>("mcp.port", 0);

      const requireAuth = config.get<boolean>("mcp.requireAuth", true);

      this.mcp = await startMcpHttpServer({
        services: this.services,
        log: this.log,
        preferredPort,
        auth: this.services.auth,
        requireAuth,
      });
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
          "Use LocalBridge: Configure ngrok or set NGROK_AUTHTOKEN.";
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
      vscode.window.showErrorMessage(`LocalBridge failed to start: ${message}`);
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
      ? `LocalBridge connected (public): ${url}`
      : `LocalBridge running locally: ${url}`;

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
    this.log.info("LocalBridge stopped by user");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async copyConnectorUrl(): Promise<void> {
    if (!this.connectorUrl) {
      vscode.window.showWarningMessage("LocalBridge is not connected. Start LocalBridge first.");
      return;
    }
    await vscode.env.clipboard.writeText(this.connectorUrl);
    vscode.window.showInformationMessage("LocalBridge connector URL copied to clipboard.");
  }

  /** Full MCP URL with access_token query param (for Claude and other URL-only connectors). */
  async copyAuthenticatedConnectorUrl(): Promise<void> {
    if (!this.connectorUrl) {
      vscode.window.showWarningMessage("LocalBridge is not connected. Start LocalBridge first.");
      return;
    }
    const token = await this.services.auth.getToken();
    if (!token) {
      vscode.window.showWarningMessage("LocalBridge authentication token is not available.");
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      "This copies your MCP URL with the access token in the query string. Anyone with the URL can use LocalBridge. Paste only into trusted clients (e.g. Claude). Continue?",
      { modal: true },
      "Copy URL"
    );
    if (confirm !== "Copy URL") {
      return;
    }
    const authedUrl = appendTokenToMcpUrl(this.connectorUrl, token);
    await vscode.env.clipboard.writeText(authedUrl);
    vscode.window.showInformationMessage(
      "Authenticated connector URL copied. In Claude, use Authentication: No sign-in and paste this full URL."
    );
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
  }
}
