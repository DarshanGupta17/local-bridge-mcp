import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSensitivePath, normalizeRelativePath } from "./security.js";

describe("isSensitivePath", () => {
  it("detects .env variants", () => {
    assert.equal(isSensitivePath(".env"), true);
    assert.equal(isSensitivePath(".env.local"), true);
    assert.equal(isSensitivePath(".env.production"), true);
  });

  it("detects key and credential files", () => {
    assert.equal(isSensitivePath("secrets.json"), true);
    assert.equal(isSensitivePath("config/secrets/db.json"), true);
    assert.equal(isSensitivePath("id_rsa"), true);
    assert.equal(isSensitivePath("certs/server.pem"), true);
  });

  it("allows normal source files", () => {
    assert.equal(isSensitivePath("src/hello.js"), false);
    assert.equal(isSensitivePath("README.md"), false);
    assert.equal(isSensitivePath(".gitignore"), false);
  });

  it("normalizes paths", () => {
    assert.equal(normalizeRelativePath(".\\src\\file.ts"), "src/file.ts");
  });
});
