import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeNgrokDomain, resolveNgrokStaticDomain } from "./config.js";

describe("ngrok config", () => {
  it("normalizes domain values", () => {
    assert.equal(normalizeNgrokDomain("https://foo.ngrok-free.app/mcp"), "foo.ngrok-free.app");
    assert.equal(normalizeNgrokDomain("foo.ngrok-free.app"), "foo.ngrok-free.app");
  });

  it("reads static domain from env when setting empty", () => {
    const prev = process.env.NGROK_DOMAIN;
    process.env.NGROK_DOMAIN = "https://static.example.ngrok-free.app";
    try {
      assert.equal(resolveNgrokStaticDomain(""), "static.example.ngrok-free.app");
    } finally {
      if (prev === undefined) {
        delete process.env.NGROK_DOMAIN;
      } else {
        process.env.NGROK_DOMAIN = prev;
      }
    }
  });
});
