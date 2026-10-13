/**
 * Test 6: MCP Streamable HTTP client against a minimal authenticated server (no VS Code).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { WorkspaceFilesystem } from "../../src/workspace/filesystem.js";
import { extractAuthToken } from "../../src/auth/authenticationManager.js";

function timingSafeEqualStrings(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

describe("Test 6: MCP HTTP client integration", () => {
  let tmp: string;
  let fsApi: WorkspaceFilesystem;
  let httpServer: http.Server;
  let port: number;
  let mcpToken: string;

  it("prepares workspace and MCP server", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lb-ci-mcp-"));
    fsApi = await WorkspaceFilesystem.create(tmp);
    await fsApi.createFileWithParentsAtomic("hello.txt", "mcp-ci-content", []);
    mcpToken = `local_${crypto.randomBytes(16).toString("base64url")}`;

    const sessions = new Map<string, { transport: StreamableHTTPServerTransport }>();

    const createSession = async () => {
      const server = new McpServer({ name: "LocalBridge-ci", version: "0.0.0" });
      server.registerTool(
        "read_file",
        { inputSchema: { path: z.string() } },
        async ({ path: rel }) => {
          const text = await fsApi.readFileIfExists(rel);
          return { content: [{ type: "text", text: text ?? "NOT_FOUND" }] };
        }
      );
      let transport!: StreamableHTTPServerTransport;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, { transport }),
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };
      await server.connect(transport);
      return transport;
    };

    httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/mcp") {
        res.writeHead(404);
        res.end();
        return;
      }

      const token = extractAuthToken(
        req.headers as Record<string, string | string[] | undefined>,
        url
      );
      if (!token || !timingSafeEqualStrings(token, mcpToken)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "AUTHENTICATION_FAILED" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const c of req) {
        chunks.push(c as Buffer);
      }
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const isInit = body?.method === "initialize";

      if (req.method === "POST") {
        if (isInit) {
          const transport = await createSession();
          await transport.handleRequest(req, res, body);
          return;
        }
        const session = sessionId ? sessions.get(sessionId) : undefined;
        if (!session) {
          res.writeHead(404);
          res.end();
          return;
        }
        await session.transport.handleRequest(req, res, body);
        return;
      }
      res.writeHead(405);
      res.end();
    });

    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
    port = (httpServer.address() as { port: number }).port;
  });

  it("rejects unauthenticated MCP requests", async () => {
    const url = new URL(`http://127.0.0.1:${port}/mcp`);
    const res = await fetch(url, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    assert.equal(res.status, 401);
  });

  it("lists tools and reads a file via MCP", async () => {
    const url = new URL(`http://127.0.0.1:${port}/mcp?access_token=${encodeURIComponent(mcpToken)}`);
    const client = new Client({ name: "ci-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(url);
    await client.connect(transport);

    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "read_file"));

    const result = await client.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
    const text = (result.content as { text?: string }[])?.[0]?.text;
    assert.equal(text, "mcp-ci-content");

    await client.close();
  });

  after(async () => {
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
