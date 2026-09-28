import { runExtensionUninstallCleanup } from "./lifecycle/uninstallCleanup.js";

void runExtensionUninstallCleanup().catch((err) => {
  console.error("[LocalBridge] Uninstall cleanup failed:", err);
});
