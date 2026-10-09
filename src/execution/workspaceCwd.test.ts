import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { WorkspaceManager } from "../security/workspaceManager.js";
import { resolveCommandCwd } from "./workspaceCwd.js";

describe("resolveCommandCwd", () => {
  it("defaults to primary workspace root", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lb-cwd-"));
    const wm = await WorkspaceManager.create([
      { uri: { fsPath: tmp } as import("vscode").Uri, name: "root", index: 0 },
    ]);
    const cwd = await resolveCommandCwd(wm);
    assert.equal(path.resolve(cwd), path.resolve(tmp));
  });
});
