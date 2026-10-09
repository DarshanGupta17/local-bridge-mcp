import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CommandRunResult } from "./commandRunner.js";
import { runShellCommand } from "./commandRunner.js";
import type { ExecutionLimits } from "../config/executionLimitsDefaults.js";

export type ProjectKind =
  | "node-npm"
  | "node-pnpm"
  | "node-yarn"
  | "node-bun"
  | "python-pytest"
  | "go"
  | "rust"
  | "java-maven"
  | "java-gradle"
  | "unknown";

export interface DetectedProject {
  kind: ProjectKind;
  packageManager?: string;
}

export async function detectProject(workspaceRoot: string): Promise<DetectedProject> {
  const has = async (rel: string) => {
    try {
      await fs.access(path.join(workspaceRoot, rel));
      return true;
    } catch {
      return false;
    }
  };

  if (await has("Cargo.toml")) {
    return { kind: "rust", packageManager: "cargo" };
  }
  if (await has("go.mod")) {
    return { kind: "go", packageManager: "go" };
  }
  if (await has("pom.xml")) {
    return { kind: "java-maven", packageManager: "maven" };
  }
  if (await has("build.gradle") || (await has("build.gradle.kts"))) {
    return { kind: "java-gradle", packageManager: "gradle" };
  }
  if (await has("pyproject.toml") || (await has("pytest.ini")) || (await has("setup.py"))) {
    return { kind: "python-pytest", packageManager: "pytest" };
  }

  if (await has("package.json")) {
    if (await has("pnpm-lock.yaml")) {
      return { kind: "node-pnpm", packageManager: "pnpm" };
    }
    if (await has("yarn.lock")) {
      return { kind: "node-yarn", packageManager: "yarn" };
    }
    if (await has("bun.lock") || (await has("bun.lockb"))) {
      return { kind: "node-bun", packageManager: "bun" };
    }
    return { kind: "node-npm", packageManager: "npm" };
  }

  return { kind: "unknown" };
}

export async function resolveTestCommand(
  workspaceRoot: string,
  explicitCommand?: string,
  testScript?: string
): Promise<string> {
  if (explicitCommand?.trim()) {
    return explicitCommand.trim();
  }

  const project = await detectProject(workspaceRoot);
  const script = testScript?.trim() || "test";

  switch (project.kind) {
    case "node-npm":
      return `npm run ${script}`;
    case "node-pnpm":
      return `pnpm run ${script}`;
    case "node-yarn":
      return `yarn run ${script}`;
    case "node-bun":
      return `bun run ${script}`;
    case "python-pytest":
      return "python -m pytest";
    case "go":
      return "go test ./...";
    case "rust":
      return "cargo test";
    case "java-maven":
      return "mvn test";
    case "java-gradle":
      return process.platform === "win32" ? "gradlew.bat test" : "./gradlew test";
    default:
      return "npm test";
  }
}

export async function runTests(options: {
  workspaceRoot: string;
  cwd: string;
  command?: string;
  test?: string;
  timeoutMs: number;
  limits: ExecutionLimits;
}): Promise<CommandRunResult & { command: string }> {
  const command = await resolveTestCommand(options.workspaceRoot, options.command, options.test);
  const result = await runShellCommand({
    command,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    limits: options.limits,
  });
  return { ...result, command };
}
