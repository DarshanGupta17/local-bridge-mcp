/**
 * List file paths inside a .vsix (ZIP). Cross-platform for CI (Linux tar -tf fails on zip).
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export function listVsixEntries(vsixPath) {
  const attempts = [
    () => spawnSync("unzip", ["-Z1", vsixPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }),
    () => spawnSync("tar", ["-tf", vsixPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }),
    () =>
      spawnSync(
        "python3",
        [
          "-c",
          "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print('\\n'.join(z.namelist()))",
          vsixPath,
        ],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
      ),
    () =>
      spawnSync(
        "python",
        [
          "-c",
          "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print('\\n'.join(z.namelist()))",
          vsixPath,
        ],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
      ),
  ];

  for (const run of attempts) {
    const result = run();
    if (result.status === 0 && result.stdout?.trim()) {
      return result.stdout.split(/\r?\n/).filter(Boolean);
    }
  }

  return listVsixEntriesPure(vsixPath);
}

/** Minimal ZIP central-directory reader (fallback). */
function listVsixEntriesPure(vsixPath) {
  const buf = readFileSync(vsixPath);
  const eocd = findEocdOffset(buf);
  if (eocd < 0) {
    return null;
  }
  const totalEntries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      break;
    }
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    names.push(buf.subarray(nameStart, nameStart + nameLen).toString("utf8"));
    offset = nameStart + nameLen + extraLen + commentLen;
  }
  return names.length ? names : null;
}

function findEocdOffset(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }
  return -1;
}
