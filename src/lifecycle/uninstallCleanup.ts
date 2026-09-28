import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Must match package.json publisher.name */
export const EXTENSION_ID = "localbridge.localbridge";

const SECRET_KEY_PREFIXES = [
  `secret://${EXTENSION_ID}/localbridge.`,
  `secret://${EXTENSION_ID}/repobridge.`,
];

const SETTING_PREFIX = "localbridge.";

function existingUserDataRoots(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];

  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "Cursor", "User"));
    candidates.push(path.join(process.env.APPDATA, "Code", "User"));
  }
  candidates.push(path.join(home, ".cursor", "User"));
  candidates.push(path.join(home, ".config", "Cursor", "User"));
  candidates.push(path.join(home, ".config", "Code", "User"));

  return [...new Set(candidates)].filter((dir) => fs.existsSync(dir));
}

function removeExtensionGlobalStorage(userRoot: string): void {
  const dir = path.join(userRoot, "globalStorage", EXTENSION_ID);
  fs.rmSync(dir, { recursive: true, force: true });
}

function pruneLocalBridgeSettings(settingsPath: string): void {
  if (!fs.existsSync(settingsPath)) {
    return;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch {
    return;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  let changed = false;
  for (const key of Object.keys(parsed)) {
    if (key.startsWith(SETTING_PREFIX)) {
      delete parsed[key];
      changed = true;
    }
  }
  if (!changed) {
    return;
  }
  fs.writeFileSync(settingsPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function pruneStateDb(dbPath: string): Promise<void> {
  if (!fs.existsSync(dbPath)) {
    return;
  }
  try {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);
    const result = db.exec("SELECT key FROM ItemTable");
    const keys: string[] = [];
    if (result[0]?.values) {
      for (const row of result[0].values) {
        const key = row[0];
        if (typeof key === "string") {
          keys.push(key);
        }
      }
    }
    const keysToDelete = keys.filter(
      (key) =>
        SECRET_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
        key.includes("localbridge.hasCompletedSetup") ||
        key.startsWith(`${EXTENSION_ID}:`)
    );
    for (const key of keysToDelete) {
      db.run("DELETE FROM ItemTable WHERE key = ?", [key]);
    }
    if (keysToDelete.length > 0) {
      const out = db.export();
      fs.writeFileSync(dbPath, Buffer.from(out));
    }
    db.close();
  } catch {
    // state.vscdb may be locked or format may differ
  }
}

/** Runs on extension uninstall (Node script, no VS Code API). */
export async function runExtensionUninstallCleanup(): Promise<void> {
  for (const userRoot of existingUserDataRoots()) {
    removeExtensionGlobalStorage(userRoot);
    pruneLocalBridgeSettings(path.join(userRoot, "settings.json"));
    await pruneStateDb(path.join(userRoot, "globalStorage", "state.vscdb"));
  }
}
