export interface FriendlyError {
  type: "port" | "ngrok" | "cloudflare" | "generic";
  message: string;
  port?: number;
}

export function formatFriendlyError(error: string | undefined, defaultPort?: number): FriendlyError | undefined {
  if (!error) {
    return undefined;
  }
  const lower = error.toLowerCase();
  if (
    lower.includes("eaddrinuse") ||
    lower.includes("already being used") ||
    lower.includes("address already in use")
  ) {
    const portMatch = error.match(/:(\d+)/) || error.match(/port\s+(\d+)/i);
    const port = portMatch ? parseInt(portMatch[1], 10) : defaultPort;
    return {
      type: "port",
      message: port
        ? `Port ${port} is already being used by another application.`
        : "The configured port is already being used by another application.",
      port,
    };
  }
  if (lower.includes("cloudflared") || lower.includes("trycloudflare")) {
    return {
      type: "cloudflare",
      message: "LocalBridge couldn't establish the Cloudflare quick tunnel.",
    };
  }
  if (
    lower.includes("ngrok") ||
    (lower.includes("authtoken") && !lower.includes("cloudflare"))
  ) {
    return {
      type: "ngrok",
      message: "LocalBridge couldn't establish the ngrok connection.",
    };
  }
  if (lower.includes("tunnel") && lower.includes("failed")) {
    return {
      type: "generic",
      message: "LocalBridge couldn't establish the public HTTPS tunnel.",
    };
  }
  return {
    type: "generic",
    message: "LocalBridge couldn't start the MCP server.",
  };
}
