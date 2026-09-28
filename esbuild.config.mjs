import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const extensionBuild = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  external: ["vscode", "@ngrok/ngrok", "@ngrok/ngrok-*"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
};

const uninstallBuild = {
  entryPoints: ["src/uninstall.ts"],
  outfile: "dist/uninstall.js",
  bundle: true,
  external: ["vscode", "@ngrok/ngrok", "@ngrok/ngrok-*"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const extCtx = await esbuild.context(extensionBuild);
  await extCtx.watch();
  console.log("Watching extension...");
} else {
  await esbuild.build(extensionBuild);
  await esbuild.build(uninstallBuild);
}
