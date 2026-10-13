/**
 * Retry HTTPS/HTTP probes — trycloudflare.com can lag after the URL is printed.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
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
