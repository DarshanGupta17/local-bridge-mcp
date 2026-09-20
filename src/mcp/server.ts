import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { WorkspaceFilesystem } from "../workspace/filesystem.js";
import { workspaceFolderName } from "../workspace/filesystem.js";
import { registerMcpTools, type ToolHandlersContext } from "./tools.js";
import { readJsonBody, setCorsHeaders } from "./transport.js";
import type { Logger } from "../logger.js";
import { PermissionManager } from "../security/permissionManager.js";
import {
  extractClientInfoName,
  getMcpClientDisplayLabel,
  getMcpClientInfoName,
} from "./clientInfo.js";

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  clientName?: string;
}

export interface McpHttpServerHandle {
  port: number;
  stop(): Promise<void>;
}

export async function startMcpHttpServer(
  fsApi: WorkspaceFilesystem,
  log: Logger,
  preferredPort: number
): Promise<McpHttpServerHandle> {
  const sessions = new Map<string, SessionEntry>();

  const createMcpServer = (): {
    server: McpServer;
    setClientName: (name: string | undefined) => void;
  } => {
    const server = new McpServer({
      name: "RepoBridge",
      version: "0.1.0",
      description:
        "RepoBridge exposes the user's local VS Code workspace. Paths are workspace-relative. " +
        "Sensitive reads and destructive operations require explicit user approval in VS Code.",
    });

    let sessionClientName: string | undefined;

    const permissions = new PermissionManager(log, () =>
      getMcpClientDisplayLabel(server, sessionClientName ?? getMcpClientInfoName(server))
    );

    const ctx: ToolHandlersContext = {
      fs: fsApi,
      log,
      permissions,
      onToolCall: (name) => log.info(`MCP tool invoked: ${name}`),
    };
    registerMcpTools(server, ctx);
    return {
      server,
      setClientName(name: string | undefined) {
        sessionClientName = name;
      },
    };
  };

  const startSession = async (
    initializeBody?: unknown
  ): Promise<StreamableHTTPServerTransport> => {
    const { server, setClientName } = createMcpServer();
    let transport!: StreamableHTTPServerTransport;

    const clientFromInit = extractClientInfoName(initializeBody);
    if (clientFromInit) {
      setClientName(clientFromInit);
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        const sdkName = getMcpClientInfoName(server);
        const name = clientFromInit ?? sdkName;
        if (sdkName && !clientFromInit) {
          setClientName(sdkName);
        }
        sessions.set(sessionId, { server, transport, clientName: name });
        if (name) {
          log.info(`MCP client connected: ${getMcpClientDisplayLabel(server, name)}`);
        }
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    await server.connect(transport);
    return transport;
  };

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    try {
      let body: unknown;
      if (req.method === "POST") {
        body = await readJsonBody(req);
      }

      const sessionHeader = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      const isInitialize =
        body &&
        typeof body === "object" &&
        (body as { method?: string }).method === "initialize";

      if (req.method === "POST") {
        if (isInitialize) {
          const transport = await startSession(body);
          await transport.handleRequest(req, res, body);
          return;
        }

        if (!sessionId || !sessions.has(sessionId)) {
          sendJsonRpcError(res, sessionId ? 404 : 400, sessionId ? -32004 : -32003, sessionId ? "Session not found" : "No session ID provided", body);
          return;
        }

        await sessions.get(sessionId)!.transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(sessionId ? 404 : 400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: sessionId ? -32004 : -32003,
                message: sessionId ? "Session not found" : "No session ID provided",
              },
              id: null,
            })
          );
          return;
        }

        await sessions.get(sessionId)!.transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
    } catch (err: unknown) {
      log.error(err instanceof Error ? err.message : "MCP request handling failed");
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          })
        );
      }
    }
  });

  const port = await listen(server, preferredPort);
  log.info("MCP server started");
  log.info(`Workspace: ${workspaceFolderName(fsApi.root)}`);
  log.info(`Port: ${port}`);

  return {
    port,
    async stop() {
      for (const entry of sessions.values()) {
        try {
          await entry.transport.close?.();
        } catch {
          // ignore
        }
        try {
          await entry.server.close();
        } catch {
          // ignore
        }
      }
      sessions.clear();

      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      log.info("MCP server stopped");
    },
  };
}

function listen(server: http.Server, preferredPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(preferredPort, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to determine MCP server port"));
        return;
      }
      resolve(addr.port);
    });
  });
}

function sendJsonRpcError(
  res: http.ServerResponse,
  status: number,
  code: number,
  message: string,
  body: unknown
): void {
  const id =
    body && typeof body === "object" && "id" in body ? (body as { id: unknown }).id : null;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id }));
}
