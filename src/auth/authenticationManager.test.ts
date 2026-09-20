import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendTokenToMcpUrl,
  extractAuthTokenFromHeaders,
  extractAuthTokenFromQuery,
} from "./authenticationManager.js";

describe("extractAuthTokenFromHeaders", () => {
  it("reads Bearer token", () => {
    const token = extractAuthTokenFromHeaders({ authorization: "Bearer local_abc" });
    assert.equal(token, "local_abc");
  });

  it("reads custom header", () => {
    const token = extractAuthTokenFromHeaders({ "x-localbridge-token": "local_xyz" });
    assert.equal(token, "local_xyz");
  });

  it("reads access_token query param", () => {
    const url = new URL("https://example.ngrok-free.app/mcp?access_token=local_abc");
    assert.equal(extractAuthTokenFromQuery(url), "local_abc");
  });

  it("appends token to MCP URL", () => {
    const out = appendTokenToMcpUrl("https://host/mcp", "local_t");
    assert.ok(out.includes("access_token=local_t"));
  });
});
