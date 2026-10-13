import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "scripts", "ngrok-platform-packages.json"), "utf8")
);

const missing = [];
for (const pkg of manifest.packages) {
  const dir = path.join(root, "node_modules", pkg);
  if (!existsSync(dir)) {
    missing.push(pkg);
  }
}

const ngrokIndex = path.join(root, "node_modules", "@ngrok", "ngrok", "index.js");
if (existsSync(ngrokIndex)) {
  const src = readFileSync(ngrokIndex, "utf8");
  if (!src.includes("LocalBridge: guard process.report.header")) {
    console.warn("[LocalBridge] Warning: @ngrok/ngrok loader patch not applied.");
  }
}

if (missing.length) {
  console.error("[LocalBridge] Missing ngrok platform packages (run npm run ngrok:platforms):");
  for (const m of missing) {
    console.error(`  - ${m}`);
  }
  process.exit(1);
}

console.log(`[LocalBridge] Verified ${manifest.packages.length} ngrok platform packages.`);
