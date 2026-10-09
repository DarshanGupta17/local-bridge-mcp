export interface ExecutionLimits {
  defaultCommandTimeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxProcessOutputBytes: number;
  maxManagedProcesses: number;
  maxConcurrentCommands: number;
  httpTimeoutMs: number;
  maxHttpResponseBytes: number;
  defaultTestTimeoutMs: number;
}

export const EXECUTION_LIMIT_DEFAULTS: ExecutionLimits = {
  defaultCommandTimeoutMs: 120_000,
  maxStdoutBytes: 512 * 1024,
  maxStderrBytes: 256 * 1024,
  maxProcessOutputBytes: 1024 * 1024,
  maxManagedProcesses: 16,
  maxConcurrentCommands: 4,
  httpTimeoutMs: 10_000,
  maxHttpResponseBytes: 512 * 1024,
  defaultTestTimeoutMs: 300_000,
};
