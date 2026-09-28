import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const publicDir = path.join(root, "public");
const svgPath = path.join(publicDir, "localbridge.svg");
const pngPath = path.join(publicDir, "localbridge.png");
const icoPath = path.join(publicDir, "localbridge.ico");

const svg = fs.readFileSync(svgPath, "utf8");
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 256 },
});
const pngData = resvg.render().asPng();
fs.writeFileSync(pngPath, pngData);

const icoBuffer = await pngToIco(pngPath);
fs.writeFileSync(icoPath, icoBuffer);

console.log("Wrote", pngPath);
console.log("Wrote", icoPath);
