/**
 * Local MCP smoke test (no VS Code). Starts RepoBridge MCP HTTP server against test-project.
 */
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import * as fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(__dirname, "..", "test-project");

async function readFileRelative(rel) {
  const abs = path.join(workspaceRoot, rel);
  return fs.readFile(abs, "utf8");
}

async function main() {
  const sessions = new Map();

  const createServer = () => {
    const server = new McpServer({ name: "RepoBridge-smoke", version: "0.0.0" });
    server.registerTool(
      "read_file",
      { inputSchema: { path: z.string() } },
      async ({ path: p }) => ({
        content: [{ type: "text", text: await readFileRelative(p) }],
      })
    );
    return server;
  };

  const startSession = async () => {
    const server = createServer();
    let transport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, { server, transport }),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    return transport;
  };

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/mcp") {
      res.writeHead(404);
      res.end();
      return;
    }

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    const sessionId = req.headers["mcp-session-id"];
    const isInit = body?.method === "initialize";

    if (req.method === "POST") {
      if (isInit) {
        const transport = await startSession();
        await transport.handleRequest(req, res, body);
        return;
      }
      await sessions.get(sessionId).transport.handleRequest(req, res, body);
      return;
    }
    res.writeHead(405);
    res.end();
  });

  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = httpServer.address().port;
  const url = new URL(`http://127.0.0.1:${port}/mcp`);

  const client = new Client({ name: "smoke", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("tools/list:", tools.tools.map((t) => t.name).join(", "));

  const result = await client.callTool({ name: "read_file", arguments: { path: "src/hello.js" } });
  console.log("read_file:", result.content?.[0]?.text?.slice(0, 80));

  await client.close();
  await new Promise((resolve) => httpServer.close(resolve));
  console.log("MCP smoke test OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
