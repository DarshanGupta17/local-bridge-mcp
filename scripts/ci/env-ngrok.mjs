/**
 * Maps GitHub Actions secret NGROK_AUTH_TOKEN → NGROK_AUTHTOKEN (production convention).
 * Never logs token values.
 */
export function applyNgrokCiEnv() {
  const fromActions = process.env.NGROK_AUTH_TOKEN?.trim();
  if (fromActions && !process.env.NGROK_AUTHTOKEN?.trim()) {
    process.env.NGROK_AUTHTOKEN = fromActions;
  }
  return Boolean(process.env.NGROK_AUTHTOKEN?.trim());
}

export function ngrokTokenConfigured() {
  applyNgrokCiEnv();
  return Boolean(process.env.NGROK_AUTHTOKEN?.trim());
}
