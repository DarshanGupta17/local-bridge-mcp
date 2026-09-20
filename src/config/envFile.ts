import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Loads KEY=VALUE lines into process.env (does not override existing vars).
 */
export function loadEnvFileIntoProcess(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

/** Dev `.env` lives next to the extension (not the opened workspace folder). */
export function loadExtensionDevEnv(extensionPath: string, log?: (msg: string) => void): void {
  const envPath = path.join(extensionPath, ".vscode", ".env");
  if (loadEnvFileIntoProcess(envPath)) {
    log?.(`Loaded environment from ${envPath}`);
  }
}
