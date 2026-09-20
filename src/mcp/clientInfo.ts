import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatMcpClientDisplayName } from "./clientLabel.js";

/** Read MCP client name from the SDK (McpServer wraps `Server`). */
export function getMcpClientInfoName(mcpServer: McpServer): string | undefined {
  try {
    const underlying = mcpServer.server;
    if (underlying && typeof underlying.getClientVersion === "function") {
      return underlying.getClientVersion()?.name;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function getMcpClientDisplayLabel(mcpServer: McpServer, fallback?: string): string {
  return formatMcpClientDisplayName(fallback ?? getMcpClientInfoName(mcpServer));
}

export function extractClientInfoName(initializeBody: unknown): string | undefined {
  if (!initializeBody || typeof initializeBody !== "object") {
    return undefined;
  }
  const params = (initializeBody as { params?: { clientInfo?: { name?: string } } }).params;
  const name = params?.clientInfo?.name?.trim();
  return name || undefined;
}
