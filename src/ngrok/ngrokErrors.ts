export function formatNgrokLoadError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const lower = raw.toLowerCase();

  if (lower.includes("reading 'header'") || lower.includes("reading 'forward'")) {
    return (
      "ngrok native module failed to load in this editor (common on Linux if platform binaries are missing). " +
      "Update LocalBridge to the latest version, or use Cloudflare quick tunnel (localbridge.public.provider = cloudflare). " +
      `Detail: ${raw}`
    );
  }

  if (
    lower.includes("cannot find module '@ngrok/ngrok-") ||
    lower.includes("cannot find module \"@ngrok/ngrok-")
  ) {
    return (
      "ngrok platform binary for this OS is missing from the extension install. " +
      "Reinstall LocalBridge from the Marketplace or VSIX built with cross-platform ngrok packages. " +
      `Detail: ${raw}`
    );
  }

  if (lower.includes("ngrok could not start")) {
    return raw;
  }

  return `ngrok could not start: ${raw}`;
}
