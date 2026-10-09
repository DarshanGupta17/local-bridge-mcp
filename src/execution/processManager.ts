import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ExecutionLimits } from "../config/executionLimitsDefaults.js";
import { redactSecrets, truncateUtf8 } from "./outputRedaction.js";

export type ManagedProcessStatus = "running" | "exited" | "stopped" | "failed";

export interface ManagedProcessSummary {
  processId: string;
  pid: number | undefined;
  command: string;
  cwd: string;
  status: ManagedProcessStatus;
  startedAt: string;
  exitCode: number | null;
  listeningPort?: number;
}

interface ManagedProcess {
  id: string;
  command: string;
  cwd: string;
  shell?: string;
  child: ChildProcessWithoutNullStreams;
  status: ManagedProcessStatus;
  startedAt: Date;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  listeningPort?: number;
}

const PORT_LINE = /\blisten(?:ing)?(?:\s+on)?\s+(?:port\s+)?(\d{2,5})\b/i;

export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();

  constructor(private readonly limits: ExecutionLimits) {}

  disposeAll(): void {
    for (const id of [...this.processes.keys()]) {
      void this.stopProcess(id, true);
    }
    this.processes.clear();
  }

  list(): ManagedProcessSummary[] {
    return [...this.processes.values()].map((p) => this.toSummary(p));
  }

  getSummary(processId: string): ManagedProcessSummary | undefined {
    const p = this.processes.get(processId);
    return p ? this.toSummary(p) : undefined;
  }

  startProcess(command: string, cwd: string, shell?: string): { processId: string; pid: number | undefined; status: "running" } {
    if (this.processes.size >= this.limits.maxManagedProcesses) {
      throw new Error("Maximum managed process count reached.");
    }

    const id = randomUUID();
    const useShell = shell ?? (process.platform === "win32" ? undefined : "/bin/sh");
    const executable = useShell ?? (process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh");
    const args =
      useShell === undefined
        ? process.platform === "win32"
          ? ["/d", "/s", "/c", command]
          : ["-c", command]
        : ["-c", command];

    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: "pipe",
      env: minimalEnv(),
      shell: false,
    }) as ChildProcessWithoutNullStreams;

    const entry: ManagedProcess = {
      id,
      command,
      cwd,
      shell,
      child,
      status: "running",
      startedAt: new Date(),
      exitCode: null,
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
    };

    const append = (stream: "out" | "err", chunk: Buffer) => {
      const str = chunk.toString("utf8");
      const field = stream === "out" ? "stdout" : "stderr";
      const bytesField = stream === "out" ? "stdoutBytes" : "stderrBytes";
      entry[bytesField] += chunk.length;
      if (entry[bytesField] <= this.limits.maxProcessOutputBytes * 2) {
        entry[field] += str;
      }
      const portMatch = str.match(PORT_LINE);
      if (portMatch) {
        const port = Number(portMatch[1]);
        if (port > 0 && port <= 65535) {
          entry.listeningPort = port;
        }
      }
      if (entry[bytesField] > this.limits.maxProcessOutputBytes) {
        const trimmed = truncateUtf8(entry[field], this.limits.maxProcessOutputBytes);
        entry[field] = trimmed.text;
      }
    };

    child.stdout.on("data", (d) => append("out", d));
    child.stderr.on("data", (d) => append("err", d));

    child.on("error", () => {
      entry.status = "failed";
      entry.exitCode = null;
    });

    child.on("close", (code) => {
      entry.exitCode = code;
      if (entry.status === "running") {
        entry.status = "exited";
      }
    });

    this.processes.set(id, entry);
    return { processId: id, pid: child.pid, status: "running" };
  }

  readOutput(
    processId: string,
    maxLines?: number,
    maxBytes?: number
  ): {
    processId: string;
    status: ManagedProcessStatus;
    stdout: string;
    stderr: string;
    truncated: boolean;
  } {
    const entry = this.processes.get(processId);
    if (!entry) {
      throw new Error("PROCESS_NOT_FOUND");
    }

    const byteCap = maxBytes ?? this.limits.maxStdoutBytes;
    let stdout = redactSecrets(entry.stdout);
    let stderr = redactSecrets(entry.stderr);
    let truncated = false;

    const tOut = truncateUtf8(stdout, byteCap);
    stdout = tOut.text;
    truncated = truncated || tOut.truncated;
    const tErr = truncateUtf8(stderr, this.limits.maxStderrBytes);
    stderr = tErr.text;
    truncated = truncated || tErr.truncated;

    if (maxLines !== undefined && maxLines > 0) {
      stdout = tailLines(stdout, maxLines);
      stderr = tailLines(stderr, maxLines);
    }

    return {
      processId,
      status: entry.status,
      stdout,
      stderr,
      truncated,
    };
  }

  sendInput(processId: string, input: string): void {
    const entry = this.processes.get(processId);
    if (!entry) {
      throw new Error("PROCESS_NOT_FOUND");
    }
    if (entry.status !== "running") {
      throw new Error("Process is not running.");
    }
    if (!entry.child.stdin.writable) {
      throw new Error("Process stdin is not available.");
    }
    entry.child.stdin.write(input);
  }

  async stopProcess(processId: string, force = false): Promise<void> {
    const entry = this.processes.get(processId);
    if (!entry) {
      throw new Error("PROCESS_NOT_FOUND");
    }
    if (entry.status !== "running") {
      return;
    }

    if (!force) {
      try {
        entry.child.kill("SIGTERM");
      } catch {
        // ignore
      }
      await waitForExit(entry.child, 5000);
      if (entry.status === "running") {
        force = true;
      }
    }

    if (force && entry.status === "running") {
      try {
        if (process.platform === "win32" && entry.child.pid) {
          spawn("taskkill", ["/pid", String(entry.child.pid), "/f", "/t"], { stdio: "ignore" });
        } else {
          entry.child.kill("SIGKILL");
        }
      } catch {
        // ignore
      }
      entry.status = "stopped";
    } else if (entry.status === "running") {
      entry.status = "stopped";
    }
  }

  findListeningServers(): { port: number; protocol: "http"; status: "listening"; processId: string }[] {
    const out: { port: number; protocol: "http"; status: "listening"; processId: string }[] = [];
    for (const p of this.processes.values()) {
      if (p.listeningPort && p.status === "running") {
        out.push({
          port: p.listeningPort,
          protocol: "http",
          status: "listening",
          processId: p.id,
        });
      }
    }
    return out;
  }

  private toSummary(p: ManagedProcess): ManagedProcessSummary {
    return {
      processId: p.id,
      pid: p.child.pid,
      command: p.command,
      cwd: p.cwd,
      status: p.status,
      startedAt: p.startedAt.toISOString(),
      exitCode: p.exitCode,
      listeningPort: p.listeningPort,
    };
  }
}

function tailLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return text;
  }
  return lines.slice(-maxLines).join("\n");
}

function minimalEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? process.env.Path,
    Path: process.env.Path ?? process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    COMSPEC: process.env.COMSPEC,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    CI: "true",
    FORCE_COLOR: "0",
  };
}

function waitForExit(child: ChildProcessWithoutNullStreams, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
