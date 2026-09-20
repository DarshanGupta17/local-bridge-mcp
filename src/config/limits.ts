import * as vscode from "vscode";

export interface LocalBridgeLimits {
  maxReadFileSize: number;
  maxWriteFileSize: number;
  maxSearchFileSize: number;
}

const DEFAULT_MAX_READ = 5 * 1024 * 1024;
const DEFAULT_MAX_WRITE = 5 * 1024 * 1024;
const DEFAULT_MAX_SEARCH = 2 * 1024 * 1024;

export function loadLocalBridgeLimits(): LocalBridgeLimits {
  const config = vscode.workspace.getConfiguration("localbridge");
  return {
    maxReadFileSize: config.get<number>("maxReadFileSize", DEFAULT_MAX_READ),
    maxWriteFileSize: config.get<number>("maxWriteFileSize", DEFAULT_MAX_WRITE),
    maxSearchFileSize: config.get<number>("maxSearchFileSize", DEFAULT_MAX_SEARCH),
  };
}

export { DEFAULT_MAX_READ, DEFAULT_MAX_WRITE, DEFAULT_MAX_SEARCH };
