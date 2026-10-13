import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatNgrokLoadError } from "./ngrokErrors.js";

describe("formatNgrokLoadError", () => {
  it("explains header crash on extension host", () => {
    const msg = formatNgrokLoadError(new Error("Cannot read properties of undefined (reading 'header')"));
    assert.match(msg, /native module failed to load/i);
    assert.match(msg, /Cloudflare/i);
  });

  it("explains missing platform package", () => {
    const msg = formatNgrokLoadError(
      new Error("Cannot find module '@ngrok/ngrok-linux-x64-gnu'")
    );
    assert.match(msg, /platform binary/i);
  });
});
