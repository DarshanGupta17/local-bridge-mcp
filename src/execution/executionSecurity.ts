import { classifyCommand, type CommandClassification } from "./commandPolicy.js";
import type { PermissionManager } from "../security/permissionManager.js";
import { LocalBridgeError } from "../core/errors.js";

export async function authorizeCommand(
  permissions: PermissionManager,
  command: string,
  toolName: string
): Promise<CommandClassification> {
  const classification = classifyCommand(command);
  if (classification.risk === "block") {
    throw new LocalBridgeError(
      "COMMAND_BLOCKED",
      classification.reason ?? "Command is not allowed."
    );
  }
  if (classification.risk === "approval") {
    const decision = await permissions.requestCommandPermission(
      command,
      toolName,
      classification.reason
    );
    if (decision === "deny") {
      throw new LocalBridgeError("USER_PERMISSION_DENIED", "Command execution denied by the user.");
    }
  }
  return classification;
}
