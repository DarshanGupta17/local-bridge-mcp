/**
 * Removes ngrok platform packages not shipped in the VSIX (saves ~50MB+ if present locally).
 */
import { readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "scripts", "ngrok-platform-packages.json"), "utf8")
);
const excluded = manifest.excludedFromVsix ?? [];

for (const pkg of excluded) {
  const dir = path.join(root, "node_modules", pkg);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`[LocalBridge] Removed ${pkg} (not bundled in VSIX)`);
  }
}
