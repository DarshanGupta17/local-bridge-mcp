/**
 * Test 1 (extension host): install VSIX and verify extension is present.
 * Uses @vscode/test-electron when available.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

console.log("=== Test 1b: VS Code extension host (optional) ===");

if (process.env.CI_SKIP_VSCODE_HOST === "1") {
  console.log(">>> SKIP: VS Code extension host (CI_SKIP_VSCODE_HOST=1)");
  process.exit(0);
}

let runTests;
try {
  ({ runTests } = await import("@vscode/test-electron"));
} catch {
  console.log(">>> SKIP: @vscode/test-electron not installed");
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const vsixPath = path.join(root, `${pkg.name}-${pkg.version}.vsix`);
if (!existsSync(vsixPath)) {
  spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "package"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

const extensionDevelopmentPath = root;
const extensionTestsPath = path.join(root, "scripts", "ci", "vscode", "suite.test.mjs");

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ["--disable-extensions"],
  });
  console.log("VS Code extension host test OK");
} catch (err) {
  console.error("VS Code extension host test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
