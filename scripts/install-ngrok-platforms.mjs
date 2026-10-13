/**
 * Installs all @ngrok/ngrok optional native packages for VSIX packaging.
 * npm only installs optional deps for the current OS; Marketplace users need every platform.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "scripts", "ngrok-platform-packages.json"), "utf8")
);
const { version, packages } = manifest;
const specs = packages.map((name) => `${name}@${version}`);

console.log(`[LocalBridge] Installing ${specs.length} ngrok platform packages @ ${version}…`);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  npmCmd,
  [
    "install",
    "--force",
    "--no-save",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    ...specs,
  ],
  { cwd: root, stdio: "inherit", env: process.env, shell: process.platform === "win32" }
);

if (result.status !== 0) {
  console.error("[LocalBridge] Failed to install ngrok platform packages.");
  process.exit(result.status ?? 1);
}

console.log("[LocalBridge] ngrok platform packages installed.");
