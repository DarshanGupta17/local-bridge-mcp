import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contentSha256 } from "./contentHash.js";

describe("contentSha256", () => {
  it("changes when content changes", () => {
    const a = contentSha256("hello");
    const b = contentSha256("hello!");
    assert.notEqual(a, b);
  });
});
