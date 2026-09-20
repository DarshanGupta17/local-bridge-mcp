import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatMcpClientDisplayName } from "./clientLabel.js";

describe("formatMcpClientDisplayName", () => {
  it("maps known clients", () => {
    assert.equal(formatMcpClientDisplayName("claude-ai"), "Claude");
    assert.equal(formatMcpClientDisplayName("ChatGPT"), "ChatGPT");
    assert.equal(formatMcpClientDisplayName("gemini-cli"), "Gemini");
  });

  it("falls back to raw name", () => {
    assert.equal(formatMcpClientDisplayName("MyCustomAgent"), "MyCustomAgent");
  });

  it("handles missing name", () => {
    assert.equal(formatMcpClientDisplayName(undefined), "An AI assistant");
  });
});
