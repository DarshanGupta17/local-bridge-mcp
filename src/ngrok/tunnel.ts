import { forward, type Listener } from "@ngrok/ngrok";
import type { Logger } from "../logger.js";
import type { PublicTunnelHandle } from "../tunnel/types.js";

export interface NgrokTunnelOptions {
  authtoken: string;
  /** Reserved ngrok domain / static hostname (e.g. my-app.ngrok-free.app) */
  staticDomain?: string;
}

export type NgrokDomainMode = "static" | "ephemeral";

export interface NgrokTunnelHandle extends PublicTunnelHandle {
  publicBaseUrl: string;
  domainMode: NgrokDomainMode;
}

export async function startNgrokTunnel(
  localPort: number,
  options: NgrokTunnelOptions,
  log: Logger
): Promise<NgrokTunnelHandle> {
  const authtoken = options.authtoken?.trim();
  if (!authtoken) {
    throw new Error("ngrok authtoken is not configured");
  }

  const staticDomain = options.staticDomain?.trim();

  if (staticDomain) {
    log.info(`ngrok static domain requested: ${staticDomain}`);
    try {
      return await connectNgrok(localPort, authtoken, log, staticDomain, "static");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`ngrok static domain failed (${staticDomain}): ${message}`);
      log.info("Falling back to ephemeral ngrok URL…");
    }
  }

  return connectNgrok(localPort, authtoken, log, undefined, "ephemeral");
}

async function connectNgrok(
  localPort: number,
  authtoken: string,
  log: Logger,
  domain: string | undefined,
  domainMode: NgrokDomainMode
): Promise<NgrokTunnelHandle> {
  let listener: Listener;
  try {
    listener = await forward({
      addr: localPort,
      authtoken,
      ...(domain ? { domain } : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/authtoken|auth token|401|403/i.test(message)) {
      throw new Error(`ngrok authentication failed: ${message}`);
    }
    if (domain) {
      throw new Error(message);
    }
    throw new Error(`ngrok could not start: ${message}`);
  }

  const publicBaseUrl = listener.url()?.replace(/\/$/, "");
  if (!publicBaseUrl) {
    await listener.close();
    throw new Error("ngrok did not return a public URL");
  }

  const connectorUrl = `${publicBaseUrl}/mcp`;
  log.info("ngrok started");
  log.info(`ngrok domain mode: ${domainMode}`);
  log.info(`Public URL: ${connectorUrl}`);

  return {
    publicBaseUrl,
    connectorUrl,
    provider: "ngrok",
    domainMode,
    async stop() {
      try {
        await listener.close();
        log.info("ngrok stopped");
      } catch (err: unknown) {
        log.error(err instanceof Error ? err.message : "Failed to stop ngrok");
      }
    },
  };
}
