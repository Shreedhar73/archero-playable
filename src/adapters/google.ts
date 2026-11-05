/**
 * Google Ads App campaigns (HTML5 / playable).
 *
 * `ExitApi` comes from exitapi.js, which vite.config.ts injects into <head>
 * for this build only. ExitApi.exit() opens the campaign's final URL. ZIP,
 * 5 MB, relative paths only, no iframes and no localStorage.
 */
import { CTA_LABEL } from "../config.ts";
import type { NetworkAdapter } from "./types.ts";

declare global {
  interface Window {
    ExitApi?: { exit: () => void };
  }
}

export const adapter: NetworkAdapter = {
  network: "google",
  ctaLabel: CTA_LABEL,
  ready: () => Promise.resolve(),
  cta: () => {
    if (window.ExitApi) window.ExitApi.exit();
    else console.warn("[playable] ExitApi missing; exitapi.js did not load");
  },
};
