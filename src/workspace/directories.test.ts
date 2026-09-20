import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { WorkspaceFilesystem, WorkspacePathError } from "./filesystem.js";
import {
  buildDirectoryDeletePreview,
  directoryExists,
  missingDirectoryChain,
} from "./directories.js";
import { isDeleteDirectoryBlocked } from "./security.js";

describe("directories", () => {
  let tmpRoot: string;
  let fsApi: WorkspaceFilesystem;

  before(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "localbridge-dir-"));
    await fs.mkdir(path.join(tmpRoot, "src", "services", "auth"), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, "src", "services", "auth", "keep.ts"), "x", "utf8");
    fsApi = await WorkspaceFilesystem.create(tmpRoot);
  });

  after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("missingDirectoryChain lists only missing segments", async () => {
    const missing = await missingDirectoryChain(fsApi, "src/services/auth/providers");
    assert.deepEqual(missing, ["src/services/auth/providers"]);
  });

  it("missingDirectoryChain for nested new tree", async () => {
    const missing = await missingDirectoryChain(fsApi, "src/services/email/templates");
    assert.deepEqual(missing, ["src/services/email", "src/services/email/templates"]);
  });

  it("rejects directory create when path is a file", async () => {
    await assert.rejects(
      () => missingDirectoryChain(fsApi, "src/services/auth/keep.ts"),
      /existing file/
    );
  });

  it("createDirectoriesAtomic creates nested dirs", async () => {
    await fsApi.createDirectoriesAtomic(["src/services/email", "src/services/email/templates"]);
    assert.equal(await directoryExists(fsApi, "src/services/email/templates"), true);
  });

  it("createFileWithParentsAtomic creates parents and file", async () => {
    await fsApi.createFileWithParentsAtomic(
      "src/services/email/email_service.py",
      "class EmailService: pass",
      ["src/services/email"]
    );
    const content = await fsApi.readFile("src/services/email/email_service.py");
    assert.match(content, /EmailService/);
  });

  it("createDirectoriesAtomic rolls back on failure", async () => {
    await fs.writeFile(fsApi.absolutePathForRelative("src/blocker"), "not-a-dir", "utf8");
    await assert.rejects(() =>
      fsApi.createDirectoriesAtomic(["src/blocker", "src/blocker/sub"])
    );
    assert.equal(await directoryExists(fsApi, "src/blocker/sub"), false);
  });

  it("deleteDirectoryRecursive removes non-empty tree", async () => {
    await fsApi.createDirectoriesAtomic(["src/old_service", "src/old_service/tests"]);
    await fsApi.createFileOnly("src/old_service/index.ts", "i");
    await fsApi.createFileOnly("src/old_service/service.ts", "s");
    await fsApi.createFileOnly("src/old_service/tests/service.test.ts", "t");

    const preview = await buildDirectoryDeletePreview(fsApi, "src/old_service");
    assert.equal(preview.isEmpty, false);
    assert.ok(preview.fileCount >= 3);

    await fsApi.deleteDirectoryRecursive("src/old_service");
    assert.equal(await directoryExists(fsApi, "src/old_service"), false);
  });

  it("blocks .git deletion policy", () => {
    assert.equal(isDeleteDirectoryBlocked(".git"), true);
    assert.equal(isDeleteDirectoryBlocked(".git/objects"), true);
  });

  it("rejects path traversal for create_directory", async () => {
    await assert.rejects(
      () => missingDirectoryChain(fsApi, "../../outside"),
      WorkspacePathError
    );
  });
});
