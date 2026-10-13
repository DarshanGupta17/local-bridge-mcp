/**
 * Test 1 (partial): compile, package VSIX, validate artifact.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { listVsixEntries } from "./list-vsix-entries.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

console.log("=== Test 1: Build and package VSIX ===");

run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "compile"]);
run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "package"]);

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const vsixPath = path.join(root, vsixName);

if (!existsSync(vsixPath)) {
  console.error(`VSIX not found: ${vsixName}`);
  process.exit(1);
}

const entries = listVsixEntries(vsixPath);
if (!entries?.length) {
  console.error("Could not list VSIX contents");
  process.exit(1);
}
const required = ["extension/package.json", "extension/dist/extension.js"];
for (const req of required) {
  if (!entries.some((e) => e === req || e.endsWith(req))) {
    console.error(`VSIX missing ${req}`);
    process.exit(1);
  }
}

console.log(`VSIX OK: ${vsixName} (${entries.length} entries)`);
