import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateLocalHttpUrl } from "./httpClient.js";

describe("validateLocalHttpUrl", () => {
  it("allows localhost", () => {
    const url = validateLocalHttpUrl("http://localhost:3000/api");
    assert.equal(url.hostname, "localhost");
  });

  it("rejects public hosts", () => {
    assert.throws(() => validateLocalHttpUrl("https://example.com"), /localhost/);
  });

  it("blocks metadata host", () => {
    assert.throws(() => validateLocalHttpUrl("http://169.254.169.254/"), /not allowed/);
  });
});
