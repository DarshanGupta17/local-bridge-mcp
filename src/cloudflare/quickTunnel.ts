import { spawn, type ChildProcess } from "node:child_process";
import type { Logger } from "../logger.js";
import type { PublicTunnelHandle } from "../tunnel/types.js";

const TRY_CLOUDFLARE_URL =
  /https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?/gi;

const START_TIMEOUT_MS = 120_000;
/** trycloudflare.com often rejects the first requests right after connector registration. */
const EDGE_PROPAGATION_MS = 6_000;
const REGISTERED_CONNECTION_RE = /Registered tunnel connection/i;
const METRICS_SERVER_RE =
  /Starting metrics server on ([\d.]+):(\d+)(?:\/metrics)?/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killProcess(proc: ChildProcess): void {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    // ignore
  }
}

async function metricsReady(host: string, port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/ready`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as { readyConnections?: number };
    return (body.readyConnections ?? 0) >= 1;
  } catch {
    return false;
  }
}

async function waitForTunnelReady(
  host: string,
  port: number,
  deadlineMs: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (await metricsReady(host, port)) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

export async function startCloudflareQuickTunnel(
  localPort: number,
  log: Logger,
  cloudflaredPath?: string
): Promise<PublicTunnelHandle> {
  const bin = cloudflaredPath?.trim() || "cloudflared";
  const localUrl = `http://127.0.0.1:${localPort}`;

  return new Promise((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawn(bin, ["tunnel", "--url", localUrl, "--no-autoupdate"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      reject(
        new Error(
          `Could not start cloudflared: ${message}. Install cloudflared and ensure it is on PATH, or set localbridge.cloudflared.path.`
        )
      );
      return;
    }

    let settled = false;
    let buffer = "";
    let pendingPublicBaseUrl: string | undefined;
    let sawRegisteredConnection = false;
    let readinessPollStarted = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        killProcess(proc);
        reject(
          new Error(
            "Timed out waiting for Cloudflare quick tunnel to become ready. Is cloudflared installed?"
          )
        );
      }
    }, START_TIMEOUT_MS);

    const finishReady = (publicBaseUrl: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      void (async () => {
        await sleep(EDGE_PROPAGATION_MS);
        const connectorUrl = `${publicBaseUrl}/mcp`;
        log.info("Cloudflare quick tunnel started");
        log.info(`Public URL: ${connectorUrl}`);

        resolve({
          connectorUrl,
          provider: "cloudflare",
          async stop() {
            killProcess(proc);
            log.info("Cloudflare quick tunnel stopped");
          },
        });
      })();
    };

    const tryFinish = () => {
      if (!pendingPublicBaseUrl || settled) {
        return;
      }
      if (sawRegisteredConnection) {
        finishReady(pendingPublicBaseUrl);
      }
    };

    const startReadinessPoll = (host: string, port: number) => {
      if (readinessPollStarted || settled) {
        return;
      }
      readinessPollStarted = true;
      void (async () => {
        const ready = await waitForTunnelReady(host, port, 90_000);
        if (ready && pendingPublicBaseUrl && !settled) {
          finishReady(pendingPublicBaseUrl);
        }
      })();
    };

    const noteUrl = (rawUrl: string) => {
      pendingPublicBaseUrl = rawUrl.replace(/\/$/, "");
      tryFinish();
    };

    const scan = (text: string) => {
      buffer += text;
      if (!sawRegisteredConnection && REGISTERED_CONNECTION_RE.test(buffer)) {
        sawRegisteredConnection = true;
        tryFinish();
      }

      if (!readinessPollStarted) {
        const metricsMatch = METRICS_SERVER_RE.exec(buffer);
        if (metricsMatch) {
          startReadinessPoll(metricsMatch[1], Number(metricsMatch[2]));
        }
      }

      const matches = buffer.match(TRY_CLOUDFLARE_URL);
      if (matches?.[0]) {
        noteUrl(matches[0]);
      }
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      for (const part of line.split(/\r?\n/)) {
        const trimmed = part.trim();
        if (trimmed) {
          log.info(`cloudflared: ${trimmed}`);
        }
      }
      scan(line);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      for (const part of line.split(/\r?\n/)) {
        const trimmed = part.trim();
        if (trimmed) {
          log.info(`cloudflared: ${trimmed}`);
        }
      }
      scan(line);
    });

    proc.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `cloudflared not found (${err.message}). Install from Cloudflare docs or set localbridge.cloudflared.path.`
        )
      );
    });

    proc.on("exit", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `cloudflared exited before a trycloudflare.com URL was ready (code=${code ?? "null"}, signal=${signal ?? "null"})`
        )
      );
    });
  });
}
