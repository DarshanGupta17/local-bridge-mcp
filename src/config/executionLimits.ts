import * as vscode from "vscode";
import {
  EXECUTION_LIMIT_DEFAULTS,
  type ExecutionLimits,
} from "./executionLimitsDefaults.js";

export type { ExecutionLimits } from "./executionLimitsDefaults.js";
export { EXECUTION_LIMIT_DEFAULTS } from "./executionLimitsDefaults.js";

export function loadExecutionLimits(): ExecutionLimits {
  const config = vscode.workspace.getConfiguration("localbridge");
  return {
    defaultCommandTimeoutMs: config.get<number>(
      "execution.defaultCommandTimeoutMs",
      EXECUTION_LIMIT_DEFAULTS.defaultCommandTimeoutMs
    ),
    maxStdoutBytes: config.get<number>(
      "execution.maxStdoutBytes",
      EXECUTION_LIMIT_DEFAULTS.maxStdoutBytes
    ),
    maxStderrBytes: config.get<number>(
      "execution.maxStderrBytes",
      EXECUTION_LIMIT_DEFAULTS.maxStderrBytes
    ),
    maxProcessOutputBytes: config.get<number>(
      "execution.maxProcessOutputBytes",
      EXECUTION_LIMIT_DEFAULTS.maxProcessOutputBytes
    ),
    maxManagedProcesses: config.get<number>(
      "execution.maxManagedProcesses",
      EXECUTION_LIMIT_DEFAULTS.maxManagedProcesses
    ),
    maxConcurrentCommands: config.get<number>(
      "execution.maxConcurrentCommands",
      EXECUTION_LIMIT_DEFAULTS.maxConcurrentCommands
    ),
    httpTimeoutMs: config.get<number>(
      "execution.httpTimeoutMs",
      EXECUTION_LIMIT_DEFAULTS.httpTimeoutMs
    ),
    maxHttpResponseBytes: config.get<number>(
      "execution.maxHttpResponseBytes",
      EXECUTION_LIMIT_DEFAULTS.maxHttpResponseBytes
    ),
    defaultTestTimeoutMs: config.get<number>(
      "execution.defaultTestTimeoutMs",
      EXECUTION_LIMIT_DEFAULTS.defaultTestTimeoutMs
    ),
  };
}
