import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { WorkspaceFilesystem } from "./filesystem.js";
import { searchInWorkspace } from "./search.js";

describe("searchInWorkspace", () => {
  let tmpRoot: string;
  let fsApi: WorkspaceFilesystem;

  before(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "localbridge-search-"));
    await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, "src", "auth.js"), "function authenticate() {}", "utf8");
    await fs.writeFile(path.join(tmpRoot, ".env"), "DATABASE_URL=secret", "utf8");
    fsApi = await WorkspaceFilesystem.create(tmpRoot);
  });

  after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("searches normal files without including .env in repo-wide search", async () => {
    const matches = await searchInWorkspace(fsApi, "DATABASE_URL");
    assert.equal(matches.length, 0);
  });

  it("finds matches in normal source files", async () => {
    const matches = await searchInWorkspace(fsApi, "authenticate");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].file, "src/auth.js");
  });

  it("searches sensitive file when explicitly allowed", async () => {
    const matches = await searchInWorkspace(fsApi, "DATABASE_URL", ".env", {
      allowSensitiveTargets: true,
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].file, ".env");
  });
});
