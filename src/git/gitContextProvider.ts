import { spawn } from "node:child_process";
import * as path from "node:path";
import { LocalBridgeError } from "../core/errors.js";
import { isSensitivePath, normalizeRelativePath } from "../security/sensitivePathDetector.js";

const MAX_DIFF_BYTES = 256 * 1024;

export class GitContextProvider {
  constructor(private readonly cwd: string) {}

  async status(): Promise<string> {
    const out = await this.runGit(["status", "--porcelain=v1", "-b"]);
    const branchLine = out.split("\n").find((l) => l.startsWith("##"));
    const branch = branchLine?.replace(/^##\s*/, "").split("...")[0] ?? "unknown";
    const lines = out.split("\n").filter((l) => l && !l.startsWith("##"));
    const modified: string[] = [];
    const untracked: string[] = [];
    const deleted: string[] = [];
    const staged: string[] = [];

    for (const line of lines) {
      const code = line.slice(0, 2);
      const file = line.slice(3).trim();
      if (code.includes("?")) {
        untracked.push(file);
      } else if (code[0] !== " " && code[0] !== "?") {
        staged.push(file);
      }
      if (code[1] === "M") {
        modified.push(file);
      }
      if (code[1] === "D" || code === " D") {
        deleted.push(file);
      }
    }

    return [
      `Branch: ${branch}`,
      `Modified: ${modified.length ? modified.join(", ") : "(none)"}`,
      `Untracked: ${untracked.length ? untracked.join(", ") : "(none)"}`,
      `Deleted: ${deleted.length ? deleted.join(", ") : "(none)"}`,
      `Staged: ${staged.length ? staged.join(", ") : "(none)"}`,
    ].join("\n");
  }

  async branch(): Promise<string> {
    const branch = (await this.runGit(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const upstream = (await this.runGit(["rev-parse", "--abbrev-ref", "@{upstream}"]).catch(() => "")).trim();
    return [`Current branch: ${branch}`, upstream ? `Upstream: ${upstream}` : ""].filter(Boolean).join("\n");
  }

  async diff(relativePath?: string, includeSensitive = false): Promise<string> {
    if (relativePath) {
      const norm = normalizeRelativePath(relativePath);
      if (isSensitivePath(norm) && !includeSensitive) {
        throw new LocalBridgeError(
          "SENSITIVE_ACCESS_DENIED",
          "Diff for sensitive paths requires explicit user approval."
        );
      }
    }
    const args = ["diff", "--stat", "--max-count=1"];
    if (relativePath) {
      args.push("--", relativePath);
    }
    let out = await this.runGit(args);
    const fullDiffArgs = ["diff"];
    if (relativePath) {
      fullDiffArgs.push("--", relativePath);
    }
    const full = await this.runGit(fullDiffArgs);
    if (Buffer.byteLength(full, "utf8") > MAX_DIFF_BYTES) {
      out += `\n\n(diff truncated — exceeds ${MAX_DIFF_BYTES} bytes)`;
    } else {
      out += `\n\n${full}`;
    }
    return out.trim() || "No diff.";
  }

  private runGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: this.cwd,
        windowsHide: true,
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += String(d);
      });
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", (err) => {
        reject(new LocalBridgeError("OPERATION_NOT_SUPPORTED", `Git not available: ${err.message}`));
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new LocalBridgeError(
              "OPERATION_NOT_SUPPORTED",
              stderr.trim() || `git ${args.join(" ")} failed with code ${code}`
            )
          );
          return;
        }
        resolve(stdout);
      });
    });
  }
}

export function gitProviderForRoot(workspaceRoot: string): GitContextProvider {
  return new GitContextProvider(path.resolve(workspaceRoot));
}
