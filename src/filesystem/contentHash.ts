import * as crypto from "node:crypto";

export function contentSha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function fileSnapshotSha256(content: string | undefined): string | undefined {
  if (content === undefined) {
    return undefined;
  }
  return contentSha256(content);
}

export function fileStatFingerprint(stat: { size: number; mtimeMs: number }): string {
  return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
}
