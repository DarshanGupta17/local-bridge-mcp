import { spawn } from "node:child_process";
import type { ExecutionLimits } from "../config/executionLimitsDefaults.js";
import { redactSecrets, truncateUtf8 } from "./outputRedaction.js";

export interface CommandRunResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  error: string | null;
}

export interface RunCommandOptions {
  command: string;
  cwd: string;
  timeoutMs: number;
  shell?: string;
  limits: ExecutionLimits;
}

let activeCommands = 0;

export function getActiveCommandCount(): number {
  return activeCommands;
}

export async function runShellCommand(options: RunCommandOptions): Promise<CommandRunResult> {
  const { command, cwd, timeoutMs, shell, limits } = options;
  const started = Date.now();

  if (activeCommands >= limits.maxConcurrentCommands) {
    return {
      success: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      error: "Too many concurrent commands. Try again shortly.",
    };
  }

  activeCommands++;
  try {
    return await runShellCommandInner(command, cwd, timeoutMs, shell, limits, started);
  } finally {
    activeCommands--;
  }
}

async function runShellCommandInner(
  command: string,
  cwd: string,
  timeoutMs: number,
  shell: string | undefined,
  limits: ExecutionLimits,
  started: number
): Promise<CommandRunResult> {
  const useShell = shell ?? (process.platform === "win32" ? undefined : "/bin/sh");
  const shellArgs = useShell === undefined ? undefined : ["-c", command];
  const executable = useShell ?? (process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh");
  const args =
    useShell === undefined
      ? process.platform === "win32"
        ? ["/d", "/s", "/c", command]
        : ["-c", command]
      : shellArgs!;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      env: sanitizedEnv(),
      shell: false,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 2000);
    }, timeoutMs);

    const append = (stream: "out" | "err", chunk: Buffer) => {
      const str = chunk.toString("utf8");
      if (stream === "out") {
        stdoutBytes += chunk.length;
        if (stdoutBytes <= limits.maxStdoutBytes * 2) {
          stdout += str;
        }
      } else {
        stderrBytes += chunk.length;
        if (stderrBytes <= limits.maxStderrBytes * 2) {
          stderr += str;
        }
      }
    };

    child.stdout?.on("data", (d: Buffer) => append("out", d));
    child.stderr?.on("data", (d: Buffer) => append("err", d));

    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const out = finalizeOutput(stdout, stderr, limits);
      resolve({
        success: false,
        exitCode: null,
        stdout: out.stdout,
        stderr: out.stderr,
        durationMs: Date.now() - started,
        timedOut: false,
        stdoutTruncated: out.stdoutTruncated,
        stderrTruncated: out.stderrTruncated,
        error: err.message.includes("ENOENT") ? "Command or shell not found." : err.message,
      });
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const out = finalizeOutput(stdout, stderr, limits);
      const exitCode = timedOut ? null : code;
      resolve({
        success: !timedOut && code === 0,
        exitCode,
        stdout: out.stdout,
        stderr: out.stderr,
        durationMs: Date.now() - started,
        timedOut,
        stdoutTruncated: out.stdoutTruncated,
        stderrTruncated: out.stderrTruncated,
        error: timedOut ? "Command timed out." : null,
      });
    });
  });
}

function finalizeOutput(
  stdout: string,
  stderr: string,
  limits: ExecutionLimits
): { stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean } {
  const sOut = truncateUtf8(redactSecrets(stdout), limits.maxStdoutBytes);
  const sErr = truncateUtf8(redactSecrets(stderr), limits.maxStderrBytes);
  return {
    stdout: sOut.text,
    stderr: sErr.text,
    stdoutTruncated: sOut.truncated,
    stderrTruncated: sErr.truncated,
  };
}

/** Minimal env for child processes — no secret forwarding beyond PATH basics. */
function sanitizedEnv(): NodeJS.ProcessEnv {
  const allow = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "HOME",
    "USERPROFILE",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "NODE_OPTIONS",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allow) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  env.CI = "true";
  env.FORCE_COLOR = "0";
  return env;
}
