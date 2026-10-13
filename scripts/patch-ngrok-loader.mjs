/**
 * Patches @ngrok/ngrok isMusl() for VS Code extension host where process.report.getReport()
 * may not include .header (Linux crash). Applied at build/publish time; idempotent.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "node_modules", "@ngrok", "ngrok", "index.js");

if (!existsSync(indexPath)) {
  console.warn("[LocalBridge] @ngrok/ngrok not found; skip patch.");
  process.exit(0);
}

const MARKER = "LocalBridge: guard process.report.header";
let source = readFileSync(indexPath, "utf8");

if (source.includes(MARKER)) {
  console.log("[LocalBridge] @ngrok/ngrok loader already patched.");
  process.exit(0);
}

const oldBlock = `  } else {
    const { glibcVersionRuntime } = process.report.getReport().header
    return !glibcVersionRuntime
  }`;

const newBlock = `  } else {
    // ${MARKER}
    const report = process.report.getReport()
    if (!report || !report.header) {
      return false
    }
    const { glibcVersionRuntime } = report.header
    return !glibcVersionRuntime
  }`;

if (!source.includes(oldBlock)) {
  console.warn(
    "[LocalBridge] @ngrok/ngrok index.js format changed; patch not applied. Review upstream isMusl()."
  );
  process.exit(0);
}

source = source.replace(oldBlock, newBlock);
writeFileSync(indexPath, source, "utf8");
console.log("[LocalBridge] Patched @ngrok/ngrok isMusl() for extension host compatibility.");
