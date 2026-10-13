/**
 * Test 2a: ngrok tunnel via production startNgrokTunnel (requires NGROK_AUTH_TOKEN secret).
 */
import * as http from "node:http";
import { applyNgrokCiEnv, ngrokTokenConfigured } from "./env-ngrok.mjs";
import { createCiLogger } from "./logger.mjs";
import { fetchWithRetries } from "./http-probe.mjs";
import { skip, fail, withTimeout } from "./skip.mjs";

console.log("=== Test 2a: ngrok tunnel ===");

if (!ngrokTokenConfigured()) {
  skip("ngrok integration — NGROK_AUTH_TOKEN / NGROK_AUTHTOKEN not set (expected on fork PRs).");
}

applyNgrokCiEnv();
const authtoken = process.env.NGROK_AUTHTOKEN.trim();
const log = createCiLogger();

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("localbridge-ci-ok");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const localPort = server.address().port;

let tunnel;
try {
  const { startNgrokTunnel } = await import("../../src/ngrok/tunnel.ts");
  tunnel = await withTimeout(
    startNgrokTunnel(localPort, { authtoken }, log),
    120_000,
    "ngrok tunnel start"
  );

  const base = tunnel.publicBaseUrl;
  if (!base?.startsWith("https://")) {
    fail("ngrok did not return an HTTPS URL");
  }

  await withTimeout(
    fetchWithRetries(base, {
      attempts: 10,
      intervalMs: 3000,
      requestTimeoutMs: 25_000,
      fetchInit: { method: "GET" },
      isOk: (res) => res.ok || res.status === 404,
    }),
    90_000,
    "ngrok HTTPS probe"
  );

  console.log("ngrok tunnel reachable (HTTPS probe completed)");
  await tunnel.stop();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/authtoken|auth|401|403/i.test(msg)) {
    fail("ngrok authentication failed — check NGROK_AUTH_TOKEN secret (value not logged).");
  }
  fail(`ngrok tunnel test failed: ${msg}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("ngrok tunnel test OK");
