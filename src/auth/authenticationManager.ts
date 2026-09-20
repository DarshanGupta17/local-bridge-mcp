import * as crypto from "node:crypto";
import type * as vscode from "vscode";

const SECRET_KEY = "localbridge.mcp.authToken";
const LEGACY_SECRET_KEY = "repobridge.mcp.authToken";

export class AuthenticationManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async hasToken(): Promise<boolean> {
    const token = await this.secrets.get(SECRET_KEY);
    return Boolean(token?.trim());
  }

  async getToken(): Promise<string | undefined> {
    const token = await this.secrets.get(SECRET_KEY);
    return token?.trim() || undefined;
  }

  async ensureToken(): Promise<string> {
    const existing = await this.getToken();
    if (existing) {
      return existing;
    }
    const legacy = (await this.secrets.get(LEGACY_SECRET_KEY))?.trim();
    if (legacy) {
      await this.secrets.store(SECRET_KEY, legacy);
      await this.secrets.delete(LEGACY_SECRET_KEY);
      return legacy;
    }
    return this.generateToken();
  }

  async generateToken(): Promise<string> {
    const token = `local_${crypto.randomBytes(32).toString("base64url")}`;
    await this.secrets.store(SECRET_KEY, token);
    return token;
  }

  async rotateToken(): Promise<string> {
    await this.secrets.delete(SECRET_KEY);
    return this.generateToken();
  }

  async validateToken(provided: string | undefined): Promise<boolean> {
    if (!provided?.trim()) {
      return false;
    }
    const expected = await this.getToken();
    if (!expected) {
      return false;
    }
    return timingSafeEqual(provided.trim(), expected);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/** For MCP clients (e.g. Claude) that only accept a server URL, not custom headers. */
export function extractAuthTokenFromQuery(url: URL): string | undefined {
  for (const key of ["access_token", "token", "api_key"]) {
    const value = url.searchParams.get(key);
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function extractAuthToken(
  headers: Record<string, string | string[] | undefined>,
  url: URL
): string | undefined {
  return extractAuthTokenFromHeaders(headers) ?? extractAuthTokenFromQuery(url);
}

export function appendTokenToMcpUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("access_token", token);
  return url.toString();
}

export function extractAuthTokenFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const auth = headers.authorization;
  const authStr = Array.isArray(auth) ? auth[0] : auth;
  if (authStr?.startsWith("Bearer ")) {
    return authStr.slice("Bearer ".length).trim();
  }

  const custom =
    headers["x-localbridge-token"] ??
    headers["x-repobridge-token"] ??
    headers["x-repo-bridge-token"];
  const customStr = Array.isArray(custom) ? custom[0] : custom;
  return customStr?.trim() || undefined;
}
