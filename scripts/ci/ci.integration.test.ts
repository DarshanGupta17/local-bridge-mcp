/**
 * CI integration tests (Tests 3–5, 7): filesystem, paths/shell, processes, networking.
 * Runs headless without VS Code via tsx.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { WorkspaceFilesystem } from "../../src/workspace/filesystem.js";
import { searchInWorkspace } from "../../src/workspace/search.js";
import { ProcessManager } from "../../src/execution/processManager.js";
import { EXECUTION_LIMIT_DEFAULTS } from "../../src/config/executionLimitsDefaults.js";
import { runShellCommand } from "../../src/execution/commandRunner.js";
import { validateLocalHttpUrl } from "../../src/execution/httpClient.js";
import { extractAuthTokenFromHeaders } from "../../src/auth/authenticationManager.js";
import { isSensitivePath } from "../../src/security/sensitivePathDetector.js";

describe("Test 3: File read/write (WorkspaceFilesystem)", () => {
  let tmp: string;
  let fsApi: WorkspaceFilesystem;

  it("setup temp workspace", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lb-ci-fs-"));
    fsApi = await WorkspaceFilesystem.create(tmp);
  });

  it("creates, reads, updates, deletes files and directories", async () => {
    await fsApi.createFileWithParentsAtomic("src/nested/hello.txt", "v1", ["src", "src/nested"]);
    let content = await fsApi.readFileIfExists("src/nested/hello.txt");
    assert.equal(content, "v1");
    await fsApi.writeFileAtomic("src/nested/hello.txt", "v2");
    content = await fsApi.readFileIfExists("src/nested/hello.txt");
    assert.equal(content, "v2");

    const matches = await searchInWorkspace(fsApi, "v2", undefined, {
      allowSensitiveTargets: false,
      maxFileBytes: 1024 * 1024,
    });
    assert.ok(matches.some((m) => m.file.includes("hello.txt")));

    await fsApi.deleteFile("src/nested/hello.txt");
    assert.equal(await fsApi.readFileIfExists("src/nested/hello.txt"), undefined);
    await fsApi.deleteDirectoryRecursive("src");
  });

  it("rejects path traversal", async () => {
    await assert.rejects(() => fsApi.resolveRelativePath("../outside.txt"));
  });

  it("cleanup", async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe("Test 4: Paths and shell commands", () => {
  it("handles paths with spaces", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lb-ci-space-"));
    const dirWithSpace = path.join(tmp, "folder name");
    await fs.mkdir(dirWithSpace);
    const file = path.join(dirWithSpace, "a b.txt");
    await fs.writeFile(file, "space-ok");

    const fsApi = await WorkspaceFilesystem.create(tmp);
    const rel = process.platform === "win32" ? "folder name/a b.txt" : "folder name/a b.txt";
    const read = await fsApi.readFileIfExists(rel);
    assert.equal(read, "space-ok");
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("runs a platform shell command with exit code", async () => {
    const cmd =
      process.platform === "win32" ? "echo localbridge-ci-path" : "echo localbridge-ci-path";
    const result = await runShellCommand({
      command: cmd,
      cwd: os.tmpdir(),
      timeoutMs: 15_000,
      limits: EXECUTION_LIMIT_DEFAULTS,
    });
    assert.equal(result.success, true);
    assert.ok(result.stdout.includes("localbridge-ci-path"));
  });

  it("reports failure for missing command", async () => {
    const result = await runShellCommand({
      command: "localbridge_nonexistent_cmd_xyz_999",
      cwd: os.tmpdir(),
      timeoutMs: 5000,
      limits: EXECUTION_LIMIT_DEFAULTS,
    });
    assert.equal(result.success, false);
  });
});

describe("Test 5: Process lifecycle", () => {
  const pm = new ProcessManager(EXECUTION_LIMIT_DEFAULTS);

  after(() => {
    pm.disposeAll();
  });

  it("starts, reads output, stops process", async () => {
    const cmd = process.platform === "win32" ? "echo proc-lifecycle" : "echo proc-lifecycle";
    const { processId } = pm.startProcess(cmd, os.tmpdir());
    await new Promise((r) => setTimeout(r, 800));
    const out = pm.readOutput(processId);
    assert.ok(out.stdout.includes("proc-lifecycle") || out.status === "exited");
    await pm.stopProcess(processId, true);
  });
});

describe("Test 7: Networking and security", () => {
  it("allows localhost HTTP URLs only", () => {
    assert.doesNotThrow(() => validateLocalHttpUrl("http://127.0.0.1:3000/health"));
    assert.throws(() => validateLocalHttpUrl("https://example.com/"));
  });

  it("extracts bearer token from headers without logging secrets in test", () => {
    const token = extractAuthTokenFromHeaders({ authorization: "Bearer local_test_token" });
    assert.equal(token, "local_test_token");
  });

  it("classifies sensitive paths", () => {
    assert.equal(isSensitivePath(".env"), true);
    assert.equal(isSensitivePath("src/index.ts"), false);
  });
});
