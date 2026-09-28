export type PublicTunnelProvider = "ngrok" | "cloudflare";

export interface PublicTunnelHandle {
  connectorUrl: string;
  provider: PublicTunnelProvider;
  stop(): Promise<void>;
}
