/**
 * Cross-platform CI orchestrator (seven test categories).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const osLabel = `${process.platform}-${process.arch}`;

function runStep(name, cmd, args, env = {}) {
  console.log(`\n========== [${osLabel}] ${name} ==========\n`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    console.error(`\n>>> FAIL: ${name} (exit ${r.status ?? 1})\n`);
    process.exit(r.status ?? 1);
  }
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

console.log(`LocalBridge CI — ${osLabel}`);

runStep("Test 3–5,7 unit+integration (headless)", npm, ["test"]);
runStep("Test 3–5,7 CI integration suite", npx, [
  "tsx",
  "--test",
  "scripts/ci/ci.integration.test.ts",
  "scripts/ci/mcp-http.integration.test.ts",
]);

runStep("Test 1 build VSIX", "node", ["scripts/ci/test-build-vsix.mjs"]);

if (process.env.CI === "true") {
  runStep("Test 1b VS Code extension host", "node", ["scripts/ci/vscode-extension.test.mjs"]);
} else {
  console.log("\n>>> SKIP: Test 1b VS Code extension host (set CI=true on GitHub Actions)\n");
}

runStep("Test 2a ngrok tunnel", "npx", ["tsx", "scripts/ci/test-tunnel-ngrok.mjs"]);
runStep("Test 2b Cloudflare quick tunnel", "npx", ["tsx", "scripts/ci/test-tunnel-cloudflare.mjs"]);

console.log(`\nLocalBridge CI completed successfully on ${osLabel}\n`);
