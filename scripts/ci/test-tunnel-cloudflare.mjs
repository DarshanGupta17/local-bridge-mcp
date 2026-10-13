/**
 * Test 2b: Cloudflare quick tunnel via production startCloudflareQuickTunnel.
 */
import * as http from "node:http";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createCiLogger } from "./logger.mjs";
import { fail, withTimeout, skip } from "./skip.mjs";

console.log("=== Test 2b: Cloudflare quick tunnel ===");

const require = createRequire(import.meta.url);

async function resolveCloudflaredBin() {
  try {
    const { bin, install, CLOUDFLARED_VERSION } = require("cloudflared/lib/lib.js");
    const fs = require("node:fs");
    if (!fs.existsSync(bin)) {
      console.log("[CI] Installing cloudflared binary via npm cloudflared package…");
      await install(bin, CLOUDFLARED_VERSION);
    }
    return bin;
  } catch {
    return "cloudflared";
  }
}

const cloudflaredPath = await resolveCloudflaredBin();
const check = spawnSync(cloudflaredPath, ["--version"], { encoding: "utf8", timeout: 15_000 });
if (check.status !== 0) {
  skip(
    "Cloudflare quick tunnel — cloudflared binary not available on this runner (install failed or blocked)."
  );
}

const log = createCiLogger();
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("localbridge-ci-ok");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const localPort = server.address().port;

let tunnel;
try {
  const { startCloudflareQuickTunnel } = await import("../../src/cloudflare/quickTunnel.ts");
  tunnel = await withTimeout(
    startCloudflareQuickTunnel(localPort, log, cloudflaredPath),
    120_000,
    "Cloudflare quick tunnel start"
  );

  const url = tunnel.connectorUrl.replace(/\/mcp$/, "");
  const probe = await withTimeout(fetch(url, { redirect: "follow" }), 45_000, "trycloudflare probe");
  if (probe.status >= 500) {
    fail(`Cloudflare tunnel probe failed: HTTP ${probe.status}`);
  }

  console.log("Cloudflare quick tunnel reachable");
  await tunnel.stop();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/network|timed out|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    skip(`Cloudflare quick tunnel unavailable on runner: ${msg}`);
  }
  fail(`Cloudflare tunnel test failed: ${msg}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("Cloudflare quick tunnel test OK");
