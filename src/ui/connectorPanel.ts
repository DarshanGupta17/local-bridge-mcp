import * as vscode from "vscode";
import type { ConnectionService } from "../connectionService.js";
import { storeNgrokAuthtoken, hasNgrokAuthtokenSecure } from "../ngrok/secrets.js";
import { formatFriendlyError, type FriendlyError } from "./friendlyError.js";

export type PanelViewStep = "welcome" | "setup" | "running";

export type PublicTunnelProvider = "ngrok" | "cloudflare";

export interface ConnectorPanelState {
  workspaceName: string;
  mcpRunning: boolean;
  publicUrl?: string;
  localPort?: number;
  connectionMode?: "public" | "local";
  publicProvider?: PublicTunnelProvider;
  warning?: string;
  error?: string;
}

export { formatFriendlyError, type FriendlyError };

const PUBLIC_DIR = "public";
const BRAND_PNG = "localbridge.png";
const BRAND_ICO = "localbridge.ico";

function brandLogoImgMarkup(logoUri: string): string {
  return `<img class="brand-logo" src="${escapeHtml(logoUri)}" width="22" height="22" alt="" aria-hidden="true" />`;
}

function brandLogoLargeMarkup(logoUri: string): string {
  return `<img class="brand-logo-lg" src="${escapeHtml(logoUri)}" width="72" height="72" alt="" aria-hidden="true" />`;
}

export class ConnectorPanel implements vscode.WebviewViewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private sidebarView: vscode.WebviewView | undefined;
  private currentStep: PanelViewStep = "welcome";
  private context: vscode.ExtensionContext | undefined;
  private connectionService: ConnectionService | undefined;
  private ensureBoot: (() => Promise<void>) | undefined;
  private onSidebarOpen: (() => void | Promise<void>) | undefined;

  readonly viewType = "localbridge.sidebar";

  setLifecycleHandlers(handlers: {
    ensureBoot: () => Promise<void>;
    onSidebarOpen: () => void | Promise<void>;
  }): void {
    this.ensureBoot = handlers.ensureBoot;
    this.onSidebarOpen = handlers.onSidebarOpen;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.sidebarView = webviewView;
    webviewView.onDidDispose(() => {
      this.sidebarView = undefined;
    });

    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible || !this.context) {
        return;
      }
      this.syncSidebarViewStep(this.context);
      void this.renderHtml();
    });

    void (async () => {
      await this.ensureBoot?.();
      if (!this.context) {
        return;
      }
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, PUBLIC_DIR)],
      };
      webviewView.webview.onDidReceiveMessage((message: { command: string; [key: string]: unknown }) => {
        void this.handleWebviewMessage(message);
      });
      await this.onSidebarOpen?.();
      void this.renderHtml();
    })();
  }

  bindContext(context: vscode.ExtensionContext, connectionService: ConnectionService): void {
    this.context = context;
    this.connectionService = connectionService;
  }

  /** Sidebar open / visible: welcome until onboarding Continue; then dashboard. */
  syncSidebarViewStep(context: vscode.ExtensionContext): void {
    const hasCompletedSetup = context.globalState.get<boolean>("localbridge.hasCompletedSetup", false);
    if (!hasCompletedSetup) {
      if (this.currentStep !== "setup") {
        this.currentStep = "welcome";
      }
      return;
    }
    if (this.currentStep === "welcome") {
      this.currentStep = "running";
    }
  }

  showWelcomeInSidebar(context: vscode.ExtensionContext): void {
    this.currentStep = "welcome";
    this.syncSidebarViewStep(context);
    void this.renderHtml();
  }

  show(
    context: vscode.ExtensionContext,
    connectionService: ConnectionService,
    initialStep?: PanelViewStep
  ): void {
    this.bindContext(context, connectionService);

    const hasCompletedSetup = context.globalState.get<boolean>("localbridge.hasCompletedSetup", false);
    if (initialStep) {
      this.currentStep = initialStep;
    } else {
      this.currentStep = hasCompletedSetup ? "running" : "welcome";
    }

    if (this.panel) {
      this.panel.reveal();
      void this.renderHtml();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "localbridgeConnector",
      "LocalBridge",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, PUBLIC_DIR)],
      }
    );

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, PUBLIC_DIR, BRAND_ICO);

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage((message: { command: string; [key: string]: unknown }) => {
      void this.handleWebviewMessage(message);
    });

    context.subscriptions.push(this.panel);
    void this.renderHtml();
  }

  update(): void {
    if (!this.panel && !this.sidebarView) {
      return;
    }
    void this.renderHtml();
  }

  private getActiveWebviews(): vscode.Webview[] {
    const views: vscode.Webview[] = [];
    if (this.panel) {
      views.push(this.panel.webview);
    }
    if (this.sidebarView) {
      views.push(this.sidebarView.webview);
    }
    return views;
  }

  private async handleWebviewMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
    if (!this.connectionService || !this.context) {
      return;
    }

    switch (message.command) {
      case "getStarted":
        this.currentStep = "setup";
        await this.renderHtml();
        break;

      case "goToStep":
        if (
          message.step === "welcome" ||
          message.step === "setup" ||
          message.step === "running"
        ) {
          this.currentStep = message.step;
          await this.renderHtml();
        }
        break;

      case "saveConnection": {
        const mode = message.mode === "public" ? "public" : "local";
        const ngrokAuthtoken = typeof message.ngrokAuthtoken === "string" ? message.ngrokAuthtoken.trim() : "";
        const ngrokDomain = typeof message.ngrokDomain === "string" ? message.ngrokDomain.trim() : "";

        const config = vscode.workspace.getConfiguration("localbridge");

        // Save connection mode preference
        await config.update("ngrok.enabled", mode === "public", vscode.ConfigurationTarget.Global);

        const publicProvider =
          message.publicProvider === "cloudflare" ? "cloudflare" : "ngrok";
        if (mode === "public") {
          await config.update("public.provider", publicProvider, vscode.ConfigurationTarget.Global);
        }

        // Save ngrok credentials securely if provided
        if (ngrokAuthtoken) {
          await storeNgrokAuthtoken(this.context, ngrokAuthtoken);
        }

        // Save static domain if provided
        if (ngrokDomain !== undefined) {
          await config.update("ngrok.domain", ngrokDomain, vscode.ConfigurationTarget.Global);
        }

        // Mark setup complete
        await this.context.globalState.update("localbridge.hasCompletedSetup", true);

        // Switch to running view and start/restart connection
        this.currentStep = "running";
        await this.renderHtml();

        await this.connectionService.restart();
        await this.renderHtml();
        break;
      }

      case "copyEndpoint":
        await this.connectionService.copyConnectorUrl();
        break;

      case "copyAuthenticatedEndpoint":
        await this.connectionService.copyAuthenticatedConnectorUrl();
        break;

      case "openSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Darshangupta.localbridge");
        break;

      case "start":
        await this.connectionService.start();
        await this.renderHtml();
        break;

      case "stop":
        await this.connectionService.stop();
        await this.renderHtml();
        break;

      case "restart":
        await this.connectionService.restart();
        await this.renderHtml();
        break;

      case "changePort": {
        const config = vscode.workspace.getConfiguration("localbridge");
        const currentPort = config.get<number>("mcp.port", 0);
        const input = await vscode.window.showInputBox({
          title: "LocalBridge MCP Port",
          prompt: "Enter a port number for the local MCP server (0 = pick a free port automatically)",
          value: currentPort === 0 ? "" : String(currentPort),
          validateInput: (v) => {
            if (!v.trim() || v.trim() === "0") {
              return null;
            }
            const num = Number(v.trim());
            if (!Number.isInteger(num) || num < 1 || num > 65535) {
              return "Port must be an integer between 1 and 65535 (or 0 for automatic)";
            }
            return null;
          },
        });

        if (input !== undefined) {
          const newPort = input.trim() === "" ? 0 : parseInt(input.trim(), 10);
          await config.update("mcp.port", newPort, vscode.ConfigurationTarget.Global);
          await this.connectionService.restart();
          await this.renderHtml();
        }
        break;
      }
    }
  }

  private async renderHtml(): Promise<void> {
    if (!this.context || !this.connectionService) {
      return;
    }
    if (!this.panel && !this.sidebarView) {
      return;
    }

    const state = this.connectionService.getPanelState();
    const config = vscode.workspace.getConfiguration("localbridge");
    const ngrokEnabled = config.get<boolean>("ngrok.enabled", false);
    const publicProvider = config.get<PublicTunnelProvider>("public.provider", "ngrok");
    const ngrokDomain = config.get<string>("ngrok.domain", "");
    const hasNgrokToken = await hasNgrokAuthtokenSecure(this.context);
    const hasCompletedSetup = this.context.globalState.get<boolean>("localbridge.hasCompletedSetup", false);

    const friendlyErr = formatFriendlyError(state.error, state.localPort);

    const baseData = {
      step: this.currentStep,
      workspaceName: state.workspaceName,
      mcpRunning: state.mcpRunning,
      endpointUrl: state.publicUrl,
      localPort: state.localPort,
      connectionMode: state.connectionMode ?? (ngrokEnabled ? "public" : "local"),
      publicProvider: state.publicProvider ?? publicProvider,
      setupPublicProvider: publicProvider,
      hasNgrokToken,
      ngrokDomain,
      hasCompletedSetup,
      friendlyError: friendlyErr,
      warning: state.warning,
    };

    for (const webview of this.getActiveWebviews()) {
      const logoUri = webview
        .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, PUBLIC_DIR, BRAND_PNG))
        .toString();
      webview.html = this.generateHtml({
        ...baseData,
        logoUri,
        webviewCspSource: webview.cspSource,
      });
    }
  }

  private generateHtml(data: {
    logoUri: string;
    webviewCspSource: string;
    step: PanelViewStep;
    workspaceName: string;
    mcpRunning: boolean;
    endpointUrl?: string;
    localPort?: number;
    connectionMode: "public" | "local";
    publicProvider?: PublicTunnelProvider;
    setupPublicProvider: PublicTunnelProvider;
    hasNgrokToken: boolean;
    ngrokDomain: string;
    hasCompletedSetup: boolean;
    friendlyError?: FriendlyError;
    warning?: string;
  }): string {
    const {
      logoUri,
      webviewCspSource,
      step,
      workspaceName,
      mcpRunning,
      endpointUrl,
      localPort,
      connectionMode,
      publicProvider,
      setupPublicProvider,
      hasNgrokToken,
      ngrokDomain,
      hasCompletedSetup,
      friendlyError,
      warning,
    } = data;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webviewCspSource}; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>LocalBridge</title>
  <style>
    :root {
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      --font-size: var(--vscode-font-size, 13px);
      --editor-font: var(--vscode-editor-font-family, Menlo, Monaco, "Courier New", monospace);
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      font-family: var(--font-family);
      font-size: var(--font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      margin: 0;
      padding: 32px 20px;
      display: flex;
      justify-content: center;
      line-height: 1.5;
    }
    .wrapper {
      width: 100%;
      max-width: 480px;
    }
    .header-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }
    .header-row.with-status {
      margin-bottom: 16px;
      justify-content: space-between;
    }
    .brand-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-logo {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      display: block;
      object-fit: contain;
      border-radius: 8px;
    }
    .brand-logo-lg {
      width: 72px;
      height: 72px;
      display: block;
      object-fit: contain;
      border-radius: 16px;
    }
    .logo-wrap-lg {
      position: relative;
      display: inline-block;
      margin-bottom: 16px;
    }
    .logo-live-dot {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: #22c55e;
      box-shadow: 0 0 0 2px var(--vscode-editor-background, #1e1e1e);
    }
    /* Welcome */
    .welcome-screen {
      text-align: center;
      padding-top: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
    }
    .welcome-hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      margin-bottom: 4px;
    }
    .welcome-title {
      font-size: 1.75rem;
      font-weight: 700;
      margin: 0 0 16px 0;
      letter-spacing: -0.02em;
      display: block;
      width: 100%;
      text-align: center;
    }
    .welcome-lead {
      font-size: 15px;
      line-height: 1.45;
      color: var(--vscode-foreground);
      margin: 0 0 10px 0;
      max-width: 360px;
      margin-left: auto;
      margin-right: auto;
    }
    .welcome-sub {
      font-size: 12px;
      line-height: 1.5;
      color: var(--vscode-descriptionForeground);
      margin: 0 0 28px 0;
      max-width: 340px;
      margin-left: auto;
      margin-right: auto;
    }
    .text-accent {
      color: var(--vscode-textLink-foreground, #3794ff);
      font-weight: 600;
    }
    .feature-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 28px;
      text-align: left;
      width: 100%;
    }
    .feature-card {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 16px;
      border-radius: 10px;
      background-color: var(--vscode-sideBar-background, rgba(128, 128, 128, 0.12));
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
    }
    .feature-icon {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      color: var(--vscode-textLink-foreground, #3794ff);
    }
    .feature-icon svg {
      width: 28px;
      height: 28px;
      display: block;
    }
    .feature-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--vscode-foreground);
    }
    .feature-desc {
      font-size: 12px;
      line-height: 1.45;
      color: var(--vscode-descriptionForeground);
      margin: 0;
    }
    .welcome-footnote {
      margin: 20px 0 0 0;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.75;
    }
    .btn-block {
      width: 100%;
    }
    .btn-get-started {
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
    }
    .dashboard-divider {
      border: none;
      border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      margin: 0 0 14px 0;
    }
    .brand-title h1 {
      font-size: 1.3rem;
      font-weight: 600;
      margin: 0;
      color: var(--vscode-foreground);
      display: flex;
      align-items: center;
      line-height: 1.2;
    }
    .tagline {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      margin: 0 0 20px 0;
    }
    .text-block {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 24px;
      font-size: 13px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin: 0 0 10px 0;
    }
    /* Option Cards */
    .option-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 20px;
    }
    .option-card {
      border: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border, rgba(128,128,128,0.25)));
      border-radius: 4px;
      padding: 12px 14px;
      cursor: pointer;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background-color: transparent;
      user-select: none;
      transition: border-color 0.1s ease, background-color 0.1s ease;
    }
    .option-card:hover {
      border-color: var(--vscode-focusBorder);
    }
    .option-card:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    .option-card.selected {
      border-color: var(--vscode-focusBorder);
      background-color: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,0.08));
    }
    .option-card-nested {
      padding: 10px 12px;
    }
    .radio-circle {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 1.5px solid var(--vscode-descriptionForeground);
      margin-top: 2px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .option-card.selected .radio-circle {
      border-color: var(--vscode-focusBorder);
    }
    .option-card.selected .radio-circle::after {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--vscode-focusBorder);
    }
    .option-content {
      flex: 1;
    }
    .option-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2px;
    }
    .option-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--vscode-foreground);
    }
    .option-desc {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin: 0;
    }
    .badge-recommended {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 3px;
      background-color: var(--vscode-badge-background, rgba(128,128,128,0.2));
      color: var(--vscode-badge-foreground, var(--vscode-foreground));
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    /* ngrok form */
    .ngrok-fields {
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      border-radius: 4px;
      padding: 14px;
      margin: -6px 0 20px 0;
      background-color: var(--vscode-editor-background);
    }
    .form-group {
      margin-bottom: 12px;
    }
    .form-group:last-child {
      margin-bottom: 0;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      margin-bottom: 4px;
      color: var(--vscode-foreground);
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 6px 8px;
      font-family: var(--font-family);
      font-size: 12px;
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
    }
    input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    input:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .helper-text {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 6px;
      margin-bottom: 0;
    }
    /* Status view */
    .status-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      padding: 4px 10px 4px 8px;
      min-height: 24px;
      border-radius: 9999px;
      background-color: var(--vscode-badge-background, rgba(128,128,128,0.15));
      color: var(--vscode-badge-foreground, var(--vscode-foreground));
      user-select: none;
      box-sizing: border-box;
      vertical-align: middle;
      flex-shrink: 0;
      border: 1px solid transparent;
    }
    .status-pill--running {
      background-color: rgba(34, 197, 94, 0.12);
      border-color: rgba(34, 197, 94, 0.35);
      color: #4ade80;
    }
    .status-pill--stopped {
      background-color: rgba(128, 128, 128, 0.12);
      border-color: rgba(128, 128, 128, 0.35);
      color: var(--vscode-foreground);
    }
    .status-pill--error {
      background-color: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.35);
      color: #f87171;
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      display: block;
      margin: 0;
      padding: 0;
      /* Base fill; state classes override (theme vars are often white in webviews) */
      background-color: #6b7280;
    }
    .status-dot.running {
      background-color: #22c55e;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 0 5px rgba(34, 197, 94, 0.55);
    }
    .status-dot.stopped {
      background-color: #ef4444;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 0 4px rgba(239, 68, 68, 0.45);
    }
    .status-dot.connecting {
      background-color: #eab308;
      box-shadow: 0 0 4px rgba(234, 179, 8, 0.45);
    }
    .status-dot.error {
      background-color: #ef4444;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 0 4px rgba(239, 68, 68, 0.45);
    }
    .status-text {
      display: inline-block;
      line-height: 1;
      margin: 0;
      padding: 0;
      letter-spacing: 0.2px;
    }
    .info-list {
      margin-bottom: 20px;
    }
    .info-item {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.1));
      font-size: 13px;
    }
    .info-item:last-child {
      border-bottom: none;
    }
    .info-label {
      color: var(--vscode-descriptionForeground);
    }
    .info-value {
      font-weight: 500;
      color: var(--vscode-foreground);
    }
    .info-value.mono {
      font-family: var(--editor-font);
      font-size: 12px;
    }
    .endpoint-card {
      margin-bottom: 20px;
    }
    .endpoint-box {
      font-family: var(--editor-font);
      font-size: 12px;
      padding: 10px 12px;
      background-color: var(--vscode-input-background, rgba(0, 0, 0, 0.25));
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
      border-radius: 6px;
      word-break: break-all;
      user-select: all;
      margin: 6px 0 12px 0;
      color: var(--vscode-foreground);
    }
    .endpoint-box.muted {
      color: var(--vscode-descriptionForeground);
    }
    .btn-stack {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .btn-stack button {
      width: 100%;
      padding: 9px 14px;
      font-size: 13px;
    }
    .btn-icon {
      opacity: 0.9;
      font-size: 14px;
    }
    .control-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
    }
    .control-grid button {
      width: 100%;
      padding: 8px 10px;
      font-size: 12px;
    }
    .control-row-three {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
    }
    .control-row-three button {
      width: 100%;
      padding: 8px 6px;
      font-size: 11px;
    }
    /* Buttons */
    .button-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    button {
      padding: 6px 14px;
      font-family: inherit;
      font-size: 12px;
      border-radius: 2px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: 1px solid transparent;
      user-select: none;
      transition: background-color 0.1s ease;
    }
    button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    button.primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
    /* Alerts */
    .alert {
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 16px;
      font-size: 12px;
      line-height: 1.4;
    }
    .alert-error {
      background-color: var(--vscode-inputValidation-errorBackground, rgba(241, 76, 76, 0.15));
      border: 1px solid var(--vscode-inputValidation-errorBorder, #f14c4c);
      color: var(--vscode-errorForeground, #f14c4c);
    }
    .alert-warn {
      background-color: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.15));
      border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700);
      color: var(--vscode-editorWarning-foreground, #cca700);
    }
    .alert-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .nav-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    ${this.renderViewContent({
      logoUri,
      step,
      workspaceName,
      mcpRunning,
      endpointUrl,
      localPort,
      connectionMode,
      publicProvider,
      setupPublicProvider,
      hasNgrokToken,
      ngrokDomain,
      hasCompletedSetup,
      friendlyError,
      warning,
    })}
  </div>
  <script>
    const vscode = acquireVsCodeApi();

    function post(command, payload = {}) {
      vscode.postMessage({ command, ...payload });
    }

    let selectedMode = "${connectionMode === "public" ? "public" : "local"}";
    let selectedPublicProvider = "${setupPublicProvider === "cloudflare" ? "cloudflare" : "ngrok"}";

    function syncPublicSections() {
      const publicDetails = document.getElementById("public-details");
      const ngrokSection = document.getElementById("ngrok-section");
      const cloudflareSection = document.getElementById("cloudflare-section");
      const isPublic = selectedMode === "public";
      if (publicDetails) publicDetails.style.display = isPublic ? "block" : "none";
      if (!isPublic) return;
      const isNgrok = selectedPublicProvider === "ngrok";
      if (ngrokSection) ngrokSection.style.display = isNgrok ? "block" : "none";
      if (cloudflareSection) cloudflareSection.style.display = isNgrok ? "none" : "block";
    }

    function selectMode(mode) {
      selectedMode = mode;
      const localCard = document.getElementById("mode-local");
      const publicCard = document.getElementById("mode-public");

      if (localCard && publicCard) {
        if (mode === "local") {
          localCard.classList.add("selected");
          localCard.setAttribute("aria-checked", "true");
          publicCard.classList.remove("selected");
          publicCard.setAttribute("aria-checked", "false");
        } else {
          publicCard.classList.add("selected");
          publicCard.setAttribute("aria-checked", "true");
          localCard.classList.remove("selected");
          localCard.setAttribute("aria-checked", "false");
        }
      }
      syncPublicSections();
    }

    function selectPublicProvider(provider) {
      selectedPublicProvider = provider;
      const ngrokCard = document.getElementById("provider-ngrok");
      const cloudflareCard = document.getElementById("provider-cloudflare");
      if (ngrokCard && cloudflareCard) {
        if (provider === "ngrok") {
          ngrokCard.classList.add("selected");
          ngrokCard.setAttribute("aria-checked", "true");
          cloudflareCard.classList.remove("selected");
          cloudflareCard.setAttribute("aria-checked", "false");
        } else {
          cloudflareCard.classList.add("selected");
          cloudflareCard.setAttribute("aria-checked", "true");
          ngrokCard.classList.remove("selected");
          ngrokCard.setAttribute("aria-checked", "false");
        }
      }
      syncPublicSections();
    }

    function submitConnection() {
      const authtokenInput = document.getElementById("ngrokAuthtoken");
      const domainInput = document.getElementById("ngrokDomain");
      const authtoken = authtokenInput ? authtokenInput.value : "";
      const domain = domainInput ? domainInput.value : "";

      post("saveConnection", {
        mode: selectedMode,
        publicProvider: selectedPublicProvider,
        ngrokAuthtoken: authtoken,
        ngrokDomain: domain
      });
    }

    syncPublicSections();

    // Keyboard support for cards
    document.addEventListener("keydown", (e) => {
      const target = e.target;
      if (target && target.classList && target.classList.contains("option-card")) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          target.click();
        }
      }
    });
  </script>
</body>
</html>`;
  }

  private renderViewContent(data: {
    logoUri: string;
    step: PanelViewStep;
    workspaceName: string;
    mcpRunning: boolean;
    endpointUrl?: string;
    localPort?: number;
    connectionMode: "public" | "local";
    publicProvider?: PublicTunnelProvider;
    setupPublicProvider: PublicTunnelProvider;
    hasNgrokToken: boolean;
    ngrokDomain: string;
    hasCompletedSetup: boolean;
    friendlyError?: FriendlyError;
    warning?: string;
  }): string {
    switch (data.step) {
      case "welcome":
        return this.renderWelcomeView(data.logoUri);
      case "setup":
        return this.renderSetupView(data);
      case "running":
      default:
        return this.renderRunningView(data);
    }
  }

  private renderWelcomeView(logoUri: string): string {
    const monitorIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
    const lockIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;

    return `
      <div class="welcome-screen">
        <div class="welcome-hero">
          <div class="logo-wrap-lg">
            ${brandLogoLargeMarkup(logoUri)}
            <span class="logo-live-dot" aria-hidden="true"></span>
          </div>
          <h1 class="welcome-title">LocalBridge</h1>
        </div>
        <p class="welcome-lead">
          Connect your local codebase through <span class="text-accent">MCP</span> to online web-based AI agents.
        </p>
        <p class="welcome-sub">
          Expose tools, file context, and terminals safely to Claude, ChatGPT, and custom models in real-time.
        </p>

        <div class="feature-list">
          <div class="feature-card">
            <div class="feature-icon">${monitorIcon}</div>
            <div>
              <div class="feature-title">Instant MCP Server</div>
              <p class="feature-desc">Bridge Claude, ChatGPT, or web-based AI agents directly to your workspace.</p>
            </div>
          </div>
          <div class="feature-card">
            <div class="feature-icon">${lockIcon}</div>
            <div>
              <div class="feature-title">Secure Connectivity</div>
              <p class="feature-desc">Run safely on Localhost or expose via zero-config encrypted HTTPS tunnels.</p>
            </div>
          </div>
        </div>

        <button class="primary btn-block btn-get-started" onclick="post('getStarted')" aria-label="Get Started">
          Get Started <span aria-hidden="true">→</span>
        </button>
        <p class="welcome-footnote">Requires MCP-compatible client</p>
      </div>
    `;
  }

  private renderSetupView(data: {
    logoUri: string;
    connectionMode: "public" | "local";
    setupPublicProvider: PublicTunnelProvider;
    hasNgrokToken: boolean;
    ngrokDomain: string;
    hasCompletedSetup: boolean;
  }): string {
    const isPublic = data.connectionMode === "public";
    const isNgrok = data.setupPublicProvider !== "cloudflare";
    const tokenPlaceholder = data.hasNgrokToken
      ? "Configured in SecretStorage (leave blank to keep)"
      : "Enter your ngrok authtoken";

    return `
      <div class="header-row">
        <div class="brand-title">
          ${brandLogoImgMarkup(data.logoUri)}
          <h1>LocalBridge</h1>
        </div>
      </div>
      <p class="tagline">How do you want LocalBridge to connect?</p>

      <div class="option-group" role="radiogroup" aria-label="Connection options">
        <div
          id="mode-local"
          class="option-card ${!isPublic ? "selected" : ""}"
          onclick="selectMode('local')"
          tabindex="0"
          role="radio"
          aria-checked="${!isPublic ? "true" : "false"}"
          aria-label="Localhost option"
        >
          <div class="radio-circle"></div>
          <div class="option-content">
            <div class="option-header">
              <span class="option-title">Localhost</span>
              <span class="badge-recommended">Recommended</span>
            </div>
            <p class="option-desc">Only accessible from this computer.</p>
          </div>
        </div>

        <div
          id="mode-public"
          class="option-card ${isPublic ? "selected" : ""}"
          onclick="selectMode('public')"
          tabindex="0"
          role="radio"
          aria-checked="${isPublic ? "true" : "false"}"
          aria-label="Public connection option"
        >
          <div class="radio-circle"></div>
          <div class="option-content">
            <div class="option-header">
              <span class="option-title">Public connection</span>
            </div>
            <p class="option-desc">Expose LocalBridge through an HTTPS tunnel, available to web agents.</p>
          </div>
        </div>
      </div>

      <div id="public-details" style="display: ${isPublic ? "block" : "none"};">
        <p class="section-title" style="margin-top: 4px;">Tunnel provider</p>
        <div class="option-group" role="radiogroup" aria-label="Public tunnel provider">
          <div
            id="provider-ngrok"
            class="option-card option-card-nested ${isNgrok ? "selected" : ""}"
            onclick="selectPublicProvider('ngrok')"
            tabindex="0"
            role="radio"
            aria-checked="${isNgrok ? "true" : "false"}"
          >
            <div class="radio-circle"></div>
            <div class="option-content">
              <span class="option-title">Ngrok</span>
              <p class="option-desc">Reserved domains and production-friendly tunnels (requires ngrok account).</p>
            </div>
          </div>
          <div
            id="provider-cloudflare"
            class="option-card option-card-nested ${!isNgrok ? "selected" : ""}"
            onclick="selectPublicProvider('cloudflare')"
            tabindex="0"
            role="radio"
            aria-checked="${!isNgrok ? "true" : "false"}"
          >
            <div class="radio-circle"></div>
            <div class="option-content">
              <span class="option-title">Cloudflare quick tunnel</span>
              <p class="option-desc">Instant trycloudflare.com URL via cloudflared — no Cloudflare account.</p>
            </div>
          </div>
        </div>

        <div id="ngrok-section" class="ngrok-fields" style="display: ${isPublic && isNgrok ? "block" : "none"};">
          <div class="form-group">
            <label for="ngrokAuthtoken">ngrok Authtoken</label>
            <input
              type="password"
              id="ngrokAuthtoken"
              placeholder="${escapeHtml(tokenPlaceholder)}"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div class="form-group">
            <label for="ngrokDomain">Static Domain (optional)</label>
            <input
              type="text"
              id="ngrokDomain"
              placeholder="e.g. your-name.ngrok-free.app"
              value="${escapeHtml(data.ngrokDomain)}"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <p class="helper-text">
            ${
              data.hasNgrokToken
                ? "A token is already saved in SecretStorage. Enter a new authtoken below to replace it, or leave blank to keep the current one."
                : "Authtoken is stored in VS Code SecretStorage (not plain settings)."
            }
            Static domain is saved in settings. Without ngrok configuration, LocalBridge can still run on localhost.
          </p>
        </div>

        <div id="cloudflare-section" class="ngrok-fields" style="display: ${isPublic && !isNgrok ? "block" : "none"};">
          <p class="helper-text" style="margin-top: 0;">
            LocalBridge runs <code style="font-size: 11px;">cloudflared tunnel --url http://127.0.0.1:&lt;port&gt;</code> and uses the generated
            <strong>trycloudflare.com</strong> URL for your MCP endpoint.
          </p>
          <p class="helper-text">
            Quick tunnels are for <strong>development and testing</strong> only (200 concurrent request limit; Server-Sent Events not supported).
            Install <strong>cloudflared</strong> and ensure it is on your PATH, or set <strong>localbridge.cloudflared.path</strong> in Settings.
          </p>
        </div>
      </div>

      <div class="nav-actions">
        ${
          data.hasCompletedSetup
            ? `<button class="secondary" onclick="post('goToStep', { step: 'running' })">Cancel</button>`
            : `<button class="secondary" onclick="post('goToStep', { step: 'welcome' })">Back</button>`
        }
        <button class="primary" onclick="submitConnection()">Continue</button>
      </div>
    `;
  }

  private renderRunningView(data: {
    logoUri: string;
    workspaceName: string;
    mcpRunning: boolean;
    endpointUrl?: string;
    localPort?: number;
    connectionMode: "public" | "local";
    publicProvider?: PublicTunnelProvider;
    friendlyError?: FriendlyError;
    warning?: string;
  }): string {
    const { mcpRunning, endpointUrl, connectionMode, publicProvider, workspaceName, friendlyError, warning } =
      data;

    let statusClass = "stopped";
    let statusText = "Stopped";
    if (friendlyError) {
      statusClass = "error";
      statusText = "Error";
    } else if (mcpRunning) {
      statusClass = "running";
      statusText = "Running";
    }

    const modeLabel =
      connectionMode === "public"
        ? publicProvider === "cloudflare"
          ? "Public (Cloudflare)"
          : publicProvider === "ngrok"
            ? "Public (ngrok)"
            : "Public"
        : "Localhost";
    const displayEndpoint = endpointUrl ?? "(not running)";
    const endpointMuted = !endpointUrl;
    const pillClass =
      statusClass === "running"
        ? "status-pill--running"
        : statusClass === "error"
          ? "status-pill--error"
          : "status-pill--stopped";

    return `
      <div class="header-row with-status">
        <div class="brand-title">
          ${brandLogoImgMarkup(data.logoUri)}
          <h1>LocalBridge</h1>
        </div>
        <span class="status-pill ${pillClass}" aria-label="Status: ${statusText}"><span class="status-dot ${statusClass}"></span><span class="status-text">${statusText}</span></span>
      </div>
      <hr class="dashboard-divider" />

      ${
        friendlyError
          ? `
        <div class="alert alert-error">
          <div>${escapeHtml(friendlyError.message)}</div>
          <div class="alert-actions">
            ${
              friendlyError.type === "port"
                ? `<button class="secondary" onclick="post('changePort')">Change Port</button>`
                : ""
            }
            ${
              friendlyError.type === "ngrok" || friendlyError.type === "cloudflare"
                ? `<button class="secondary" onclick="post('openSettings')">Check Settings</button>`
                : ""
            }
            <button class="primary" onclick="post('restart')">Try Again</button>
          </div>
        </div>
      `
          : ""
      }

      ${
        warning && !friendlyError
          ? `
        <div class="alert alert-warn">
          ${escapeHtml(warning)}
        </div>
      `
          : ""
      }

      <div class="info-list">
        <div class="info-item">
          <span class="info-label">Workspace</span>
          <span class="info-value mono">${escapeHtml(workspaceName)}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Connection</span>
          <span class="info-value">${escapeHtml(modeLabel)}</span>
        </div>
      </div>

      <div class="endpoint-card">
        <div class="section-title">MCP Endpoint</div>
        <div class="endpoint-box${endpointMuted ? " muted" : ""}">${escapeHtml(displayEndpoint)}</div>
        <div class="btn-stack">
          <button class="primary" onclick="post('copyEndpoint')" ${!endpointUrl ? "disabled" : ""}>
            <span class="btn-icon" aria-hidden="true">⎘</span> Copy MCP Endpoint
          </button>
          <button class="secondary" onclick="post('copyAuthenticatedEndpoint')" ${!endpointUrl ? "disabled" : ""}>
            Copy with Token (Claude)
          </button>
        </div>
      </div>

      ${
        mcpRunning
          ? `
        <div class="control-grid">
          <button class="secondary" onclick="post('openSettings')">Open Settings</button>
          <button class="secondary" onclick="post('goToStep', { step: 'setup' })">Configure Connection</button>
          <button class="secondary" onclick="post('restart')"><span class="btn-icon" aria-hidden="true">↻</span> Restart</button>
          <button class="secondary" onclick="post('stop')"><span class="btn-icon" aria-hidden="true">■</span> Stop</button>
        </div>
      `
          : `
        <div class="control-row-three">
          <button class="secondary" onclick="post('openSettings')">Open Settings</button>
          <button class="secondary" onclick="post('goToStep', { step: 'setup' })">Configure Connection</button>
          <button class="secondary" onclick="post('start')">Start</button>
        </div>
      `
      }
    `;
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
