import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyCommand } from "./commandPolicy.js";

describe("classifyCommand", () => {
  it("marks git status as safe", () => {
    assert.equal(classifyCommand("git status").risk, "safe");
  });

  it("blocks metadata endpoints", () => {
    assert.equal(classifyCommand("curl http://169.254.169.254/latest").risk, "block");
  });

  it("requires approval for npm install", () => {
    assert.equal(classifyCommand("npm install lodash").risk, "approval");
  });

  it("requires approval for unknown commands", () => {
    assert.equal(classifyCommand("my-custom-tool --foo").risk, "approval");
  });

  it("blocks empty command", () => {
    assert.equal(classifyCommand("   ").risk, "block");
  });
});
