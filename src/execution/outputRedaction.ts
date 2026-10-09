const REDACTION_PATTERNS: RegExp[] = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,
  /\b(ghp_[a-zA-Z0-9]{20,})\b/g,
  /\b(gho_[a-zA-Z0-9]{20,})\b/g,
  /\b(xox[baprs]-[a-zA-Z0-9-]{10,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g,
  /Bearer\s+[a-zA-Z0-9._~+/=-]+/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of REDACTION_PATTERNS) {
    out = out.replace(pattern, (match) => {
      if (match.length <= 8) {
        return "[REDACTED]";
      }
      return `[REDACTED:${match.slice(0, 4)}…]`;
    });
  }
  return out;
}

export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) {
    return { text, truncated: false };
  }
  const slice = buf.subarray(0, maxBytes);
  let decoded = slice.toString("utf8");
  if (decoded.includes("\uFFFD")) {
    decoded = buf.subarray(0, maxBytes - 3).toString("utf8");
  }
  return { text: decoded + "\n… [output truncated]", truncated: true };
}
