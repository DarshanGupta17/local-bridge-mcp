import * as vscode from "vscode";
import { resolveNgrokAuthtoken as resolveFromEnvAndSetting } from "./config.js";

const NGROK_SECRET_KEY = "localbridge.ngrok.authtoken";

/** Plaintext setting is legacy; secrets are authoritative once set. */
export async function clearLegacyNgrokAuthtokenSetting(): Promise<void> {
  const config = vscode.workspace.getConfiguration("localbridge");
  if (config.get<string>("ngrok.authtoken", "").trim()) {
    await config.update("ngrok.authtoken", undefined, vscode.ConfigurationTarget.Global);
  }
}

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
    await clearLegacyNgrokAuthtokenSetting();
  }
  return legacy;
}

export async function storeNgrokAuthtoken(
  context: vscode.ExtensionContext,
  token: string
): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    return;
  }
  // Replace prior value (VS Code usually overwrites; delete avoids stale reads on some hosts).
  await context.secrets.delete(NGROK_SECRET_KEY);
  await context.secrets.store(NGROK_SECRET_KEY, trimmed);
  await clearLegacyNgrokAuthtokenSetting();
}

export async function clearNgrokAuthtoken(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(NGROK_SECRET_KEY);
  await clearLegacyNgrokAuthtokenSetting();
}

export async function hasNgrokAuthtokenSecure(
  context: vscode.ExtensionContext,
  settingValue?: string
): Promise<boolean> {
  const token = await resolveNgrokAuthtokenSecure(context, settingValue ?? "");
  return Boolean(token?.trim());
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
