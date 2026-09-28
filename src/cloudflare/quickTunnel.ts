import { spawn, type ChildProcess } from "node:child_process";
import type { Logger } from "../logger.js";
import type { PublicTunnelHandle } from "../tunnel/types.js";

const TRY_CLOUDFLARE_URL =
  /https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?/gi;

const START_TIMEOUT_MS = 90_000;

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
      proc = spawn(bin, ["tunnel", "--url", localUrl], {
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

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        killProcess(proc);
        reject(
          new Error(
            "Timed out waiting for a Cloudflare quick tunnel URL. Is cloudflared installed?"
          )
        );
      }
    }, START_TIMEOUT_MS);

    const finishWithUrl = (rawUrl: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const publicBaseUrl = rawUrl.replace(/\/$/, "");
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
    };

    const scan = (text: string) => {
      buffer += text;
      const matches = buffer.match(TRY_CLOUDFLARE_URL);
      if (matches?.[0]) {
        finishWithUrl(matches[0]);
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
