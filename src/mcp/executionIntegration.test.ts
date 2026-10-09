/**
 * MCP-path integration (no VS Code): command execution stack used by run_command handlers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import { EXECUTION_LIMIT_DEFAULTS } from "../config/executionLimitsDefaults.js";
import { classifyCommand } from "../execution/commandPolicy.js";
import { runShellCommand } from "../execution/commandRunner.js";
import { redactSecrets } from "../execution/outputRedaction.js";

describe("MCP execution integration path", () => {
  it("classifies, runs, and redacts command output", async () => {
    const command = process.platform === "win32" ? "echo mcp-integration" : "echo mcp-integration";
    const classification = classifyCommand(command);
    assert.notEqual(classification.risk, "block");

    const result = await runShellCommand({
      command,
      cwd: os.tmpdir(),
      timeoutMs: 15_000,
      limits: EXECUTION_LIMIT_DEFAULTS,
    });

    const payload = {
      success: result.success,
      exitCode: result.exitCode,
      stdout: redactSecrets(result.stdout),
      stderr: result.stderr,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    };

    assert.equal(payload.timedOut, false);
    assert.ok(payload.stdout.includes("mcp-integration"));
    assert.equal(typeof payload.durationMs, "number");
  });
});
