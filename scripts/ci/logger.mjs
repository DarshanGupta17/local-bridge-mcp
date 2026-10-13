/** Minimal Logger for CI scripts (matches extension Logger interface). */
export function createCiLogger(prefix = "LocalBridge-CI") {
  return {
    info(message) {
      console.log(`[${prefix}] ${message}`);
    },
    error(message) {
      console.error(`[${prefix}] ERROR: ${message}`);
    },
    show() {},
    dispose() {},
  };
}
