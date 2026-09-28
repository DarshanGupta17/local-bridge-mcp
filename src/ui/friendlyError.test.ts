import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatFriendlyError } from "./friendlyError.js";

describe("formatFriendlyError", () => {
  test("returns undefined for empty or missing error", () => {
    assert.equal(formatFriendlyError(undefined), undefined);
    assert.equal(formatFriendlyError(""), undefined);
  });

  test("formats port collision error cleanly", () => {
    const err = formatFriendlyError("listen EADDRINUSE: address already in use :::3000", 3000);
    assert.ok(err);
    assert.equal(err.type, "port");
    assert.equal(err.message, "Port 3000 is already being used by another application.");
    assert.equal(err.port, 3000);
  });

  test("formats port collision error from descriptive string", () => {
    const err = formatFriendlyError("port 8080 is already being used");
    assert.ok(err);
    assert.equal(err.type, "port");
    assert.equal(err.message, "Port 8080 is already being used by another application.");
  });

  test("formats ngrok failure cleanly", () => {
    const err = formatFriendlyError("Failed to start ngrok tunnel: ERR_NGROK_108");
    assert.ok(err);
    assert.equal(err.type, "ngrok");
    assert.equal(err.message, "LocalBridge couldn't establish the ngrok connection.");
  });

  test("formats authtoken ngrok failure cleanly", () => {
    const err = formatFriendlyError("Invalid authtoken provided");
    assert.ok(err);
    assert.equal(err.type, "ngrok");
    assert.equal(err.message, "LocalBridge couldn't establish the ngrok connection.");
  });

  test("formats generic MCP startup failure cleanly without stack trace", () => {
    const err = formatFriendlyError("Unexpected internal error in startHttpServer: Error at line 42");
    assert.ok(err);
    assert.equal(err.type, "generic");
    assert.equal(err.message, "LocalBridge couldn't start the MCP server.");
  });
});
