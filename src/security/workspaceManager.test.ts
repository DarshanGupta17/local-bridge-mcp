import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { WorkspaceManager } from "./workspaceManager.js";

describe("WorkspaceManager", () => {
  it("resolves paths under a single root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rb-wm-"));
    await fs.writeFile(path.join(root, "a.txt"), "x", "utf8");
    const wm = await WorkspaceManager.create([{ name: "proj", uri: { fsPath: root } as never, index: 0 }]);
    const picked = wm.pickRootForRelative("a.txt");
    assert.equal(picked.relativePath, "a.txt");
    await fs.rm(root, { recursive: true, force: true });
  });
});
