import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXECUTION_LIMIT_DEFAULTS } from "../config/executionLimitsDefaults.js";
import { runShellCommand } from "./commandRunner.js";
import * as path from "node:path";
import * as os from "node:os";

describe("runShellCommand", () => {
  it("runs a successful command", async () => {
    const cmd =
      process.platform === "win32" ? "echo hello-localbridge" : "echo hello-localbridge";
    const result = await runShellCommand({
      command: cmd,
      cwd: os.tmpdir(),
      timeoutMs: 10_000,
      limits: EXECUTION_LIMIT_DEFAULTS,
    });
    assert.equal(result.timedOut, false);
    assert.ok(result.stdout.includes("hello-localbridge"));
    assert.equal(result.success, true);
  });

  it("times out fast commands", async () => {
    const cmd =
      process.platform === "win32"
        ? "powershell -NoProfile -Command Start-Sleep -Seconds 5"
        : "sleep 5";
    const result = await runShellCommand({
      command: cmd,
      cwd: os.tmpdir(),
      timeoutMs: 50,
      limits: EXECUTION_LIMIT_DEFAULTS,
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.success, false);
  });

  it("fails for nonexistent command", async () => {
    const result = await runShellCommand({
      command: "localbridge_nonexistent_cmd_xyz",
      cwd: path.resolve(os.tmpdir()),
      timeoutMs: 5000,
      limits: EXECUTION_LIMIT_DEFAULTS,
    });
    assert.equal(result.success, false);
  });
});
