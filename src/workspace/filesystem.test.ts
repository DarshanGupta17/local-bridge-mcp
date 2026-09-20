import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { WorkspaceFilesystem, WorkspacePathError } from "./filesystem.js";

describe("WorkspaceFilesystem", () => {
  let tmpRoot: string;
  let fsApi: WorkspaceFilesystem;

  before(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "localbridge-test-"));
    await fs.writeFile(path.join(tmpRoot, "hello.js"), 'return "Hello";', "utf8");
    await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
    fsApi = await WorkspaceFilesystem.create(tmpRoot);
  });

  after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("reads normal files", async () => {
    const content = await fsApi.readFile("hello.js");
    assert.match(content, /Hello/);
  });

  it("rejects path traversal", async () => {
    await assert.rejects(() => fsApi.readFile("../../outside.txt"), WorkspacePathError);
  });

  it("createFileOnly refuses existing files", async () => {
    await assert.rejects(
      () => fsApi.createFileOnly("hello.js", "x"),
      /File already exists/
    );
  });

  it("writeFileAtomic rejects stale snapshot after concurrent change", async () => {
    const snapshot = await fsApi.readFile("hello.js");
    await fs.writeFile(path.join(tmpRoot, "hello.js"), "changed", "utf8");
    await assert.rejects(
      () => fsApi.writeFileAtomic("hello.js", "new", { expectedPrevious: snapshot }),
      /File changed while the operation was awaiting approval/
    );
  });

  it("deleteFile rejects directories", async () => {
    await assert.rejects(
      () => fsApi.deleteFile("src"),
      /delete_file cannot delete directories/
    );
  });
});
