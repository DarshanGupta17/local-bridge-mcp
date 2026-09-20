import type * as vscode from "vscode";

/** Strip protocol/path so `https://foo.ngrok-free.app/mcp` → `foo.ngrok-free.app` */
export function normalizeNgrokDomain(raw: string): string {
  let domain = raw.trim();
  domain = domain.replace(/^https?:\/\//i, "");
  domain = domain.split("/")[0]?.split(":")[0] ?? domain;
  return domain;
}

export function resolveNgrokAuthtoken(settingValue: string): string | undefined {
  const fromSetting = settingValue?.trim();
  if (fromSetting) {
    return fromSetting;
  }
  return process.env.NGROK_AUTHTOKEN?.trim() || undefined;
}

export function resolveNgrokStaticDomain(settingValue: string): string | undefined {
  const fromSetting = settingValue?.trim();
  if (fromSetting) {
    return normalizeNgrokDomain(fromSetting);
  }

  for (const key of ["NGROK_DOMAIN", "NGROK_STATIC_DOMAIN"]) {
    const fromEnv = process.env[key]?.trim();
    if (fromEnv) {
      return normalizeNgrokDomain(fromEnv);
    }
  }

  return undefined;
}

export function authtokenSource(config: vscode.WorkspaceConfiguration): string {
  if (config.get<string>("ngrok.authtoken", "").trim()) {
    return "VS Code setting localbridge.ngrok.authtoken";
  }
  if (process.env.NGROK_AUTHTOKEN?.trim()) {
    return "NGROK_AUTHTOKEN environment variable";
  }
  return "unknown";
}

export function staticDomainSource(config: vscode.WorkspaceConfiguration): string {
  if (config.get<string>("ngrok.domain", "").trim()) {
    return "VS Code setting localbridge.ngrok.domain";
  }
  if (process.env.NGROK_DOMAIN?.trim()) {
    return "NGROK_DOMAIN environment variable";
  }
  if (process.env.NGROK_STATIC_DOMAIN?.trim()) {
    return "NGROK_STATIC_DOMAIN environment variable";
  }
  return "unknown";
}
