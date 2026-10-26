/** No ad network: plain hosting and previews. CTA opens the store page directly. */
import { CTA_LABEL, STORE_URLS } from "../config.ts";
import { isIos, type NetworkAdapter } from "./types.ts";

export const adapter: NetworkAdapter = {
  network: "generic",
  ctaLabel: CTA_LABEL,
  ready: () => Promise.resolve(),
  cta: () => {
    window.open(isIos() ? STORE_URLS.ios : STORE_URLS.android, "_blank");
  },
};
