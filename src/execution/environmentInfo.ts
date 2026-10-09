import { spawn } from "node:child_process";
import type { WorkspaceManager } from "../security/workspaceManager.js";
import { detectProject } from "./testRunner.js";

export interface EnvironmentInfo {
  os: string;
  arch: string;
  workspaceRoot: string;
  workspaceFolders: string[];
  nodeVersion: string;
  npmVersion: string | null;
  pythonVersion: string | null;
  gitVersion: string | null;
  dockerAvailable: boolean;
  packageManager: string | null;
  projectKind: string;
}

export async function gatherEnvironmentInfo(workspace: WorkspaceManager): Promise<EnvironmentInfo> {
  const root = workspace.primary.root;
  const project = await detectProject(root);

  const [npmVersion, pythonVersion, gitVersion, dockerAvailable] = await Promise.all([
    runVersionCommand("npm --version"),
    runVersionCommand("python --version"),
    runVersionCommand("git --version"),
    checkDocker(),
  ]);

  return {
    os: process.platform,
    arch: process.arch,
    workspaceRoot: root,
    workspaceFolders: workspace.roots.map((r) => r.path),
    nodeVersion: process.version,
    npmVersion,
    pythonVersion,
    gitVersion,
    dockerAvailable,
    packageManager: project.packageManager ?? null,
    projectKind: project.kind,
  };
}

async function runVersionCommand(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
    const args =
      process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
    const child = spawn(shell, args, {
      windowsHide: true,
      env: { PATH: process.env.PATH, Path: process.env.Path },
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      out += String(d);
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      resolve(out.trim() || null);
    });
  });
}

async function checkDocker(): Promise<boolean> {
  const v = await runVersionCommand("docker --version");
  return Boolean(v);
}
