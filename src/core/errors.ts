export type LocalBridgeErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "AUTHENTICATION_FAILED"
  | "PATH_OUTSIDE_WORKSPACE"
  | "SYMLINK_ESCAPE"
  | "SENSITIVE_ACCESS_DENIED"
  | "USER_PERMISSION_DENIED"
  | "FILE_NOT_FOUND"
  | "FILE_ALREADY_EXISTS"
  | "DIRECTORY_ALREADY_EXISTS"
  | "FILE_IS_DIRECTORY"
  | "PATH_IS_FILE"
  | "FILE_CHANGED_DURING_APPROVAL"
  | "FILE_TOO_LARGE"
  | "BINARY_FILE"
  | "PROTECTED_PATH"
  | "OPERATION_NOT_SUPPORTED";

export class LocalBridgeError extends Error {
  constructor(
    public readonly code: LocalBridgeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LocalBridgeError";
  }
}

export function toolErrorFromLocalBridge(err: LocalBridgeError) {
  return {
    content: [{ type: "text" as const, text: `[${err.code}] ${err.message}` }],
    isError: true as const,
  };
}

export function toolErrorMessage(err: unknown): string {
  if (err instanceof LocalBridgeError) {
    return `[${err.code}] ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
}
