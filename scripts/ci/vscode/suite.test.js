const assert = require("node:assert/strict");
const vscode = require("vscode");

/** @returns {Promise<void>} */
exports.run = async function run() {
  const ext = vscode.extensions.getExtension("Darshangupta.localbridge");
  assert.ok(ext, "LocalBridge extension should be loaded in development host");
  await ext.activate();
  assert.equal(ext.isActive, true);

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("localbridge.start"), "localbridge.start command registered");
  assert.ok(commands.includes("localbridge.stop"), "localbridge.stop command registered");
};
