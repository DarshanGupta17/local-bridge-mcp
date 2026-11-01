/**
 * Retry HTTPS/HTTP probes — trycloudflare.com can lag after the URL is printed.
 */
import { spawnSync } from "node:child_process";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} url
 * @returns {{ ok: true; status: number } | { ok: false; error: string }}
 */
function probeUrlWithCurl(url) {
  const args = [
    "-fsS",
    "-o",
    process.platform === "win32" ? "NUL" : "/dev/null",
    "-w",
    "%{http_code}",
    "--max-time",
    "30",
    "-H",
    "User-Agent: LocalBridge-CI/1.0",
    url,
  ];
  const result = spawnSync("curl", args, { encoding: "utf8", timeout: 35_000 });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || "curl failed").trim() };
  }
  const status = Number.parseInt(String(result.stdout).trim(), 10);
  if (Number.isFinite(status) && status > 0 && status < 500) {
    return { ok: true, status };
  }
  return { ok: false, error: `HTTP ${result.stdout}` };
}

function curlAvailable() {
  const r = spawnSync("curl", ["--version"], { encoding: "utf8", timeout: 5000 });
  return r.status === 0;
}

/**
 * @param {string} url
 * @param {{
 *   attempts?: number;
 *   intervalMs?: number;
 *   requestTimeoutMs?: number;
 *   fetchInit?: RequestInit;
 *   isOk?: (response: Response) => boolean;
 * }} [options]
 */
export async function fetchWithRetries(url, options = {}) {
  const {
    attempts = 20,
    intervalMs = 3000,
    requestTimeoutMs = 25_000,
    fetchInit = {},
    isOk = (res) => res.status < 500,
  } = options;

  const useCurlFallback = process.platform !== "win32" && curlAvailable();
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      const response = await fetch(url, {
        redirect: "follow",
        ...fetchInit,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (isOk(response)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
      if (useCurlFallback) {
        const curlResult = probeUrlWithCurl(url);
        if (curlResult.ok) {
          return { status: curlResult.status, ok: curlResult.status < 500 };
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (useCurlFallback) {
        const curlResult = probeUrlWithCurl(url);
        if (curlResult.ok) {
          return { status: curlResult.status, ok: curlResult.status < 500 };
        }
        lastError = new Error(curlResult.error || lastError.message);
      }
      if (process.env.CI === "true") {
        console.log(
          `[LocalBridge-CI] probe attempt ${attempt}/${attempts} failed: ${lastError.message}`
        );
      }
    }
    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }
  throw lastError ?? new Error("fetch failed");
}
