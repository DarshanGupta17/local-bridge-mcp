import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, truncateUtf8 } from "./outputRedaction.js";

describe("outputRedaction", () => {
  it("redacts bearer tokens", () => {
    const out = redactSecrets("Authorization: Bearer abcdef1234567890");
    assert.match(out, /REDACTED/);
    assert.doesNotMatch(out, /abcdef1234567890/);
  });

  it("truncates utf8 output", () => {
    const { text, truncated } = truncateUtf8("hello world", 5);
    assert.equal(truncated, true);
    assert.ok(text.includes("truncated"));
  });
});
