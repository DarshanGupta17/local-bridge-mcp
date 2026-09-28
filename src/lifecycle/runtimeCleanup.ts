import * as vscode from "vscode";
import { clearNgrokAuthtoken } from "../ngrok/secrets.js";

const GLOBAL_STATE_KEYS = ["localbridge.hasCompletedSetup"] as const;

/** Clears secrets and onboarding flags while the extension is still loaded (e.g. reset command). */
export async function clearPersistedExtensionData(context: vscode.ExtensionContext): Promise<void> {
  await clearNgrokAuthtoken(context);
  await context.secrets.delete("localbridge.mcp.authToken");
  await context.secrets.delete("repobridge.mcp.authToken");

  for (const key of GLOBAL_STATE_KEYS) {
    await context.globalState.update(key, undefined);
  }

  const config = vscode.workspace.getConfiguration("localbridge");
  const keys = [
    "ngrok.authtoken",
    "ngrok.domain",
    "ngrok.enabled",
    "public.provider",
  ] as const;
  for (const key of keys) {
    await config.update(key, undefined, vscode.ConfigurationTarget.Global);
  }
}
