import type * as vscode from "vscode";
import { resolveNgrokAuthtoken as resolveFromEnvAndSetting } from "./config.js";

const NGROK_SECRET_KEY = "localbridge.ngrok.authtoken";

export async function resolveNgrokAuthtokenSecure(
  context: vscode.ExtensionContext,
  settingValue: string
): Promise<string | undefined> {
  const fromSecret = (await context.secrets.get(NGROK_SECRET_KEY))?.trim();
  if (fromSecret) {
    return fromSecret;
  }
  const legacy = resolveFromEnvAndSetting(settingValue);
  if (legacy) {
    await context.secrets.store(NGROK_SECRET_KEY, legacy);
  }
  return legacy;
}

export async function storeNgrokAuthtoken(
  context: vscode.ExtensionContext,
  token: string
): Promise<void> {
  await context.secrets.store(NGROK_SECRET_KEY, token.trim());
}

export async function clearNgrokAuthtoken(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(NGROK_SECRET_KEY);
}

export function ngrokAuthtokenSource(
  context: vscode.ExtensionContext,
  config: vscode.WorkspaceConfiguration
): string {
  void context;
  if (config.get<string>("ngrok.authtoken", "").trim()) {
    return "VS Code setting (migrated to SecretStorage on use)";
  }
  if (process.env.NGROK_AUTHTOKEN?.trim()) {
    return "NGROK_AUTHTOKEN environment variable (migrated to SecretStorage on use)";
  }
  return "SecretStorage";
}
