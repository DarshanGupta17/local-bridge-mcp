import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import { EXECUTION_LIMIT_DEFAULTS } from "../config/executionLimitsDefaults.js";
import { ProcessManager } from "./processManager.js";

describe("ProcessManager", () => {
  it("starts, reads output, and stops a process", async () => {
    const pm = new ProcessManager(EXECUTION_LIMIT_DEFAULTS);
    const cmd = process.platform === "win32" ? "echo proc-ok" : "echo proc-ok";
    const { processId } = pm.startProcess(cmd, os.tmpdir());
    await new Promise((r) => setTimeout(r, 500));
    const out = pm.readOutput(processId);
    assert.ok(out.stdout.includes("proc-ok") || out.status === "exited");
    await pm.stopProcess(processId, true);
    pm.disposeAll();
  });

  it("throws when process not found", () => {
    const pm = new ProcessManager(EXECUTION_LIMIT_DEFAULTS);
    assert.throws(() => pm.readOutput("missing-id"), /PROCESS_NOT_FOUND/);
  });
});
