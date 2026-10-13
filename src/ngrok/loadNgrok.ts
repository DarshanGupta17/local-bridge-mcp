import type { Listener } from "@ngrok/ngrok";
import { formatNgrokLoadError } from "./ngrokErrors.js";

type ForwardFn = (config: {
  addr: number;
  authtoken: string;
  domain?: string;
}) => Promise<Listener>;

let forwardFn: ForwardFn | undefined;
let loadPromise: Promise<ForwardFn> | undefined;

export async function getNgrokForward(): Promise<ForwardFn> {
  if (forwardFn) {
    return forwardFn;
  }
  if (!loadPromise) {
    loadPromise = loadNgrokModule();
  }
  forwardFn = await loadPromise;
  return forwardFn;
}

async function loadNgrokModule(): Promise<ForwardFn> {
  try {
    const ngrok = await import("@ngrok/ngrok");
    const forward = ngrok.forward;
    if (typeof forward !== "function") {
      throw new Error(
        "ngrok module loaded but forward() is unavailable (native binding missing for this platform)."
      );
    }
    return forward as ForwardFn;
  } catch (err: unknown) {
    throw new Error(formatNgrokLoadError(err));
  }
}
