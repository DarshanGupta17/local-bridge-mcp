import * as path from "node:path";

const SAMPLE = 8192;

export function isLikelyBinaryBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, SAMPLE));
  if (sample.includes(0)) {
    return true;
  }
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) {
      suspicious++;
    }
  }
  return suspicious / Math.max(sample.length, 1) > 0.3;
}

export function detectMimeHint(relativePath: string): string | undefined {
  const ext = path.extname(relativePath).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".wasm": "application/wasm",
  };
  return map[ext];
}
