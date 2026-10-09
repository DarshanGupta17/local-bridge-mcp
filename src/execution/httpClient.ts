import * as http from "node:http";
import * as https from "node:https";
import type { ExecutionLimits } from "../config/executionLimitsDefaults.js";
import { redactSecrets, truncateUtf8 } from "./outputRedaction.js";

const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "169.254.169.254",
]);

export interface HttpRequestInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeoutMs: number;
}

export interface HttpRequestResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  truncated: boolean;
  error: string | null;
}

export function validateLocalHttpUrl(urlString: string): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) {
    throw new Error("Destination is not allowed.");
  }

  const allowed =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".localhost");

  if (!allowed) {
    throw new Error("Only localhost URLs are allowed.");
  }

  return url;
}

export async function httpRequestLocal(
  input: HttpRequestInput,
  limits: ExecutionLimits
): Promise<HttpRequestResult> {
  const url = validateLocalHttpUrl(input.url);
  const method = input.method.toUpperCase();
  const started = Date.now();

  const safeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    const lower = k.toLowerCase();
    if (lower === "authorization" || lower === "cookie" || lower === "set-cookie") {
      continue;
    }
    safeHeaders[k] = v;
  }

  return new Promise((resolve) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method,
        headers: safeHeaders,
        timeout: input.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= limits.maxHttpResponseBytes * 2) {
            chunks.push(chunk);
          }
        });
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const truncatedResult = truncateUtf8(redactSecrets(raw), limits.maxHttpResponseBytes);
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            const lower = k.toLowerCase();
            if (lower === "set-cookie" || lower === "authorization") {
              headers[k] = "[REDACTED]";
            } else if (typeof v === "string") {
              headers[k] = v;
            } else if (Array.isArray(v)) {
              headers[k] = v.join(", ");
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: truncatedResult.text,
            durationMs: Date.now() - started,
            truncated: truncatedResult.truncated,
            error: null,
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({
        status: 0,
        headers: {},
        body: "",
        durationMs: Date.now() - started,
        truncated: false,
        error: "Request timed out.",
      });
    });

    req.on("error", (err) => {
      resolve({
        status: 0,
        headers: {},
        body: "",
        durationMs: Date.now() - started,
        truncated: false,
        error: err.message,
      });
    });

    if (input.body) {
      req.write(input.body);
    }
    req.end();
  });
}
